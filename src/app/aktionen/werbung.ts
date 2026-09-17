"use server";

import { dienstClient, datenbankVerbunden } from "@/lib/supabase/server";

/**
 * Abmelden von Einladungen per Mail (§ 7 Abs. 3 UWG). Der Token stammt aus
 * dem Link in der Einladung — eine Anmeldung braucht es dafür nicht, und
 * das Abmelden muss ohne jede Hürde gehen.
 */
export async function meldeWerbungAb(token: string): Promise<{ ok: boolean }> {
  if (!datenbankVerbunden() || !/^[0-9a-f]{32,128}$/.test(token)) return { ok: false };

  const { data, error } = await dienstClient().rpc("melde_werbung_ab", { p_token: token });
  if (error) {
    console.error("[werbung] Abmelden fehlgeschlagen:", error.message);
    return { ok: false };
  }
  return { ok: data === true };
}
