-- ============================================================
-- Lunar Events — Rabattart „promoter“ (06.10.2026)
--
-- Eigene Datei, weil Postgres einen neuen Wert einer Aufzählung erst
-- benutzen lässt, wenn er festgeschrieben ist. Benutzt wird er in 0042.
-- ============================================================

alter type rabatt_art add value if not exists 'promoter';
