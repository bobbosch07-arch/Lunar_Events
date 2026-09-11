import QRCode from "qrcode";
import { Logo } from "./Logo";
import css from "./TicketKarte.module.css";

export type TicketAnzeige = {
  code: string;
  phase_name: string;
  art: "standard" | "vip";
  status: "gueltig" | "entwertet" | "storniert";
  gast_name: string | null;
  platz: string | null;
  event_titel: string;
  event_wann: string;
  event_ort: string;
  bestellnummer: string;
};

/**
 * Der QR wird auf dem Server gezeichnet und als SVG ausgeliefert: keine
 * Bibliothek im Browser, gestochen scharf auf jedem Display, und er steht
 * sofort da — am Einlass will niemand auf ein Nachladen warten.
 *
 * Fehlerkorrektur "M": verträgt einen Fingerabdruck auf dem Display,
 * ohne den Code unnötig dicht zu machen.
 */
async function qrSvg(inhalt: string): Promise<string> {
  return QRCode.toString(inhalt, {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 0,
    color: { dark: "#07111f", light: "#0000" },
  });
}

export async function TicketKarte({ ticket }: { ticket: TicketAnzeige }) {
  const svg = await qrSvg(ticket.code);
  const entwertet = ticket.status !== "gueltig";

  return (
    <article
      className={`${css.ticket} ${ticket.art === "vip" ? css.vip : ""} ${
        entwertet ? css.entwertet : ""
      }`}
      data-grund="dunkel"
    >
      <div className={css.kopf}>
        <Logo ton="ivory" hoehe={26} />
        <span
          className={`${css.typ} ${ticket.art === "vip" ? css.typVip : ""} ${
            entwertet ? css.entwertetMarke : ""
          }`}
        >
          {ticket.status === "entwertet"
            ? "Eingelöst"
            : ticket.status === "storniert"
              ? "Storniert"
              : ticket.platz
                ? `${ticket.phase_name} · ${ticket.platz}`
                : ticket.phase_name}
        </span>
      </div>

      <div className={css.koerper}>
        <h3 className={css.event}>{ticket.event_titel}</h3>
        <div className={css.daten}>
          <div className={css.datenfeld}>
            <span className={css.datenName}>Datum</span>
            <span className={css.datenWert}>{ticket.event_wann}</span>
          </div>
          <div className={css.datenfeld}>
            <span className={css.datenName}>Ort</span>
            <span className={css.datenWert}>{ticket.event_ort}</span>
          </div>
          {ticket.gast_name ? (
            <div className={css.datenfeld}>
              <span className={css.datenName}>Gast</span>
              <span className={css.datenWert}>{ticket.gast_name}</span>
            </div>
          ) : null}
          <div className={css.datenfeld}>
            <span className={css.datenName}>Bestellung</span>
            <span className={css.datenWert}>{ticket.bestellnummer}</span>
          </div>
        </div>
      </div>

      <div className={css.fuss}>
        <div
          className={css.code}
          // Das SVG stammt aus der QR-Bibliothek auf dem Server, nicht aus
          // einer Eingabe — hier fließt kein fremder Text ein.
          dangerouslySetInnerHTML={{ __html: svg }}
          role="img"
          aria-label={`Ticketcode ${ticket.code}`}
        />
        <div className={css.fusstext}>
          <p className={css.hinweis}>
            Am Einlass scannen lassen.
            <br />
            Helligkeit hochdrehen.
          </p>
          <p className={css.nummer}>{ticket.code}</p>
        </div>
      </div>
    </article>
  );
}
