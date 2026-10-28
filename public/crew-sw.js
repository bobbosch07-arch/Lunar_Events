/*
 * Service Worker der Crew-App (/crew). Sorgt nur dafür, dass die App ohne
 * Netz startet — die Daten (Ticketliste, offene Entscheidungen) liegen in
 * IndexedDB und gehören der App, nicht diesem Speicher.
 *
 * - Die Seite /crew: erst Netz (damit eine neue Fassung sofort ankommt), ohne
 *   Netz oder nach 4 s die gespeicherte.
 * - /_next/static und /crew/*-Bilder: tragen einen Hash im Namen bzw. ändern
 *   sich nie — einmal geladen, bleibt es im Speicher.
 * - Alles andere (Supabase, Server-Aktionen) geht unberührt durch.
 *
 * Liegt im Wurzelverzeichnis, weil ein Worker unter /crew/ den Pfad /crew
 * selbst nicht steuern dürfte.
 */
const SPEICHER = "lunar-crew-v1";
const SEITE = "/crew";

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches
      .open(SPEICHER)
      .then((c) => c.addAll([SEITE, "/crew.webmanifest", "/crew/app-icon-192.png", "/crew/lunar-events-wortmarke.png"]))
      .catch(() => {}),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((namen) => Promise.all(namen.filter((n) => n.startsWith("lunar-crew-") && n !== SPEICHER).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

function mitGrenze(anfrage, ms) {
  return new Promise((fertig, fehler) => {
    const uhr = setTimeout(() => fehler(new Error("zeit")), ms);
    fetch(anfrage).then(
      (r) => {
        clearTimeout(uhr);
        fertig(r);
      },
      (err) => {
        clearTimeout(uhr);
        fehler(err);
      },
    );
  });
}

self.addEventListener("fetch", (e) => {
  const anfrage = e.request;
  if (anfrage.method !== "GET") return;
  const url = new URL(anfrage.url);
  if (url.origin !== self.location.origin) return;

  if (anfrage.mode === "navigate" && (url.pathname === SEITE || url.pathname === SEITE + "/")) {
    e.respondWith(
      mitGrenze(anfrage, 4000)
        .then((antwort) => {
          if (antwort.ok) {
            const kopie = antwort.clone();
            caches.open(SPEICHER).then((c) => c.put(SEITE, kopie));
          }
          return antwort;
        })
        .catch(() => caches.match(SEITE).then((r) => r || Response.error())),
    );
    return;
  }

  if (anfrage.mode !== "navigate" && (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/crew/"))) {
    e.respondWith(
      caches.match(anfrage).then(
        (treffer) =>
          treffer ||
          fetch(anfrage).then((antwort) => {
            if (antwort.ok) {
              const kopie = antwort.clone();
              caches.open(SPEICHER).then((c) => c.put(anfrage, kopie));
            }
            return antwort;
          }),
      ),
    );
  }
});
