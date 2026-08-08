-- 20260707090056 — RG-003 : get_fut_analysis expose des coûts (cout_ht) →
-- révoquer l'EXECUTE PUBLIC (accordé par défaut par Postgres) et anon.
-- (La fonction get_fut_analysis elle-même a été déployée hors de ces migrations.)
revoke execute on function get_fut_analysis(text) from public;
revoke execute on function get_fut_analysis(text) from anon;
grant  execute on function get_fut_analysis(text) to authenticated;
