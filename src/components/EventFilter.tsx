import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import css from "./EventFilter.module.css";

type Props = {
  kategorien: string[];
  gewaehlt: string | null;
};

/**
 * Bewusst Links statt Knöpfe mit Zustand: der Filter steht damit in der
 * Adresse, überlebt einen Neuladen, lässt sich teilen und braucht kein
 * JavaScript. Die Seite bleibt statisch auslieferbar.
 */
export function EventFilter({ kategorien, gewaehlt }: Props) {
  const t = useTranslations("events");

  return (
    <nav className={css.leiste} aria-label={t("filterLabel")}>
      <Link
        href="/events"
        className={`${css.punkt} ${gewaehlt === null ? css.aktiv : ""}`}
        aria-current={gewaehlt === null ? "page" : undefined}
      >
        {t("filterAlle")}
      </Link>
      {kategorien.map((kat) => (
        <Link
          key={kat}
          href={`/events?k=${kat}`}
          className={`${css.punkt} ${gewaehlt === kat ? css.aktiv : ""}`}
          aria-current={gewaehlt === kat ? "page" : undefined}
        >
          {kat}
        </Link>
      ))}
    </nav>
  );
}
