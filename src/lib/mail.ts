import { eigeneAdresse } from "./stripe";

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

  const ziel = process.env.MAIL_TEAM ?? "lunar.eventsss.de@gmail.com";

  return versende({
    an: ziel,
    betreff: `VIP-Anfrage: ${daten.name} (${daten.gaeste} Gäste)`,
    html,
    text,
    // Antworten gehen direkt an den Gast.
    antwortAn: daten.email,
  });
}
