"use client";

import { createBrowserClient } from "@supabase/ssr";

/**
 * Für Komponenten im Browser. Der Publishable Key ist öffentlich — er
 * darf im Quelltext der Seite stehen; alles, was er darf, regeln die
 * Zugriffsregeln in der Datenbank.
 */
export function browserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}
