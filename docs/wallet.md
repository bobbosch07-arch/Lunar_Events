# Wallet-Pässe einrichten

Was zu tun ist, damit „Zu Apple Wallet" und „Zu Google Wallet" auf der
Ticketseite erscheinen. Beide Knöpfe sind unsichtbar, solange der
jeweilige Zugang fehlt — es gibt also keinen Zwischenzustand, in dem ein
Gast auf eine Fehlermeldung klickt.

Ob eine Auslieferung die Zugänge hat, sagt `/api/status`.

---

## Google Wallet

Kostenlos, keine Zertifikate, keine Dateien. Der Pass ist ein signierter
Link.

### 1. Issuer-Konto

Google Pay & Wallet Console öffnen, Issuer-Konto anlegen. Der
**Geschäftsname** erscheint später auf dem Pass — also „Lunar Events",
nicht der Name einer Privatperson.

Notiere die **Issuer-ID** (eine lange Zahl, beginnt meist mit 33).

### 2. Google-Cloud-Projekt

Projekt anlegen (oder ein vorhandenes nehmen), dann die **Google Wallet
API** aktivieren.

### 3. Dienstkonto

Im Cloud-Projekt ein Dienstkonto anlegen und einen **JSON-Schlüssel**
herunterladen. Danach — und das wird gern übersehen — die
**E-Mail-Adresse des Dienstkontos** in der Wallet Console als
berechtigter Nutzer eintragen. Ohne diesen Schritt lehnt Google jeden
Aufruf ab, obwohl der Schlüssel gültig ist.

### 4. Eintragen

```
GOOGLE_WALLET_ISSUER_ID=3388000000000000000
GOOGLE_WALLET_SERVICE_ACCOUNT_JSON=<Inhalt der JSON-Datei>
```

Die JSON-Datei darf auch base64-verpackt eingetragen werden. In
Hosting-Oberflächen ist das robuster: Der private Schlüssel enthält
Zeilenumbrüche, die beim Einfügen gern verlorengehen.

```bash
base64 -w0 dienstkonto.json
```

### 5. Demo-Modus

Neue Konten sind im **Demo-Modus**: Pässe funktionieren nur für dich und
eingetragene Testkonten. Für echte Gäste muss Publishing Access
beantragt werden — Google prüft dabei einen fertigen Beispielpass. Also:
erst einen echten Kauf durchspielen, Pass speichern, dann beantragen.

---

## Apple Wallet

99 $ pro Jahr, und der Zertifikatsteil ist fummelig. Dafür erscheint der
Pass von selbst auf dem Sperrbildschirm, wenn jemand am Veranstaltungsort
ankommt.

### 1. Apple Developer Program

Als **Einzelperson** anmelden geht sofort. Ein Unternehmenskonto verlangt
eine **D-U-N-S-Nummer**, deren Beschaffung ein bis zwei Wochen dauert.
Der Name auf dem Pass kommt aus unseren Daten („Lunar Events"), nicht aus
dem Account — für den Anfang reicht das Einzelkonto also.

Notiere die **Team-ID** (zehn Zeichen, steht im Developer-Portal unter
Membership).

### 2. Pass Type ID

Im Developer-Portal unter Identifiers → Pass Type IDs anlegen, zum
Beispiel:

```
pass.de.lunar-events.ticket
```

### 3. Zertifikat — unter Windows, ohne Mac

Apples Anleitung setzt einen Mac mit Keychain Access voraus. Mit OpenSSL
geht es auch. Alle vier Befehle im selben Ordner ausführen:

Privaten Schlüssel erzeugen:

```bash
openssl genrsa -out lunar-pass.key 2048
```

Signieranfrage erstellen (E-Mail und Name anpassen):

```bash
openssl req -new -key lunar-pass.key -out lunar-pass.csr -subj "/emailAddress=kontakt@lunar-events.de/CN=Lunar Events Pass/C=DE"
```

Die `.csr` im Developer-Portal bei der Pass Type ID hochladen und das
erzeugte `pass.cer` herunterladen. Dann in PEM wandeln:

```bash
openssl x509 -inform DER -outform PEM -in pass.cer -out lunar-pass.pem
```

Zertifikat und Schlüssel zu einer `.p12` bündeln — dabei wird ein
Export-Passwort abgefragt, das du dir merken musst:

```bash
openssl pkcs12 -export -out lunar-pass.p12 -inkey lunar-pass.key -in lunar-pass.pem
```

### 4. WWDR-Zwischenzertifikat

Bei Apple herunterladen (Worldwide Developer Relations, aktuell **G4**)
und in PEM wandeln:

```bash
openssl x509 -inform DER -outform PEM -in AppleWWDRCAG4.cer -out wwdr.pem
```

Ohne dieses Zertifikat prüft kein Gerät die Signatur. Es ist öffentlich,
aber es muss dabei sein.

### 5. Eintragen

```
APPLE_WALLET_TEAM_ID=ABCDE12345
APPLE_WALLET_PASS_TYPE_ID=pass.de.lunar-events.ticket
APPLE_WALLET_ZERTIFIKAT_P12_BASE64=<Ausgabe von: base64 -w0 lunar-pass.p12>
APPLE_WALLET_ZERTIFIKAT_PASSWORT=<das Export-Passwort von oben>
APPLE_WALLET_WWDR_PEM=<Inhalt von wwdr.pem>
```

### 6. Das Ablaufdatum

**Das Signaturzertifikat gilt 398 Tage.** Danach lassen sich keine neuen
Pässe mehr ausstellen; bereits ausgegebene bleiben gültig. Das Backoffice
warnt ab 45 Tagen vorher auf der Übersichtsseite — trotzdem gehört das
Datum in den Kalender.

Erneuert wird über dieselbe Pass Type ID mit einer neuen Signieranfrage.

---

## Was schon geprüft ist

`node scripts/wallet-testen.mjs` prüft ohne echte Zugangsdaten:

- ob alle neun Passbilder in den von Apple verlangten Größen vorliegen
- ob der Google-Link ein gültig signiertes JWT mit dem Ticketcode ist
- ob der Apple-Pass als ZIP mit `pass.json`, Manifest, Signatur und
  Bildern entsteht

Zwei echte Fehler hat dieser Test gefunden, bevor Zertifikate im Spiel
waren: Die Signaturbibliothek nimmt **kein** `.p12` entgegen, sondern
zwei getrennte PEM-Blöcke — und sie lehnt eine **leere Passphrase** ab.
Beides wird jetzt in `src/lib/wallet/apple.ts` erledigt.

Was der Test *nicht* zeigen kann: ob Apple und Google die echten
Zertifikate akzeptieren. Das zeigt erst ein Gerät.

## Die Bilder

`python scripts/wallet_bilder.py` erzeugt sie aus dem Logo. Apple verlangt
feste Namen und Größen in drei Auflösungen; fehlt eine, weigert sich
Wallet den Pass zu öffnen — ohne zu sagen, welche.

Das Symbol bekommt einen Navy-Grund, weil es auf dem Sperrbildschirm
sonst weiß auf weiß stünde.
