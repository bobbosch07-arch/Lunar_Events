import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { BackofficeKopf } from "@/components/BackofficeKopf";
import { PasswortSetzen } from "@/components/PasswortSetzen";
import { ZweiFaktor } from "@/components/ZweiFaktor";
import { serverClient } from "@/lib/supabase/server";
import css from "../backoffice.module.css";

export const metadata: Metadata = {
  title: "Mein Zugang",
  robots: { index: false, follow: false },
};

export default async function Zugang({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const db = await serverClient();
  const { data } = await db.auth.getUser();
  const nutzer = data.user;

  return (
    <>
      <BackofficeKopf titel="Mein Zugang" />
      <p className={css.notiz} style={{ marginTop: 0, marginBottom: "1.5rem" }}>
        Angemeldet als <strong>{nutzer?.email}</strong>.
      </p>
      <PasswortSetzen
        hatPasswort={Boolean(nutzer?.user_metadata?.passwort_gesetzt)}
        email={nutzer?.email}
      />
      <div style={{ marginTop: "1.5rem" }}>
        <ZweiFaktor art="verwalten" />
      </div>
    </>
  );
}
