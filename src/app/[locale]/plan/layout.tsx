import type { ReactNode } from "react";
import { KlassischerLook } from "@/components/KlassischerLook";

/** Werkzeug fürs Personal: bleibt im klassischen Look. */
export default function Layout({ children }: { children: ReactNode }) {
  return (
    <>
      <KlassischerLook />
      {children}
    </>
  );
}
