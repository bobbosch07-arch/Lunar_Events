import { eigeneAdresse } from "./stripe";
import { ANGEBOT_STUNDEN } from "./typen";

/**
 * Mailversand über Brevo oder Resend.
 *
 * Zwei Anbieter, weil beide im kostenlosen Tarif nur **eine** eigene
 * Domain zulassen und Resend hier schon für ein anderes Projekt belegt
 * ist. Welcher genommen wird, entscheidet allein, welcher Schlüssel in
 * der Umgebung steht; sind beide da, gewinnt Brevo.
 *
 * Ohne Schlüssel wird nichts verschickt — und das wird auch nicht
 * verschwiegen: Die Bestätigungsseite sagt dann ausdrücklich, dass sie
 * die einzige Stelle mit den Tickets ist, und im Protokoll steht, was
 * verschickt worden wäre.
 */

type Anbieter = "brevo" | "resend";

function anbieter(): Anbieter | null {
  if (process.env.BREVO_API_KEY) return "brevo";
  if (process.env.RESEND_API_KEY) return "resend";
  return null;
}

export function versandEingerichtet(): boolean {
  return anbieter() !== null;
}

/** "Lunar Events <tickets@…>" → Name und Adresse getrennt, für Brevo. */
function zerlegeAbsender(roh: string): { name: string; email: string } {
  const treffer = roh.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  if (treffer) return { name: treffer[1] || "Lunar Events", email: treffer[2] };
  return { name: "Lunar Events", email: roh.trim() };
}

const ABSENDER =
  // Absender muss eine beim Mailanbieter bestätigte eigene Domain sein —
  // eine Gmail-Adresse lehnen beide ab. Kontaktadressen stehen woanders.
  process.env.MAIL_ABSENDER ?? "Lunar Events <tickets@lunar-events.de>";

type Anhang = { name: string; inhaltBase64: string };

type Nachricht = {
  an: string;
  betreff: string;
  html: string;
  text: string;
  antwortAn?: string;
  anhaenge?: Anhang[];
  /** Zusätzliche Kopfzeilen, z. B. List-Unsubscribe bei Werbung */
  kopfzeilen?: Record<string, string>;
};

export async function versende(nachricht: Nachricht): Promise<boolean> {
  return (await versendeMitGrund(nachricht)).ok;
}

export type Versandergebnis = { ok: true } | { ok: false; grund: string };

/**
 * Wie `versende`, sagt aber, warum es nicht geklappt hat. Gebraucht vom
 * Backoffice: Vom 18.09. bis 01.10.2026 lehnte der Anbieter jede Mail ab,
 * und niemand merkte es, weil der Grund nur im Protokoll stand, das Vercel
 * nach einer Stunde vergisst.
 */
