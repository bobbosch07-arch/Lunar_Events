"use client";

import { useLinkStatus } from "next/link";
import { Link, usePathname } from "@/i18n/navigation";
import css from "@/app/[locale]/backoffice/backoffice.module.css";

const ZIELE = [
  { href: "/backoffice", name: "Übersicht" },
  { href: "/backoffice/events", name: "Events" },
  { href: "/backoffice/bestellungen", name: "Bestellungen" },
  { href: "/backoffice/rabattcodes", name: "Rabattcodes" },
  { href: "/backoffice/promoter", name: "Promoter" },
  { href: "/backoffice/gaesteliste", name: "Gästeliste" },
  { href: "/backoffice/schichtplan", name: "Schichtplan" },
  { href: "/backoffice/vip", name: "VIP" },
  { href: "/backoffice/auswertung", name: "Auswertung" },
  { href: "/backoffice/hochrechnung", name: "Hochrechnung" },
  { href: "/backoffice/zugang", name: "Mein Zugang" },
] as const;

/**
 * Die Reiter sind bewusst eine Client-Komponente.
 *
 * Nicht wegen `usePathname` — der weiß es genauso spät wie der Server,
 * nämlich erst, wenn die Navigation fertig ist. Der Punkt ist
 * `useLinkStatus`: Es sagt *während* des Klicks, dass dieser Reiter
 * gerade lädt. Daran hängt die Optik (siehe `:has([data-laeuft])` im
 * Stylesheet) — der angeklickte Reiter sieht sofort aktiv aus, der alte
 * tritt zurück. Ohne das wirkte ein Klick auf eine Abfrage, die eine
 * Sekunde braucht, schlicht wie ein verschluckter Klick.
 */
export function BackofficeReiter() {
  const pfad = usePathname();

  return (
    <nav className={css.reiter}>
      {ZIELE.map((z) => {
        const aktiv = z.href === "/backoffice" ? pfad === z.href : pfad.startsWith(z.href);
        return (
          <Link
            key={z.href}
            href={z.href}
            prefetch
            aria-current={aktiv ? "page" : undefined}
            className={aktiv ? css.reiterAktiv : undefined}
          >
            {z.name}
            <Ladepunkt />
          </Link>
        );
      })}
      <Link href="/plan">Mein Plan</Link>
      <Link href="/kasse">Kasse</Link>
      <Link href="/einlass">Einlass</Link>
      <Link href="/">Zur Website</Link>
    </nav>
  );
}

/** Nur innerhalb eines Link gültig: sagt, ob dieser Klick noch läuft. */
function Ladepunkt() {
  const { pending } = useLinkStatus();
  return <span className={css.ladepunkt} data-laeuft={pending || undefined} aria-hidden="true" />;
}
