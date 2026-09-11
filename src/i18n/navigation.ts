import { createNavigation } from "next-intl/navigation";
import { routing } from "./routing";

/**
 * Diese Huellen statt der Originale aus next/link und next/navigation
 * benutzen — sie haengen die Sprache automatisch an die Adresse.
 */
export const { Link, redirect, usePathname, useRouter, getPathname } =
  createNavigation(routing);