export async function versendeMitGrund(nachricht: Nachricht): Promise<Versandergebnis> {
  const weg = anbieter();
  if (!weg) {
    console.warn(
      `[mail] Nicht verschickt (kein BREVO_API_KEY oder RESEND_API_KEY): "${nachricht.betreff}" an ${nachricht.an}`,
    );
    return { ok: false, grund: "Kein Mailversand eingerichtet (BREVO_API_KEY fehlt)." };
  }

  const absender = zerlegeAbsender(ABSENDER);

  try {
    const antwort =
      weg === "brevo"
        ? await fetch("https://api.brevo.com/v3/smtp/email", {
            method: "POST",
            headers: {
              "api-key": process.env.BREVO_API_KEY!,
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify({
              sender: absender,
              to: [{ email: nachricht.an }],
              subject: nachricht.betreff,
              htmlContent: nachricht.html,
              textContent: nachricht.text,
              ...(nachricht.antwortAn ? { replyTo: { email: nachricht.antwortAn } } : {}),
              ...(nachricht.kopfzeilen ? { headers: nachricht.kopfzeilen } : {}),
              // Brevo nennt das Feld anders als Resend und will den
              // Dateinamen unter "name" statt "filename".
              ...(nachricht.anhaenge?.length
                ? {
                    attachment: nachricht.anhaenge.map((a) => ({
                      name: a.name,
                      content: a.inhaltBase64,
                    })),
                  }
                : {}),
            }),
          })
        : await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              from: ABSENDER,
              to: [nachricht.an],
              subject: nachricht.betreff,
              html: nachricht.html,
              text: nachricht.text,
              reply_to: nachricht.antwortAn,
              headers: nachricht.kopfzeilen,
              attachments: nachricht.anhaenge?.map((a) => ({
                filename: a.name,
                content: a.inhaltBase64,
              })),
            }),
          });

    if (!antwort.ok) {
      const grund = await antwort.text();
      console.error(
        `[mail] ${weg} hat abgelehnt (${antwort.status}): ${grund.slice(0, 200)}`,
      );
      return { ok: false, grund: `${weg} hat abgelehnt (${antwort.status}): ${grund.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (fehler) {
    // Ein gescheiterter Versand darf niemals einen Kauf scheitern lassen:
    // Das Geld ist geflossen, die Tickets existieren, der Link steht auf
    // der Bestätigungsseite.
    console.error("[mail] Versand fehlgeschlagen:", (fehler as Error).message);
    return { ok: false, grund: `Anbieter nicht erreichbar: ${(fehler as Error).message}` };
  }
}

export type Versandpruefung = {
  /** Nimmt der Anbieter den Schlüssel an? Sonst der HTTP-Status. */
  schluessel: "gueltig" | "fehlt" | `abgelehnt_${number}` | "nicht_erreichbar";
  /** Brevo: Darf das Konto Einzelmails verschicken (Transactional)? */
  einzelmails: boolean | null;
  /** Ist die Absenderadresse beim Anbieter angelegt und aktiv? */
  absenderAktiv: boolean | null;
  /** Bei Ablehnung: die Meldung des Anbieters, z. B. "Key not found". */
  meldung?: string;
  /**
   * Wie der Schlüssel aussieht, ohne ihn zu verraten. Am 01.10.2026 stand
   * in Vercel erst ein SMTP-Schlüssel (`xsmtpsib-`), den die Schnittstelle
   * nicht annimmt; die Form zeigt solche Verwechslungen sofort.
   */
  form?: { art: "api" | "smtp" | "unbekannt"; laenge: number; leerzeichenOderZeichen: boolean };
};

function schluesselForm(wert: string): NonNullable<Versandpruefung["form"]> {
  return {
    art: wert.startsWith("xkeysib-") ? "api" : wert.startsWith("xsmtpsib-") ? "smtp" : "unbekannt",
    laenge: wert.length,
    // Mitkopierte Leerzeichen, Zeilenumbrüche oder Anführungszeichen.
    leerzeichenOderZeichen: /[\s"'=]/.test(wert),
  };
}

/**
 * Fragt beim Anbieter nach, ob der Versand überhaupt gehen kann — ohne eine
 * Mail zu schicken. `/api/status` sagte bis 01.10.2026 nur, ob ein Schlüssel
 * *gesetzt* ist, und zeigte „mail: true", während Brevo jede Mail abwies.
 *
 * Nur für Brevo; bei Resend gibt es keine vergleichbare Abfrage ohne
 * Vollzugriff, dort bleibt es bei `null`.
 */
export async function pruefeVersand(): Promise<Versandpruefung> {
  const weg = anbieter();
  if (!weg) return { schluessel: "fehlt", einzelmails: null, absenderAktiv: null };
  if (weg === "resend") return { schluessel: "gueltig", einzelmails: null, absenderAktiv: null };

  const kopf = { "api-key": process.env.BREVO_API_KEY!, Accept: "application/json" };
  try {
    const [konto, absender] = await Promise.all([
      fetch("https://api.brevo.com/v3/account", { headers: kopf, cache: "no-store" }),
      fetch("https://api.brevo.com/v3/senders", { headers: kopf, cache: "no-store" }),
    ]);
    if (!konto.ok) {
      const antwort = (await konto.json().catch(() => null)) as { message?: string } | null;
      return {
        schluessel: `abgelehnt_${konto.status}`,
        einzelmails: null,
        absenderAktiv: null,
        meldung: antwort?.message?.slice(0, 160),
        form: schluesselForm(process.env.BREVO_API_KEY!),
      };
    }
    const kontoDaten = (await konto.json()) as { relay?: { enabled?: boolean } };
    const liste = absender.ok
      ? ((await absender.json()) as { senders?: Array<{ email: string; active: boolean }> }).senders
      : undefined;
    const eigene = zerlegeAbsender(ABSENDER).email.toLowerCase();
    return {
      schluessel: "gueltig",
      einzelmails: kontoDaten.relay?.enabled ?? null,
      absenderAktiv: liste
        ? liste.some((s) => s.email.toLowerCase() === eigene && s.active)
        : null,
    };
  } catch {
    return { schluessel: "nicht_erreichbar", einzelmails: null, absenderAktiv: null };
  }
}

/* ------------------------------------------------------------------ */

/*
 * Violett-Nacht (30.09.2026) auch in der Mail: Nacht als Grund, violetter
 * Kopf mit dem farbigen Logo, Knöpfe in Mondgelb mit rosa Schattenkante,
 * unten der Slogan. Die Farben stehen als Literale, weil Mailprogramme
 * keine CSS-Variablen kennen — dieselben Werte wie in tokens.css
 * (#14062e nacht-950, #220a4f nacht-800, #3a1a73 nacht-600, #5b21c9
 * violett, #ffe14a mondgelb, #ff8fd6 rosa, #f7f0ff lila-weiß, #2a0b5e
 * tinte). Ändert sich dort etwas, muss es hier mit.
 *
 * "color-scheme: dark" sagt Apple Mail und Outlook, dass die Mail schon
 * dunkel ist — sonst kehren manche die Farben um.
 *
 * Cosmos (01.10.2026): Sternenstaub hinter der Mail, rosa Planet im Kopf,
 * Sternschnuppe über dem Fuß. Die Widgets sind **PNG** aus public/mail
 * (`scripts/mail_bilder.mjs`), weil Gmail und Outlook keine SVGs zeigen,
 * und **echte Bilder statt Hintergründe**, weil viele Mailprogramme
 * Hintergrundbilder verwerfen. Einzige Ausnahme ist der Sternenstaub: Fehlt
 * er, bleibt die Nachtfarbe, und es fehlt nichts.
 */
function huelle(inhalt: string): string {
  const bild = (datei: string) => `${eigeneAdresse()}/mail/${datei}`;
  // Tabellen und Inline-Styles: Mailprogramme verstehen nichts anderes
  // verlässlich. Flexbox und externe Stylesheets fallen aus.
  return `<!doctype html>
<html lang="de"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="dark" />
<meta name="supported-color-schemes" content="dark" />
</head>
<body style="margin:0;padding:0;background:#14062e;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" background="${bild("sternenstaub.png")}" bgcolor="#14062e" style="background-color:#14062e;background-image:url('${bild("sternenstaub.png")}');background-repeat:repeat;padding:32px 16px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#220a4f;border-radius:4px;overflow:hidden;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;color:#f7f0ff;">
${inhalt}
<tr><td style="padding:0;background:#1a0840;line-height:0;font-size:0;">
<img src="${bild("trenner.png")}" width="560" alt="" style="display:block;border:0;width:100%;max-width:560px;height:auto;" />
</td></tr>
<tr><td style="padding:4px 28px 24px;background:#1a0840;font-size:12px;line-height:1.6;color:#9788b0;">
<div style="margin-bottom:10px;font-size:15px;"><span style="font-family:'Arial Black','Helvetica Neue',Arial,sans-serif;font-weight:900;letter-spacing:1px;color:#f7f0ff;">SEE YOU</span> <span style="font-family:Georgia,'Times New Roman',serif;font-style:italic;color:#ff8fd6;">after dark</span></div>
Lunar Events · <a href="${eigeneAdresse()}" style="color:#c4b9d5;">lunar-events.de</a><br />
Fragen? Antworte einfach auf diese Mail.
</td></tr>
</table>
</td></tr></table>
</body></html>`;
}

/**
 * Der Kopf: violetter Himmel (Verlauf, wo das Mailprogramm ihn kann, sonst
 * Violett), links das farbige Logo, rechts der rosa Planet mit Funkeln,
 * darunter der Titel. Logo und Planet stehen in einer eigenen Zeile über
 * dem Titel, damit sie ihn auf schmalen Handys nie überdecken. Werden
 * Bilder blockiert, steht dort "Lunar Events" und der Planet fehlt still.
 */
function kopfBalken(titel: string): string {
  return `<tr><td style="padding:20px 20px 28px 28px;background:#5b21c9;background-image:linear-gradient(160deg,#8a4dff 0%,#5b21c9 45%,#2e0e6b 100%);color:#f7f0ff;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td valign="middle" style="padding-top:8px;"><img src="${eigeneAdresse()}/logo/lunar-farbig.png" width="110" height="70" alt="Lunar Events" style="display:block;border:0;width:110px;height:auto;color:#ffe14a;font-size:14px;font-weight:700;letter-spacing:2px;" /></td>
<td valign="top" align="right" width="150"><img src="${eigeneAdresse()}/mail/kopf-deko.png" width="150" height="90" alt="" style="display:block;border:0;width:150px;height:90px;" /></td>
</tr></table>
<div style="padding:12px 8px 0 0;font-family:'Arial Black','Helvetica Neue',Arial,sans-serif;font-size:24px;font-weight:900;letter-spacing:0.5px;line-height:1.15;text-transform:uppercase;">${titel}</div>
</td></tr>`;
}

/** Für alles, was ein Gast selbst eingetippt hat und ins HTML einer Mail geht. */
function maskiere(t: string): string {
  return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Die Ticketkarte der Ticketseite (TicketKarte) als Mail-Tabelle: violetter
 * Kopf mit Mondmarke und rosa Etikett, Eckdaten in zwei Spalten, gestrichelte
 * Abrisskante, darunter der Knopf, rosa Schattenkante rechts und unten.
 * `felder` geht so ins HTML, wie es kommt: Gasteingaben vorher maskieren.
 */
function ticketKarte(k: {
  titel: string;
  etikett: string;
  felder: Array<[string, string]>;
  link: string;
  knopf: string;
}): string {
  const feld = ([name, wert]: [string, string], links: boolean) =>
    `<td width="50%" valign="top" style="padding:0 ${links ? "12px" : "0"} 16px 0;">
<div style="font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#ffe14a;">${name}</div>
<div style="font-size:14px;line-height:1.5;margin-top:3px;color:#f7f0ff;">${wert}</div></td>`;
  const zeilen: string[] = [];
  for (let i = 0; i < k.felder.length; i += 2) {
    const rechts = k.felder[i + 1];
    zeilen.push(`<tr>${feld(k.felder[i], true)}${rechts ? feld(rechts, false) : '<td width="50%"></td>'}</tr>`);
  }
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;margin-bottom:24px;background:#2d1266;border-radius:3px;border-right:5px solid #ff8fd6;border-bottom:5px solid #ff8fd6;">
<tr><td style="padding:12px 16px 12px 18px;background:#5b21c9;background-image:linear-gradient(160deg,#8a4dff 0%,#5b21c9 60%,#3a128a 100%);border-radius:3px 3px 0 0;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td valign="middle"><img src="${eigeneAdresse()}/logo/mark-farbig.png" width="34" height="35" alt="" style="display:block;border:0;width:34px;height:35px;" /></td>
<td valign="middle" align="right"><span style="display:inline-block;padding:7px 12px;background:#ff8fd6;color:#2a0b5e;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;">${k.etikett}</span></td>
</tr></table>
</td></tr>
<tr><td style="padding:20px 18px 4px;">
<div style="margin-bottom:16px;font-family:'Arial Black','Helvetica Neue',Arial,sans-serif;font-size:20px;font-weight:900;line-height:1.15;text-transform:uppercase;color:#f7f0ff;">${k.titel}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${zeilen.join("")}</table>
</td></tr>
<tr><td style="padding:0 18px;"><div style="height:0;border-top:2px dashed #5a3d9e;line-height:0;font-size:0;">&nbsp;</div></td></tr>
<tr><td style="padding:20px 18px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td valign="middle">
<table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td style="background:#ffe14a;border-radius:3px;border-right:4px solid #ff8fd6;border-bottom:4px solid #ff8fd6;">
<a href="${k.link}" style="display:inline-block;padding:14px 24px;color:#2a0b5e;text-decoration:none;font-family:'Arial Black','Helvetica Neue',Arial,sans-serif;font-size:13px;font-weight:900;letter-spacing:1px;text-transform:uppercase;">${k.knopf}</a>
</td></tr></table>
</td>
<td valign="middle" align="right" width="32"><img src="${eigeneAdresse()}/mail/funkeln.png" width="24" height="24" alt="" style="display:block;border:0;width:24px;height:24px;" /></td>
</tr></table>
</td></tr>
</table>`;
}

/* ------------------------------------------------------------------ */

export type TicketMail = {
  an: string;
  vorname: string | null;
  bestellnummer: string;
  eventTitel: string;
  wann: string;
  ort: string;
  anzahl: number;
  ticketLink: string;
  /** Apple-Wallet-Pässe, die direkt anhängen. */
  paesse?: Array<{ name: string; inhaltBase64: string }>;
  /**
   * Garderobenmarken dieser Bestellung (0027). Eine Nachbuchung hat nur
   * Marken und keine Tickets — dann heißt die Mail „Garderobe gebucht".
   */
  garderobe?: number;
};

export async function sendeTickets(daten: TicketMail): Promise<Versandergebnis> {
  const anrede = daten.vorname ? `Hallo ${daten.vorname},` : "Hallo,";
  // Der Vorname kommt aus der Kasse, also vom Gast selbst: ins HTML nur maskiert.
  const anredeHtml = daten.vorname ? `Hallo ${maskiere(daten.vorname)},` : "Hallo,";
  const marken = daten.garderobe ?? 0;
  const markenText = marken === 1 ? "eine Garderobenmarke" : `${marken} Garderobenmarken`;
  const nurGarderobe = daten.anzahl === 0 && marken > 0;
  const stueck = nurGarderobe
    ? markenText
    : daten.anzahl === 1
      ? "dein Ticket"
      : `deine ${daten.anzahl} Tickets`;
  const verb = (nurGarderobe ? marken : daten.anzahl) === 1 ? "ist" : "sind";
  const satz = nurGarderobe
    ? `hier ${verb} ${markenText} für <strong>${daten.eventTitel}</strong>. Sie stehen mit QR-Code auf deiner Ticketseite, unter den Tickets.`
    : `hier ${verb} ${stueck} für <strong>${daten.eventTitel}</strong>${
        marken > 0 ? `, dazu ${markenText}. Der QR-Code steht auf derselben Seite` : ""
      }.`;

  const html = huelle(`
${kopfBalken(nurGarderobe ? "Garderobe gebucht" : "Tickets sind da")}
<tr><td style="padding:28px;font-size:15px;line-height:1.7;">
<p style="margin:0 0 16px;">${anredeHtml}</p>
<p style="margin:0 0 24px;">${satz}</p>

${ticketKarte({
  titel: daten.eventTitel,
  etikett: nurGarderobe
    ? "Garderobe"
    : `${daten.anzahl} ${daten.anzahl === 1 ? "Ticket" : "Tickets"}`,
  felder: [
    ["Wann", daten.wann],
    ["Wo", daten.ort],
    ["Bestellung", daten.bestellnummer],
    ...(daten.vorname ? ([["Gast", maskiere(daten.vorname)]] as Array<[string, string]>) : []),
  ],
  link: daten.ticketLink,
  knopf: nurGarderobe ? "Marken öffnen" : "Tickets öffnen",
})}

<p style="margin:0;font-size:13px;line-height:1.7;color:#c4b9d5;">
${
  daten.paesse?.length
    ? "Im Anhang liegen deine Pässe für Apple Wallet. Einmal antippen, dann liegen sie auf dem Sperrbildschirm, sobald du am Veranstaltungsort bist.<br /><br />"
    : ""
}Der Link führt zu deinen Tickets mit QR-Code. Am besten gleich speichern.
Wer den Link hat, kommt rein: gib ihn nur an Leute weiter, denen du vertraust.
</p>
</td></tr>`);

  const text = `${anrede}

${satz.replace(/<\/?strong>/g, "")}

Wann: ${daten.wann}
Wo: ${daten.ort}
Bestellnummer: ${daten.bestellnummer}

Tickets öffnen: ${daten.ticketLink}

Wer den Link hat, kommt rein. Gib ihn nur an Leute weiter, denen du vertraust.

Lunar Events`;

  return versendeMitGrund({
    an: daten.an,
    betreff: nurGarderobe
      ? `${daten.eventTitel} · Garderobe`
      : `${daten.eventTitel} · ${stueck.charAt(0).toUpperCase()}${stueck.slice(1)}`,
    html,
    text,
    anhaenge: daten.paesse,
  });
}

/* ------------------------------------------------------------------ */

export type VipMail = {
  name: string;
  email: string;
  telefon: string | null;
  gaeste: number;
  event: string | null;
  paket: string | null;
  nachricht: string | null;
};

/** Geht ans Team, nicht an den Gast. */
export async function meldeVipAnfrage(daten: VipMail): Promise<boolean> {
  const zeilen: Array<[string, string]> = [
    ["Name", daten.name],
    ["E-Mail", daten.email],
    ["Telefon", daten.telefon ?? "—"],
    ["Gäste", String(daten.gaeste)],
    ["Event", daten.event ?? "—"],
    ["Paket", daten.paket ?? "offen"],
  ];

  const html = huelle(`
${kopfBalken("VIP-Anfrage")}
<tr><td style="padding:28px;font-size:15px;line-height:1.7;">
<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border:1px solid #3a1a73;border-radius:3px;">
${zeilen
  .map(
    ([name, wert]) =>
      `<tr><td style="padding:12px 18px;border-bottom:1px solid #3a1a73;width:110px;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#ffe14a;">${name}</td><td style="padding:12px 18px;border-bottom:1px solid #3a1a73;font-size:15px;">${wert}</td></tr>`,
  )
  .join("")}
</table>
${
  daten.nachricht
    ? `<p style="margin:20px 0 0;padding:16px 18px;background:#2d1260;border-radius:3px;font-size:14px;line-height:1.7;">${daten.nachricht.replace(/</g, "&lt;")}</p>`
    : ""
}
<p style="margin:24px 0 0;font-size:13px;color:#c4b9d5;">
Im Formular steht „innerhalb von 24 Stunden“. Das ist eine Zusage.
<br /><a href="${eigeneAdresse()}/backoffice/vip" style="color:#f7f0ff;">Im Backoffice bearbeiten</a>
</p>
</td></tr>`);

  const text = `VIP-Anfrage

${zeilen.map(([n, w]) => `${n}: ${w}`).join("\n")}
${daten.nachricht ? `\nNachricht:\n${daten.nachricht}\n` : ""}
Im Backoffice: ${eigeneAdresse()}/backoffice/vip`;

  const ziel = process.env.MAIL_TEAM ?? "kontakt@lunar-events.de";

  return versende({
    an: ziel,
    betreff: `VIP-Anfrage: ${daten.name} (${daten.gaeste} Gäste)`,
    html,
    text,
    // Antworten gehen direkt an den Gast.
    antwortAn: daten.email,
  });
}

/* ------------------------------------------------------------------ */

export type PresaleEinladungMail = {
  an: string;
  vorname: string | null;
  eventTitel: string;
  wann: string;
  /** Wann der öffentliche Verkauf beginnt — bis dahin gilt der Vorsprung. */
  oeffentlichAb: string;
  link: string;
  abmeldeLink: string;
};

/**
 * Einladung in den Presale an frühere Gäste. Werbung im Sinne von § 7 UWG:
 * erlaubt nur mit dem Hinweis in der Kasse (bestellungen.werbehinweis) und
 * einem Abmeldelink in jeder Mail — sichtbar im Text und als
 * List-Unsubscribe-Kopfzeile, damit Mailprogramme ihren Abmeldeknopf zeigen.
 */
export async function sendePresaleEinladung(daten: PresaleEinladungMail): Promise<boolean> {
  // Der Vorname kommt aus der Kasse, also vom Gast selbst — ins HTML nur
  // maskiert. Der Text-Teil braucht das nicht.
  const anredeText = daten.vorname ? `Hallo ${daten.vorname},` : "Hallo,";
  const anrede = daten.vorname ? `Hallo ${maskiere(daten.vorname)},` : "Hallo,";

  const html = huelle(`
${kopfBalken("Presale")}
<tr><td style="padding:28px;font-size:15px;line-height:1.7;">
<p style="margin:0 0 16px;">${anrede}</p>
<p style="margin:0 0 24px;">du warst schon bei uns. Deshalb kommst du vor allen anderen an Tickets für <strong>${maskiere(daten.eventTitel)}</strong>.</p>

<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border:1px solid #3a1a73;border-radius:3px;margin-bottom:24px;">
<tr><td style="padding:16px 18px;border-bottom:1px solid #3a1a73;">
<div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#ffe14a;">Wann</div>
<div style="font-size:15px;margin-top:2px;">${daten.wann}</div></td></tr>
<tr><td style="padding:16px 18px;">
<div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#ffe14a;">Öffentlicher Verkauf</div>
<div style="font-size:15px;margin-top:2px;">ab ${daten.oeffentlichAb}</div></td></tr>
</table>

<table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td style="background:#ffe14a;border-radius:3px;border-right:4px solid #ff8fd6;border-bottom:4px solid #ff8fd6;">
<a href="${daten.link}" style="display:inline-block;padding:15px 28px;color:#2a0b5e;text-decoration:none;font-family:'Arial Black','Helvetica Neue',Arial,sans-serif;font-size:13px;font-weight:900;letter-spacing:1px;text-transform:uppercase;">Zum Presale</a>
</td></tr></table>

<p style="margin:24px 0 0;font-size:13px;line-height:1.7;color:#c4b9d5;">
Der Link ist persönlich und gilt nur mit dieser Mailadresse (${daten.an}).
</p>
<p style="margin:16px 0 0;font-size:12px;line-height:1.7;color:#9788b0;">
Du bekommst diese Mail, weil du bei Lunar Events Tickets gekauft hast.
Keine Einladungen mehr? <a href="${daten.abmeldeLink}" style="color:#c4b9d5;">Hier abbestellen</a>.
</p>
</td></tr>`);

  const text = `${anredeText}

du warst schon bei uns. Deshalb kommst du vor allen anderen an Tickets für ${daten.eventTitel}.

Wann: ${daten.wann}
Öffentlicher Verkauf: ab ${daten.oeffentlichAb}

Zum Presale: ${daten.link}

Der Link ist persönlich und gilt nur mit dieser Mailadresse (${daten.an}).

Du bekommst diese Mail, weil du bei Lunar Events Tickets gekauft hast.
Keine Einladungen mehr: ${daten.abmeldeLink}

Lunar Events`;

  return versende({
    an: daten.an,
    betreff: `Presale: ${daten.eventTitel}`,
    html,
    text,
    kopfzeilen: { "List-Unsubscribe": `<${daten.abmeldeLink}>` },
  });
}

/* ------------------------------------------------------------------ */

export type WartelisteBestaetigungMail = {
  an: string;
  vorname: string | null;
  eventTitel: string;
  wann: string;
  anzahl: number;
  link: string;
};

/**
 * Erst wer diesen Link anklickt, steht auf der Warteliste. Eine vertippte
 * Adresse hielte sonst später echte Tickets stundenlang fest.
 */
export async function sendeWartelisteBestaetigung(
  daten: WartelisteBestaetigungMail,
): Promise<boolean> {
  const anredeText = daten.vorname ? `Hallo ${daten.vorname},` : "Hallo,";
  const anrede = daten.vorname ? `Hallo ${maskiere(daten.vorname)},` : "Hallo,";
  const stueck = daten.anzahl === 1 ? "1 Ticket" : `${daten.anzahl} Tickets`;

  const html = huelle(`
${kopfBalken("Warteliste")}
<tr><td style="padding:28px;font-size:15px;line-height:1.7;">
<p style="margin:0 0 16px;">${anrede}</p>
<p style="margin:0 0 24px;">du möchtest auf die Warteliste für <strong>${maskiere(daten.eventTitel)}</strong> (${daten.wann}), für ${stueck}. Bestätige das mit einem Klick, erst dann stehst du drauf.</p>

<table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td style="background:#ffe14a;border-radius:3px;border-right:4px solid #ff8fd6;border-bottom:4px solid #ff8fd6;">
<a href="${daten.link}" style="display:inline-block;padding:15px 28px;color:#2a0b5e;text-decoration:none;font-family:'Arial Black','Helvetica Neue',Arial,sans-serif;font-size:13px;font-weight:900;letter-spacing:1px;text-transform:uppercase;">Eintrag bestätigen</a>
</td></tr></table>

<p style="margin:24px 0 0;font-size:13px;line-height:1.7;color:#c4b9d5;">
Wird etwas frei, schreiben wir dir. Dann hast du ${ANGEBOT_STUNDEN} Stunden Zeit zum Kaufen.
</p>
<p style="margin:16px 0 0;font-size:12px;line-height:1.7;color:#9788b0;">
Du hast dich nicht eingetragen? Dann ignoriere diese Mail. Ohne Klick passiert nichts.
</p>
</td></tr>`);

  const text = `${anredeText}

du möchtest auf die Warteliste für ${daten.eventTitel} (${daten.wann}), für ${stueck}. Bestätige das mit einem Klick, erst dann stehst du drauf:

${daten.link}

Wird etwas frei, schreiben wir dir. Dann hast du ${ANGEBOT_STUNDEN} Stunden Zeit zum Kaufen.

Du hast dich nicht eingetragen? Dann ignoriere diese Mail. Ohne Klick passiert nichts.

Lunar Events`;

  return versende({
    an: daten.an,
    betreff: `Warteliste ${daten.eventTitel}: bitte bestätigen`,
    html,
    text,
  });
}

export type WartelisteAngebotMail = {
  an: string;
  vorname: string | null;
  eventTitel: string;
  wann: string;
  ort: string;
  anzahl: number;
  /** "Freitag, 24. Oktober, 14:30" */
  bis: string;
  kaufLink: string;
  freigebenLink: string;
};

/** Du bist dran: Die Tickets sind reserviert, die Frist läuft. */
export async function sendeWartelisteAngebot(daten: WartelisteAngebotMail): Promise<boolean> {
  const anredeText = daten.vorname ? `Hallo ${daten.vorname},` : "Hallo,";
  const anrede = daten.vorname ? `Hallo ${maskiere(daten.vorname)},` : "Hallo,";
  const stueck = daten.anzahl === 1 ? "1 Ticket ist" : `${daten.anzahl} Tickets sind`;

  const html = huelle(`
${kopfBalken("Du bist dran")}
<tr><td style="padding:28px;font-size:15px;line-height:1.7;">
<p style="margin:0 0 16px;">${anrede}</p>
<p style="margin:0 0 24px;">für <strong>${maskiere(daten.eventTitel)}</strong> ist etwas frei geworden. ${stueck} für dich reserviert.</p>

<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border:1px solid #3a1a73;border-radius:3px;margin-bottom:24px;">
<tr><td style="padding:16px 18px;border-bottom:1px solid #3a1a73;">
<div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#ffe14a;">Wann</div>
<div style="font-size:15px;margin-top:2px;">${daten.wann}</div></td></tr>
<tr><td style="padding:16px 18px;border-bottom:1px solid #3a1a73;">
<div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#ffe14a;">Wo</div>
<div style="font-size:15px;margin-top:2px;">${maskiere(daten.ort)}</div></td></tr>
<tr><td style="padding:16px 18px;">
<div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#ffe14a;">Reserviert bis</div>
<div style="font-size:15px;margin-top:2px;"><strong>${daten.bis} Uhr</strong></div></td></tr>
</table>

<table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td style="background:#ffe14a;border-radius:3px;border-right:4px solid #ff8fd6;border-bottom:4px solid #ff8fd6;">
<a href="${daten.kaufLink}" style="display:inline-block;padding:15px 28px;color:#2a0b5e;text-decoration:none;font-family:'Arial Black','Helvetica Neue',Arial,sans-serif;font-size:13px;font-weight:900;letter-spacing:1px;text-transform:uppercase;">Jetzt kaufen</a>
</td></tr></table>

<p style="margin:24px 0 0;font-size:13px;line-height:1.7;color:#c4b9d5;">
Danach gehen die Tickets an den Nächsten auf der Liste.
Doch keine Zeit? <a href="${daten.freigebenLink}" style="color:#c4b9d5;">Tickets freigeben</a>, dann ist der Nächste gleich dran.
</p>
</td></tr>`);

  const text = `${anredeText}

für ${daten.eventTitel} ist etwas frei geworden. ${stueck} für dich reserviert.

Wann: ${daten.wann}
Wo: ${daten.ort}
Reserviert bis: ${daten.bis} Uhr

Jetzt kaufen: ${daten.kaufLink}

Danach gehen die Tickets an den Nächsten auf der Liste.
Doch keine Zeit? Tickets freigeben: ${daten.freigebenLink}

Lunar Events`;

  return versende({
    an: daten.an,
    betreff: `${daten.eventTitel}: Deine Tickets sind reserviert`,
    html,
    text,
  });
}

/* ------------------------------------------------------------------ */

export type GaestelisteMail = {
  an: string;
  name: string;
  eventTitel: string;
  wann: string;
  ort: string;
  /** Personen insgesamt, der Gast eingeschlossen */
  personen: number;
  ticketLink: string;
};

/**
 * Du stehst auf der Gästeliste — mit dem Link zu den QR-Codes. Am Einlass
 * geht es auch ohne, über die Namensliste; der Code ist nur schneller.
 */
export async function sendeGaesteliste(daten: GaestelisteMail): Promise<boolean> {
  const name = maskiere(daten.name);
  const mit =
    daten.personen === 1
      ? ""
      : daten.personen === 2
        ? ", mit einer Begleitung"
        : `, mit ${daten.personen - 1} Begleitungen`;

  const html = huelle(`
${kopfBalken("Gästeliste")}
<tr><td style="padding:28px;font-size:15px;line-height:1.7;">
<p style="margin:0 0 16px;">Hallo ${name},</p>
<p style="margin:0 0 24px;">du stehst auf der Gästeliste für <strong>${maskiere(daten.eventTitel)}</strong>${mit}.</p>

${ticketKarte({
  titel: maskiere(daten.eventTitel),
  etikett: "Gästeliste",
  felder: [
    ["Wann", daten.wann],
    ["Wo", maskiere(daten.ort)],
    ["Name", name],
    ["Personen", String(daten.personen)],
  ],
  link: daten.ticketLink,
  knopf: daten.personen === 1 ? "QR-Code öffnen" : "QR-Codes öffnen",
})}

<p style="margin:0;font-size:13px;line-height:1.7;color:#c4b9d5;">
${daten.personen === 1 ? "Zeig den Code am Einlass." : "Jede Person braucht ihren eigenen Code. Schick deiner Begleitung den Link oder zeigt die Codes nacheinander."}
Ohne Handy geht es auch: Du stehst mit Namen auf der Liste.
</p>
</td></tr>`);

  const text = `Hallo ${daten.name},

du stehst auf der Gästeliste für ${daten.eventTitel}${mit}.

Wann: ${daten.wann}
Wo: ${daten.ort}

QR-Codes: ${daten.ticketLink}

Ohne Handy geht es auch: Du stehst mit Namen auf der Liste.

Lunar Events`;

  return versende({
    an: daten.an,
    betreff: `Gästeliste: ${daten.eventTitel}`,
    html,
    text,
  });
}

/* ------------------------------------------------------------------ */

export type VipTicketMail = {
  an: string;
  /** Die anfragende Person — sie bekommt alle Tickets des Tisches. */
  name: string;
  eventTitel: string;
  wann: string;
  ort: string;
  tisch: string | null;
  gaeste: string[];
  ticketLink: string;
};

/**
 * VIP-Tickets (0028) an die Person, die angefragt hat: ein Link mit allen
 * Tickets des Tisches, jedes mit Namen. Weiterleiten kann sie von dort aus
 * einzeln — unter jedem Ticket steht ein eigener Link.
 */
export async function sendeVipTickets(daten: VipTicketMail): Promise<boolean> {
  const name = maskiere(daten.name);
  const liste = daten.gaeste.map((g) => `<li>${maskiere(g)}</li>`).join("");

  const html = huelle(`
${kopfBalken("VIP")}
<tr><td style="padding:28px;font-size:15px;line-height:1.7;">
<p style="margin:0 0 16px;">Hallo ${name},</p>
<p style="margin:0 0 24px;">eure VIP-Tickets für <strong>${maskiere(daten.eventTitel)}</strong> sind da: ${daten.gaeste.length === 1 ? "ein Ticket" : `${daten.gaeste.length} Tickets`}, jedes auf einen Namen.</p>

${ticketKarte({
  titel: maskiere(daten.eventTitel),
  etikett: "VIP",
  felder: [
    ["Wann", daten.wann],
    ["Wo", maskiere(daten.ort)],
    ...(daten.tisch ? ([["Platz", maskiere(daten.tisch)]] as Array<[string, string]>) : []),
    ["Tickets", String(daten.gaeste.length)],
  ],
  link: daten.ticketLink,
  knopf: "Tickets öffnen",
})}

<p style="margin:0 0 8px;font-size:13px;color:#c4b9d5;">Auf der Liste:</p>
<ul style="margin:0 0 24px;padding-left:20px;">${liste}</ul>

<p style="margin:0;font-size:13px;line-height:1.7;color:#c4b9d5;">
Jede Person braucht ihr eigenes Ticket. Unter jedem Ticket steht ein Link nur für diese Person. Schick ihn weiter, dann hat sie ihr Ticket selbst.
Wer den Link hat, kommt rein: gib ihn nur an Leute weiter, denen du vertraust.
</p>
</td></tr>`);

  const text = `Hallo ${daten.name},

eure VIP-Tickets für ${daten.eventTitel} sind da, jedes auf einen Namen.

Wann: ${daten.wann}
Wo: ${daten.ort}${daten.tisch ? `\nPlatz: ${daten.tisch}` : ""}

Auf der Liste:
${daten.gaeste.map((g) => `- ${g}`).join("\n")}

Tickets öffnen: ${daten.ticketLink}

Unter jedem Ticket steht ein eigener Link zum Weiterleiten.

Lunar Events`;

  return versende({
    an: daten.an,
    betreff: `VIP: ${daten.eventTitel}`,
    html,
    text,
  });
}

/* ------------------------------------------------------------------ */

export type AnmeldeMail = {
  an: string;
  name: string;
  email: string;
  weg: "Passwort" | "Anmeldelink";
  zeit: string;
};

/** Geht an die Admins, sobald sich ein Admin anmeldet. */
export async function sendeAnmeldungImBackoffice(daten: AnmeldeMail): Promise<boolean> {
  const zeilen: Array<[string, string]> = [
    ["Wer", `${daten.name} (${daten.email})`],
    ["Wann", daten.zeit],
    ["Weg", daten.weg],
  ];

  const html = huelle(`
${kopfBalken("Anmeldung")}
<tr><td style="padding:28px;font-size:15px;line-height:1.7;">
<p style="margin:0 0 24px;">Jemand hat sich mit Admin-Rechten im Backoffice angemeldet.</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border:1px solid #3a1a73;border-radius:3px;">
${zeilen
  .map(
    ([name, wert]) =>
      `<tr><td style="padding:12px 18px;border-bottom:1px solid #3a1a73;width:80px;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#ffe14a;">${name}</td><td style="padding:12px 18px;border-bottom:1px solid #3a1a73;font-size:15px;">${maskiere(wert)}</td></tr>`,
  )
  .join("")}
</table>
<p style="margin:24px 0 0;font-size:13px;line-height:1.7;color:#c4b9d5;">
Warst du das nicht? Dann sofort das Passwort ändern (Backoffice → Mein Zugang) und den
zweiten Faktor neu einrichten.
</p>
</td></tr>`);

  const text = `Anmeldung im Backoffice mit Admin-Rechten.

${zeilen.map(([n, w]) => `${n}: ${w}`).join("\n")}

Warst du das nicht? Passwort ändern und zweiten Faktor neu einrichten.

Lunar Events`;

  return versende({ an: daten.an, betreff: `Anmeldung im Backoffice: ${daten.name}`, html, text });
}

/* ------------------------------------------------------------------ */

export type SchichtplanMail = {
  an: string;
  name: string;
  eventTitel: string;
  wann: string;
  ort: string;
  schichten: Array<{
    rolle: string;
    station: string | null;
    von: string;
    bis: string;
    pauseMin: number;
    stunden: number;
    notiz: string | null;
  }>;
  planLink: string;
};

/** Der eigene Schichtplan für ein Event. */
export async function sendeSchichtplan(daten: SchichtplanMail): Promise<boolean> {
  const anrede = daten.name ? `Hallo ${daten.name.split(" ")[0]},` : "Hallo,";
  const zeilen = daten.schichten
    .map(
      (s) => `<tr><td style="padding:14px 18px;border-bottom:1px solid #3a1a73;font-size:15px;">
<strong>${maskiere(s.rolle)}</strong>${s.station ? ` · ${maskiere(s.station)}` : ""}<br />
${s.von} – ${s.bis} Uhr · ${s.stunden.toString().replace(".", ",")} Std${s.pauseMin > 0 ? ` (inkl. ${s.pauseMin} Min Pause)` : ""}
${s.notiz ? `<br /><span style="color:#c4b9d5;">${maskiere(s.notiz)}</span>` : ""}
</td></tr>`,
    )
    .join("");

  const html = huelle(`
${kopfBalken("Dein Plan")}
<tr><td style="padding:28px;font-size:15px;line-height:1.7;">
<p style="margin:0 0 16px;">${anrede}</p>
<p style="margin:0 0 24px;">hier ist deine Einteilung für <strong>${maskiere(daten.eventTitel)}</strong> (${daten.wann}${daten.ort ? `, ${maskiere(daten.ort)}` : ""}).</p>

<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border:1px solid #3a1a73;border-radius:3px;margin-bottom:24px;">
${zeilen}
</table>

<table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td style="background:#ffe14a;border-radius:3px;border-right:4px solid #ff8fd6;border-bottom:4px solid #ff8fd6;">
<a href="${daten.planLink}" style="display:inline-block;padding:15px 28px;color:#2a0b5e;text-decoration:none;font-family:'Arial Black','Helvetica Neue',Arial,sans-serif;font-size:13px;font-weight:900;letter-spacing:1px;text-transform:uppercase;">Mein Plan</a>
</td></tr></table>

<p style="margin:24px 0 0;font-size:13px;line-height:1.7;color:#c4b9d5;">
Unter „Mein Plan" steht immer der aktuelle Stand. Wenn sich etwas ändert, gilt das dort.
Passt dir eine Schicht nicht, meld dich einfach.
</p>
</td></tr>`);

  const text = `${anrede}

hier ist deine Einteilung für ${daten.eventTitel} (${daten.wann}${daten.ort ? `, ${daten.ort}` : ""}).

${daten.schichten
  .map(
    (s) =>
      `${s.rolle}${s.station ? ` · ${s.station}` : ""}\n${s.von} – ${s.bis} Uhr · ${s.stunden} Std${s.pauseMin > 0 ? ` (inkl. ${s.pauseMin} Min Pause)` : ""}${s.notiz ? `\n${s.notiz}` : ""}`,
  )
  .join("\n\n")}

Mein Plan: ${daten.planLink}

Dort steht immer der aktuelle Stand.

Lunar Events`;

  return versende({
    an: daten.an,
    betreff: `Dein Plan: ${daten.eventTitel}`,
    html,
    text,
  });
}

export type AbsageMail = {
  an: string;
  vorname: string | null;
  eventTitel: string;
  wann: string;
  /** true = wir zahlen automatisch zurück; false = Vorkasse/Bar, wir melden uns. */
  automatisch: boolean;
};

/**
 * Ein Event fällt aus. Ehrlich sagen, was mit dem Geld passiert — sonst
 * wundert sich jemand über eine Rückbuchung ohne Erklärung.
 */
export async function sendeAbsage(daten: AbsageMail): Promise<boolean> {
  const anredeText = daten.vorname ? `Hallo ${daten.vorname},` : "Hallo,";
  const anrede = daten.vorname ? `Hallo ${maskiere(daten.vorname)},` : "Hallo,";
  const geld = daten.automatisch
    ? "Den vollen Ticketpreis inklusive Gebühren erstatten wir dir automatisch auf dem Weg, auf dem du gezahlt hast. Bis das Geld ankommt, können ein paar Tage vergehen."
    : "Den vollen Ticketpreis inklusive Gebühren zahlen wir dir zurück. Weil du per Überweisung oder bar gezahlt hast, melden wir uns dafür kurz bei dir.";

  const html = huelle(`
${kopfBalken("Abgesagt")}
<tr><td style="padding:28px;font-size:15px;line-height:1.7;">
<p style="margin:0 0 16px;">${anrede}</p>
<p style="margin:0 0 20px;">leider müssen wir <strong>${maskiere(daten.eventTitel)}</strong> (${daten.wann}) absagen. Das tut uns aufrichtig leid.</p>
<p style="margin:0 0 20px;">${geld}</p>
<p style="margin:0;font-size:13px;line-height:1.7;color:#c4b9d5;">Fragen? Antworte einfach auf diese Mail oder schreib an kontakt@lunar-events.de.</p>
</td></tr>`);

  const text = `${anredeText}

leider müssen wir ${daten.eventTitel} (${daten.wann}) absagen. Das tut uns aufrichtig leid.

${geld}

Fragen? Antworte einfach auf diese Mail oder schreib an kontakt@lunar-events.de.

Lunar Events`;

  return versende({
    an: daten.an,
    betreff: `Abgesagt: ${daten.eventTitel}`,
    html,
    text,
  });
}

export type ErinnerungMail = {
  an: string;
  vorname: string | null;
  eventTitel: string;
  /** Beginn, z. B. "Freitag, 14. November, 21:00" */
  wann: string;
  /** Einlasszeit, falls hinterlegt, sonst null (dann gilt der Beginn). */
  einlass: string | null;
  /** "H7 Eventlounge, Kranichsteiner Str. 1, 64390 Darmstadt" */
  ort: string;
  /** Karten-Link, falls Koordinaten vorliegen. */
  karte: string | null;
  dresscode: string | null;
  ticketLink: string;
};

/**
 * Einen Tag vor dem Event: die Tickets noch einmal zur Hand, dazu Einlass,
 * Anfahrt und Dresscode. Der Wallet-Knopf sitzt auf der Ticketseite; hierhin
 * führt der Link.
 */
export async function sendeErinnerung(daten: ErinnerungMail): Promise<boolean> {
  const anredeText = daten.vorname ? `Hallo ${daten.vorname},` : "Hallo,";
  const anrede = daten.vorname ? `Hallo ${maskiere(daten.vorname)},` : "Hallo,";

  const anfahrt = daten.karte
    ? `${maskiere(daten.ort)}<br><a href="${daten.karte}" style="color:#ffe14a;">Route ansehen</a>`
    : maskiere(daten.ort);

  const felder: Array<[string, string]> = [
    ["Wann", daten.wann],
    ...(daten.einlass ? ([["Einlass", daten.einlass]] as Array<[string, string]>) : []),
    ["Wo", anfahrt],
    ...(daten.dresscode ? ([["Dresscode", maskiere(daten.dresscode)]] as Array<[string, string]>) : []),
  ];

  const html = huelle(`
${kopfBalken("Morgen")}
<tr><td style="padding:28px;font-size:15px;line-height:1.7;">
<p style="margin:0 0 16px;">${anrede}</p>
<p style="margin:0 0 20px;">morgen ist es so weit: <strong>${maskiere(daten.eventTitel)}</strong>. Hier noch einmal alles Wichtige und deine Tickets.</p>

${ticketKarte({
  titel: maskiere(daten.eventTitel),
  etikett: "Tickets",
  felder,
  link: daten.ticketLink,
  knopf: "Tickets öffnen",
})}

<p style="margin:0;font-size:13px;line-height:1.7;color:#c4b9d5;">
Auf der Ticketseite kannst du die Tickets auch in Apple Wallet oder Google Wallet legen. Bring den QR-Code mit: gedruckt oder auf dem Handy.
</p>
</td></tr>`);

  const text = `${anredeText}

morgen ist es so weit: ${daten.eventTitel}. Hier noch einmal alles Wichtige und deine Tickets.

Wann: ${daten.wann}${daten.einlass ? `\nEinlass: ${daten.einlass}` : ""}
Wo: ${daten.ort}${daten.karte ? `\nRoute: ${daten.karte}` : ""}${daten.dresscode ? `\nDresscode: ${daten.dresscode}` : ""}

Tickets öffnen: ${daten.ticketLink}

Auf der Ticketseite kannst du die Tickets auch in Apple oder Google Wallet legen. Bring den QR-Code mit.

Lunar Events`;

  return versende({
    an: daten.an,
    betreff: `Morgen: ${daten.eventTitel}`,
    html,
    text,
  });
}

export type ZugangsMail = { an: string; link: string };

/**
 * Der Anmeldelink für Konto und „Meine Tickets“ (auch fürs Team). Bis
 * 01.10.2026 verschickte ihn Supabase selbst: mit der Vorlage aus dem
 * Dashboard statt im Lunar-Look, und über Supabases eigenen Versand, der
 * nur wenige Mails pro Stunde schafft. Der Link führt auf die
 * Zwischenseite `/anmelden`, eingelöst wird erst beim Tippen.
 */
export async function sendeZugangslink(daten: ZugangsMail): Promise<Versandergebnis> {
  const html = huelle(`
${kopfBalken("Dein Zugang")}
<tr><td style="padding:28px;font-size:15px;line-height:1.7;">
<p style="margin:0 0 24px;">Tipp auf den Knopf, dann bist du angemeldet und siehst deine Tickets.</p>

<table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td style="background:#ffe14a;border-radius:3px;border-right:4px solid #ff8fd6;border-bottom:4px solid #ff8fd6;">
<a href="${daten.link}" style="display:inline-block;padding:15px 28px;color:#2a0b5e;text-decoration:none;font-family:'Arial Black','Helvetica Neue',Arial,sans-serif;font-size:13px;font-weight:900;letter-spacing:1px;text-transform:uppercase;">Jetzt anmelden</a>
</td></tr></table>

<p style="margin:24px 0 0;font-size:12px;line-height:1.7;color:#9788b0;">
Der Link gilt eine Stunde und nur einmal. Du hast ihn nicht angefordert? Dann ignoriere diese Mail, ohne Klick passiert nichts.
</p>
</td></tr>`);

  const text = `Tipp auf den Link, dann bist du angemeldet und siehst deine Tickets:

${daten.link}

Der Link gilt eine Stunde und nur einmal. Du hast ihn nicht angefordert? Dann ignoriere diese Mail, ohne Klick passiert nichts.

Lunar Events`;

  return versendeMitGrund({
    an: daten.an,
    betreff: "Dein Anmeldelink für Lunar Events",
    html,
    text,
  });
}

export type NewsletterBestaetigungMail = { an: string; link: string };

/**
 * Double-Opt-in (C7): Erst der Klick auf diesen Link trägt die Adresse
 * verbindlich in den Newsletter ein. Ohne Klick passiert nichts.
 */
export async function sendeNewsletterBestaetigung(
  daten: NewsletterBestaetigungMail,
): Promise<boolean> {
  const html = huelle(`
${kopfBalken("Newsletter")}
<tr><td style="padding:28px;font-size:15px;line-height:1.7;">
<p style="margin:0 0 20px;">fast geschafft. Bestätige mit einem Klick, dass wir dir Neues von Lunar Events schicken dürfen: neue Events, Presale-Starts, hin und wieder etwas hinter den Kulissen.</p>

<table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td style="background:#ffe14a;border-radius:3px;border-right:4px solid #ff8fd6;border-bottom:4px solid #ff8fd6;">
<a href="${daten.link}" style="display:inline-block;padding:15px 28px;color:#2a0b5e;text-decoration:none;font-family:'Arial Black','Helvetica Neue',Arial,sans-serif;font-size:13px;font-weight:900;letter-spacing:1px;text-transform:uppercase;">Anmeldung bestätigen</a>
</td></tr></table>

<p style="margin:24px 0 0;font-size:12px;line-height:1.7;color:#9788b0;">
Du hast dich nicht angemeldet? Dann ignoriere diese Mail. Ohne Klick tragen wir dich nicht ein.
</p>
</td></tr>`);

  const text = `Fast geschafft.

Bestätige mit einem Klick, dass wir dir Neues von Lunar Events schicken dürfen:

${daten.link}

Du hast dich nicht angemeldet? Dann ignoriere diese Mail. Ohne Klick tragen wir dich nicht ein.

Lunar Events`;

  return versende({
    an: daten.an,
    betreff: "Bitte bestätige deine Newsletter-Anmeldung",
    html,
    text,
  });
}

/* ------------------------------------------------------------------ */

export type NewsletterMail = {
  an: string;
  betreff: string;
  /** Vom Team geschrieben: Leerzeile trennt Absätze, Adressen werden Links. */
  text: string;
  /** Optional ein Event, mit Poster und Knopf zu den Tickets. */
  event?: { titel: string; wann: string; ort: string; link: string; bild: string };
  /** Seite mit dem Abmeldeknopf, sichtbar in der Mail. */
  abmeldeLink: string;
  /**
   * Adresse für die Ein-Klick-Abmeldung (RFC 8058): Gmail und Apple Mail
   * zeigen dafür einen eigenen Knopf neben dem Absender.
   */
  einKlickLink: string;
};

/** Text aus dem Backoffice → HTML: maskiert, Absätze, klickbare Adressen. */
function absaetze(roh: string): string {
  return roh
    .trim()
    .split(/\n\s*\n/)
    .map((absatz) => {
      const html = maskiere(absatz.trim())
        .replace(/\n/g, "<br />")
        .replace(
          /https?:\/\/[^\s<]+[^\s<.,;:!?)]/g,
          (url) => `<a href="${url}" style="color:#ffe14a;">${url}</a>`,
        );
      return `<p style="margin:0 0 16px;">${html}</p>`;
    })
    .join("\n");
}

