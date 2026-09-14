import type { ReactNode } from "react";
import css from "@/app/[locale]/backoffice/backoffice.module.css";

/**
 * Die Titelzeile einer Backoffice-Seite. Sie steht bewusst *außerhalb*
 * der Suspense-Grenze: Der Titel weiß nichts von der Datenbank und soll
 * deshalb sofort dastehen, während die Zahlen noch unterwegs sind.
 */
export function BackofficeKopf({
  titel,
  children,
}: {
  titel: string;
  children?: ReactNode;
}) {
  return (
    <div className={css.zeile}>
      <h1 className={css.seitentitel}>{titel}</h1>
      {children}
    </div>
  );
}
