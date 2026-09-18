"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { StripeZahlung } from "./StripeZahlung";
import css from "./Checkout.module.css";

/**
 * Zahlen an der Abendkasse, am eigenen Handy (0025). Eine Zustimmung statt
 * zwei: Der Gast steht an der Tür, und für Veranstaltungstickets gibt es
 * ohnehin kein Widerrufsrecht — beides steht in einem Satz.
 */
export function TuerZahlung({
  bestellungId,
  token,
  rueckkehr,
}: {
  bestellungId: string;
  token: string;
  rueckkehr: string;
}) {
  const t = useTranslations("tuer");
  const [zugestimmt, setZugestimmt] = useState(false);

  return (
    <>
      <div className={css.zustimmungen}>
        <label className={css.zustimmung}>
          <input
            type="checkbox"
            checked={zugestimmt}
            onChange={(e) => setZugestimmt(e.target.checked)}
          />
          <span>
            {t.rich("zustimmung", {
              agb: (teil) => <Link href="/agb">{teil}</Link>,
              datenschutz: (teil) => <Link href="/datenschutz">{teil}</Link>,
            })}
          </span>
        </label>
      </div>
      <StripeZahlung
        bestellungId={bestellungId}
        tuerToken={token}
        rueckkehr={rueckkehr}
        freigegeben={zugestimmt}
      />
    </>
  );
}
