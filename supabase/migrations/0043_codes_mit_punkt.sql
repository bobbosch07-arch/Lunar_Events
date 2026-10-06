-- ============================================================
-- Lunar Events — Punkt in Codes (06.10.2026)
--
-- Promoter-Codes wie „Niklas.R“ oder „lunar.events“. Erlaubt sind jetzt
-- Buchstaben, Ziffern, Bindestrich, Unterstrich und Punkt; das erste
-- Zeichen bleibt ein Buchstabe oder eine Ziffer. Dieselbe Regel steht als
-- CODE_MUSTER in src/lib/rabatt.ts.
-- ============================================================

begin;

alter table rabattcodes drop constraint if exists rabattcodes_code_form;
alter table rabattcodes add constraint rabattcodes_code_form
  check (code ~ '^[A-Z0-9][A-Z0-9._-]{2,31}$');

alter table rabattcodes drop constraint if exists rabattcodes_anzeige;
alter table rabattcodes add constraint rabattcodes_anzeige check (
  code_anzeige is null
  or (upper(code_anzeige) = code and code_anzeige ~ '^[A-Za-z0-9][A-Za-z0-9._-]{2,31}$')
);

commit;

-- ---------- Selbstprüfung ----------
do $$
begin
  insert into rabattcodes (code, code_anzeige, art, wert) values ('SELBST.0043', 'Selbst.0043', 'prozent', 10);
  delete from rabattcodes where code = 'SELBST.0043';

  begin
    insert into rabattcodes (code, art, wert) values ('.SELBST0043', 'prozent', 10);
    raise exception 'Code mit Punkt am Anfang angenommen';
  exception when check_violation then null;
  end;
end $$;