/**
 * Newsletter an eine bestätigte Adresse. Werbung im Sinne von § 7 UWG:
 * nur nach Double-Opt-in (0037), mit Abmeldelink im Text und als
 * List-Unsubscribe-Kopfzeile.
 */
export async function sendeNewsletter(daten: NewsletterMail): Promise<Versandergebnis> {
  const eventBlock = daten.event
    ? `
<tr><td style="padding:0 28px 28px;">
<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border:1px solid #3a1a73;border-radius:3px;overflow:hidden;">
<tr><td><a href="${daten.event.link}"><img src="${daten.event.bild}" width="502" alt="${maskiere(daten.event.titel)}" style="display:block;border:0;width:100%;height:auto;" /></a></td></tr>
<tr><td style="padding:18px;">
<div style="font-family:'Arial Black','Helvetica Neue',Arial,sans-serif;font-size:18px;font-weight:900;text-transform:uppercase;line-height:1.2;">${maskiere(daten.event.titel)}</div>
<div style="margin:6px 0 18px;font-size:14px;color:#c4b9d5;">${maskiere(daten.event.wann)} · ${maskiere(daten.event.ort)}</div>
<table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td style="background:#ffe14a;border-radius:3px;border-right:4px solid #ff8fd6;border-bottom:4px solid #ff8fd6;">
<a href="${daten.event.link}" style="display:inline-block;padding:13px 24px;color:#2a0b5e;text-decoration:none;font-family:'Arial Black','Helvetica Neue',Arial,sans-serif;font-size:13px;font-weight:900;letter-spacing:1px;text-transform:uppercase;">Zu den Tickets</a>
</td></tr></table>
</td></tr></table>
</td></tr>`
    : "";

  const html = huelle(`
${kopfBalken(maskiere(daten.betreff))}
<tr><td style="padding:28px 28px ${daten.event ? "12px" : "28px"};font-size:15px;line-height:1.7;">
${absaetze(daten.text)}
</td></tr>${eventBlock}
<tr><td style="padding:0 28px 24px;font-size:12px;line-height:1.7;color:#9788b0;">
Du bekommst diese Mail, weil du dich für den Newsletter von Lunar Events angemeldet hast.
<a href="${daten.abmeldeLink}" style="color:#c4b9d5;">Abmelden</a>
</td></tr>`);

  const text = `${daten.text.trim()}
${
  daten.event
    ? `
${daten.event.titel}
${daten.event.wann} · ${daten.event.ort}
Tickets: ${daten.event.link}
`
    : ""
}
Lunar Events

Du bekommst diese Mail, weil du dich für den Newsletter von Lunar Events angemeldet hast.
Abmelden: ${daten.abmeldeLink}`;

  return versendeMitGrund({
    an: daten.an,
    betreff: daten.betreff,
    html,
    text,
    kopfzeilen: {
      "List-Unsubscribe": `<${daten.einKlickLink}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  });
}
