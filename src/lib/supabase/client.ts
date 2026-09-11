"use client";

import { createBrowserClient } from "@supabase/ssr";
import { SUPABASE_URL, SUPABASE_OEFFENTLICH } from "./umgebung";

/**
 * Für Komponenten im Browser. Der Publishable Key ist öffentlich — er
 * darf im Quelltext der Seite stehen; alles, was er darf, regeln die
 * Zugriffsregeln in der Datenbank.
 */
export function browserClient() {
  return createBrowserClient(SUPABASE_URL!, SUPABASE_OEFFENTLICH!);
}
