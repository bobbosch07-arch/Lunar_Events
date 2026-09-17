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
  const weg = anbieter();
  if (!weg) {
    console.warn(
      `[mail] Nicht verschickt (kein BREVO_API_KEY oder RESEND_API_KEY): "${nachricht.betreff}" an ${nachricht.an}`,
    );
    return false;
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
      return false;
    }
    return true;
  } catch (fehler) {
    // Ein gescheiterter Versand darf niemals einen Kauf scheitern lassen:
    // Das Geld ist geflossen, die Tickets existieren, der Link steht auf
    // der Bestätigungsseite.
    console.error("[mail] Versand fehlgeschlagen:", (fehler as Error).message);
    return false;
  }
}

/* ------------------------------------------------------------------ */

function huelle(inhalt: string): string {
  // Tabellen und Inline-Styles: Mailprogramme verstehen nichts anderes
  // verlässlich. Flexbox und externe Stylesheets fallen aus.
  return `<!doctype html>
<html lang="de"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
</head>
<body style="margin:0;padding:0;background:#f7f5f0;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f5f0;padding:32px 16px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fcfbf8;border:1px solid #e4e0d7;border-radius:8px;overflow:hidden;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;color:#101418;">
${inhalt}
<tr><td style="padding:24px 28px;border-top:1px solid #e4e0d7;background:#f7f5f0;font-size:12px;line-height:1.6;color:#858990;">
Lunar Events · <a href="${eigeneAdresse()}" style="color:#5e6268;">lunar-events.de</a><br />
Fragen? Antworte einfach auf diese Mail.
</td></tr>
</table>
</td></tr></table>
</body></html>`;
}

function kopfBalken(titel: string): string {
  return `<tr><td style="padding:28px;background:#07111f;color:#f8f7f3;">
<div style="font-size:11px;letter-spacing:3px;text-transform:uppercase;color:#d4b873;">Lunar Events</div>
<div style="font-size:24px;font-weight:700;letter-spacing:1px;margin-top:8px;text-transform:uppercase;">${titel}</div>
</td></tr>`;
}

/** Für alles, was ein Gast selbst eingetippt hat und ins HTML einer Mail geht. */
function maskiere(t: string): string {
  return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
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
};

