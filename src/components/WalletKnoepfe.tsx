import css from "./WalletKnoepfe.module.css";

type Props = {
  code: string;
  zugangstoken: string;
  apple: boolean;
  google: boolean;
};

/**
 * „Zu Wallet hinzufügen" — aber nur für die Anbieter, die auch
 * eingerichtet sind. Ein Knopf, der zu einer Fehlermeldung führt, ist
 * schlimmer als gar keiner.
 */
export function WalletKnoepfe({ code, zugangstoken, apple, google }: Props) {
  if (!apple && !google) return null;

  const abfrage = `?code=${encodeURIComponent(code)}&t=${encodeURIComponent(zugangstoken)}`;

  return (
    <div className={css.reihe}>
      {apple ? (
        <a className={css.knopf} href={`/api/wallet/apple${abfrage}`}>
          <svg
            className={css.zeichen}
            width="14"
            height="17"
            viewBox="0 0 14 17"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M11.6 9c0-1.7 1.4-2.6 1.5-2.6-.8-1.2-2.1-1.3-2.5-1.4-1.1-.1-2.1.6-2.6.6-.5 0-1.4-.6-2.3-.6-1.2 0-2.3.7-2.9 1.8-1.2 2.1-.3 5.3.9 7 .6.8 1.3 1.8 2.2 1.7.9 0 1.2-.6 2.3-.6 1 0 1.3.6 2.3.5 1 0 1.6-.8 2.2-1.7.7-1 1-1.9 1-2-.1 0-1.9-.7-2.1-2.7zM9.9 3.5c.5-.6.8-1.4.7-2.3-.7 0-1.6.5-2.1 1.1-.5.5-.9 1.4-.7 2.2.8.1 1.6-.4 2.1-1z" />
          </svg>
          Zu Apple Wallet
        </a>
      ) : null}

      {google ? (
        <a className={css.knopf} href={`/api/wallet/google${abfrage}`}>
          <svg
            className={css.zeichen}
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            aria-hidden="true"
          >
            <rect x="2.5" y="5" width="19" height="14" rx="3" />
            <path d="M2.5 10h19" />
          </svg>
          Zu Google Wallet
        </a>
      ) : null}
    </div>
  );
}
