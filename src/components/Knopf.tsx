import type { ComponentProps, ReactNode } from "react";
import { Link } from "@/i18n/navigation";
import css from "./Knopf.module.css";

export type KnopfStil =
  | "primaer"
  | "linie"
  | "gold"
  | "hell"
  | "linieHell"
  | "still";

type Gemeinsam = {
  stil?: KnopfStil;
  groesse?: "klein" | "normal" | "gross";
  voll?: boolean;
  children: ReactNode;
};

type AlsKnopf = Gemeinsam &
  Omit<ComponentProps<"button">, "className"> & { href?: never };

type AlsLink = Gemeinsam &
  Omit<ComponentProps<typeof Link>, "className" | "children"> & {
    href: ComponentProps<typeof Link>["href"];
  };

function klassen(
  stil: KnopfStil,
  groesse: "klein" | "normal" | "gross",
  voll: boolean,
) {
  return [
    css.knopf,
    css[stil],
    groesse !== "normal" ? css[groesse] : null,
    voll ? css.voll : null,
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * Ein Knopf, der auch ein Link sein kann — mit href wird ein <a> daraus.
 * Das haelt Aussehen und Verhalten beisammen und verhindert Links, die
 * wie Knoepfe aussehen, aber nicht per Tastatur zu bedienen sind.
 */
export function Knopf(props: AlsKnopf | AlsLink) {
  const {
    stil = "primaer",
    groesse = "normal",
    voll = false,
    children,
    ...rest
  } = props as Gemeinsam & Record<string, unknown>;

  const cls = klassen(stil, groesse, voll);

  if ("href" in props && props.href !== undefined) {
    const { href, ...linkRest } = rest as { href: AlsLink["href"] } & Record<
      string,
      unknown
    >;
    return (
      <Link href={href} className={cls} {...linkRest}>
        {children}
      </Link>
    );
  }

  const { type = "button", ...knopfRest } = rest as Record<string, unknown>;
  return (
    <button type={type as "button" | "submit"} className={cls} {...knopfRest}>
      {children}
    </button>
  );
}