export async function sendeTickets(daten: TicketMail): Promise<boolean> {
  const anrede = daten.vorname ? `Hallo ${daten.vorname},` : "Hallo,";
  const stueck = daten.anzahl === 1 ? "dein Ticket" : `deine ${daten.anzahl} Tickets`;

  const html = huelle(`
${kopfBalken("Tickets sind da")}
<tr><td style="padding:28px;font-size:15px;line-height:1.7;">
<p style="margin:0 0 16px;">${anrede}</p>
<p style="margin:0 0 24px;">hier sind ${stueck} für <strong>${daten.eventTitel}</strong>.</p>

<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border:1px solid #e4e0d7;border-radius:6px;margin-bottom:24px;">
<tr><td style="padding:16px 18px;border-bottom:1px solid #e4e0d7;">
<div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#858990;">Wann</div>
<div style="font-size:15px;margin-top:2px;">${daten.wann}</div></td></tr>
<tr><td style="padding:16px 18px;border-bottom:1px solid #e4e0d7;">
<div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#858990;">Wo</div>
<div style="font-size:15px;margin-top:2px;">${daten.ort}</div></td></tr>
<tr><td style="padding:16px 18px;">
<div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#858990;">Bestellnummer</div>
<div style="font-size:15px;margin-top:2px;">${daten.bestellnummer}</div></td></tr>
</table>

<table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td style="background:#0b1728;border-radius:8px;">
<a href="${daten.ticketLink}" style="display:inline-block;padding:15px 28px;color:#fcfbf8;text-decoration:none;font-size:13px;letter-spacing:2px;text-transform:uppercase;">Tickets öffnen</a>
</td></tr></table>

<p style="margin:24px 0 0;font-size:13px;line-height:1.7;color:#5e6268;">
${
  daten.paesse?.length
    ? "Im Anhang liegen deine Pässe für Apple Wallet — einmal antippen, dann liegen sie auf dem Sperrbildschirm, sobald du am Veranstaltungsort bist.<br /><br />"
    : ""
}Der Link führt zu deinen Tickets mit QR-Code — am besten gleich speichern.
Wer den Link hat, kommt rein: gib ihn nur an Leute weiter, denen du vertraust.
</p>
</td></tr>`);

  const text = `${anrede}

hier sind ${stueck} für ${daten.eventTitel}.

Wann: ${daten.wann}
Wo: ${daten.ort}
Bestellnummer: ${daten.bestellnummer}

Tickets öffnen: ${daten.ticketLink}

Wer den Link hat, kommt rein — gib ihn nur an Leute weiter, denen du vertraust.

Lunar Events`;

  return versende({
    an: daten.an,
    betreff: `${daten.eventTitel} — ${stueck.charAt(0).toUpperCase()}${stueck.slice(1)}`,
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
<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border:1px solid #e4e0d7;border-radius:6px;">
${zeilen
  .map(
    ([name, wert]) =>
      `<tr><td style="padding:12px 18px;border-bottom:1px solid #e4e0d7;width:110px;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#858990;">${name}</td><td style="padding:12px 18px;border-bottom:1px solid #e4e0d7;font-size:15px;">${wert}</td></tr>`,
  )
  .join("")}
</table>
${
  daten.nachricht
    ? `<p style="margin:20px 0 0;padding:16px 18px;background:#f7f5f0;border-radius:6px;font-size:14px;line-height:1.7;">${daten.nachricht.replace(/</g, "&lt;")}</p>`
    : ""
}
<p style="margin:24px 0 0;font-size:13px;color:#5e6268;">
Im Formular steht „innerhalb von 24 Stunden“ — das ist eine Zusage.
<br /><a href="${eigeneAdresse()}/backoffice/vip" style="color:#101418;">Im Backoffice bearbeiten</a>
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
<p style="margin:0 0 24px;">du warst schon bei uns — deshalb kommst du vor allen anderen an Tickets für <strong>${maskiere(daten.eventTitel)}</strong>.</p>

<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border:1px solid #e4e0d7;border-radius:6px;margin-bottom:24px;">
<tr><td style="padding:16px 18px;border-bottom:1px solid #e4e0d7;">
<div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#858990;">Wann</div>
<div style="font-size:15px;margin-top:2px;">${daten.wann}</div></td></tr>
<tr><td style="padding:16px 18px;">
<div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#858990;">Öffentlicher Verkauf</div>
<div style="font-size:15px;margin-top:2px;">ab ${daten.oeffentlichAb}</div></td></tr>
</table>

<table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td style="background:#0b1728;border-radius:8px;">
<a href="${daten.link}" style="display:inline-block;padding:15px 28px;color:#fcfbf8;text-decoration:none;font-size:13px;letter-spacing:2px;text-transform:uppercase;">Zum Presale</a>
</td></tr></table>

<p style="margin:24px 0 0;font-size:13px;line-height:1.7;color:#5e6268;">
Der Link ist persönlich und gilt nur mit dieser Mailadresse (${daten.an}).
</p>
<p style="margin:16px 0 0;font-size:12px;line-height:1.7;color:#858990;">
Du bekommst diese Mail, weil du bei Lunar Events Tickets gekauft hast.
Keine Einladungen mehr? <a href="${daten.abmeldeLink}" style="color:#5e6268;">Hier abbestellen</a>.
</p>
</td></tr>`);

  const text = `${anredeText}

du warst schon bei uns — deshalb kommst du vor allen anderen an Tickets für ${daten.eventTitel}.

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
<p style="margin:0 0 24px;">du möchtest auf die Warteliste für <strong>${maskiere(daten.eventTitel)}</strong> (${daten.wann}) — für ${stueck}. Bestätige das mit einem Klick, erst dann stehst du drauf.</p>

<table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td style="background:#0b1728;border-radius:8px;">
<a href="${daten.link}" style="display:inline-block;padding:15px 28px;color:#fcfbf8;text-decoration:none;font-size:13px;letter-spacing:2px;text-transform:uppercase;">Eintrag bestätigen</a>
</td></tr></table>

<p style="margin:24px 0 0;font-size:13px;line-height:1.7;color:#5e6268;">
Wird etwas frei, schreiben wir dir. Dann hast du ${ANGEBOT_STUNDEN} Stunden Zeit zum Kaufen.
</p>
<p style="margin:16px 0 0;font-size:12px;line-height:1.7;color:#858990;">
Du hast dich nicht eingetragen? Dann ignoriere diese Mail — ohne Klick passiert nichts.
</p>
</td></tr>`);

  const text = `${anredeText}

du möchtest auf die Warteliste für ${daten.eventTitel} (${daten.wann}) — für ${stueck}. Bestätige das mit einem Klick, erst dann stehst du drauf:

${daten.link}

Wird etwas frei, schreiben wir dir. Dann hast du ${ANGEBOT_STUNDEN} Stunden Zeit zum Kaufen.

Du hast dich nicht eingetragen? Dann ignoriere diese Mail — ohne Klick passiert nichts.

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

<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border:1px solid #e4e0d7;border-radius:6px;margin-bottom:24px;">
<tr><td style="padding:16px 18px;border-bottom:1px solid #e4e0d7;">
<div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#858990;">Wann</div>
<div style="font-size:15px;margin-top:2px;">${daten.wann}</div></td></tr>
<tr><td style="padding:16px 18px;border-bottom:1px solid #e4e0d7;">
<div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#858990;">Wo</div>
<div style="font-size:15px;margin-top:2px;">${maskiere(daten.ort)}</div></td></tr>
<tr><td style="padding:16px 18px;">
<div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#858990;">Reserviert bis</div>
<div style="font-size:15px;margin-top:2px;"><strong>${daten.bis} Uhr</strong></div></td></tr>
</table>

<table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td style="background:#0b1728;border-radius:8px;">
<a href="${daten.kaufLink}" style="display:inline-block;padding:15px 28px;color:#fcfbf8;text-decoration:none;font-size:13px;letter-spacing:2px;text-transform:uppercase;">Jetzt kaufen</a>
</td></tr></table>

<p style="margin:24px 0 0;font-size:13px;line-height:1.7;color:#5e6268;">
Danach gehen die Tickets an den Nächsten auf der Liste.
Doch keine Zeit? <a href="${daten.freigebenLink}" style="color:#5e6268;">Tickets freigeben</a> — dann ist der Nächste gleich dran.
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
        ? " — mit einer Begleitung"
        : ` — mit ${daten.personen - 1} Begleitungen`;

  const html = huelle(`
${kopfBalken("Gästeliste")}
<tr><td style="padding:28px;font-size:15px;line-height:1.7;">
<p style="margin:0 0 16px;">Hallo ${name},</p>
<p style="margin:0 0 24px;">du stehst auf der Gästeliste für <strong>${maskiere(daten.eventTitel)}</strong>${mit}.</p>

<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border:1px solid #e4e0d7;border-radius:6px;margin-bottom:24px;">
<tr><td style="padding:16px 18px;border-bottom:1px solid #e4e0d7;">
<div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#858990;">Wann</div>
<div style="font-size:15px;margin-top:2px;">${daten.wann}</div></td></tr>
<tr><td style="padding:16px 18px;">
<div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#858990;">Wo</div>
<div style="font-size:15px;margin-top:2px;">${maskiere(daten.ort)}</div></td></tr>
</table>

<table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td style="background:#0b1728;border-radius:8px;">
<a href="${daten.ticketLink}" style="display:inline-block;padding:15px 28px;color:#fcfbf8;text-decoration:none;font-size:13px;letter-spacing:2px;text-transform:uppercase;">${daten.personen === 1 ? "QR-Code öffnen" : "QR-Codes öffnen"}</a>
</td></tr></table>

<p style="margin:24px 0 0;font-size:13px;line-height:1.7;color:#5e6268;">
${daten.personen === 1 ? "Zeig den Code am Einlass." : "Jede Person braucht ihren eigenen Code — schick deiner Begleitung den Link oder zeigt die Codes nacheinander."}
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
<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border:1px solid #e4e0d7;border-radius:6px;">
${zeilen
  .map(
    ([name, wert]) =>
      `<tr><td style="padding:12px 18px;border-bottom:1px solid #e4e0d7;width:80px;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#858990;">${name}</td><td style="padding:12px 18px;border-bottom:1px solid #e4e0d7;font-size:15px;">${maskiere(wert)}</td></tr>`,
  )
  .join("")}
</table>
<p style="margin:24px 0 0;font-size:13px;line-height:1.7;color:#5e6268;">
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
      (s) => `<tr><td style="padding:14px 18px;border-bottom:1px solid #e4e0d7;font-size:15px;">
<strong>${maskiere(s.rolle)}</strong>${s.station ? ` · ${maskiere(s.station)}` : ""}<br />
${s.von} – ${s.bis} Uhr · ${s.stunden.toString().replace(".", ",")} Std${s.pauseMin > 0 ? ` (inkl. ${s.pauseMin} Min Pause)` : ""}
${s.notiz ? `<br /><span style="color:#5e6268;">${maskiere(s.notiz)}</span>` : ""}
</td></tr>`,
    )
    .join("");

  const html = huelle(`
${kopfBalken("Dein Plan")}
<tr><td style="padding:28px;font-size:15px;line-height:1.7;">
<p style="margin:0 0 16px;">${anrede}</p>
<p style="margin:0 0 24px;">hier ist deine Einteilung für <strong>${maskiere(daten.eventTitel)}</strong> (${daten.wann}${daten.ort ? `, ${maskiere(daten.ort)}` : ""}).</p>

<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border:1px solid #e4e0d7;border-radius:6px;margin-bottom:24px;">
${zeilen}
</table>

<table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td style="background:#0b1728;border-radius:8px;">
<a href="${daten.planLink}" style="display:inline-block;padding:15px 28px;color:#fcfbf8;text-decoration:none;font-size:13px;letter-spacing:2px;text-transform:uppercase;">Mein Plan</a>
</td></tr></table>

<p style="margin:24px 0 0;font-size:13px;line-height:1.7;color:#5e6268;">
Unter „Mein Plan" steht immer der aktuelle Stand — wenn sich etwas ändert, gilt das dort.
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
