-- 20260707090057 — RG-003 : get_match_report / get_seminaire_report exposent des
-- coûts → révoquer l'EXECUTE PUBLIC (accordé par défaut) et anon.
-- (Les fonctions elles-mêmes ont été déployées hors de ces migrations.)
revoke execute on function get_match_report(uuid) from public;
revoke execute on function get_match_report(uuid) from anon;
grant  execute on function get_match_report(uuid) to authenticated;
revoke execute on function get_seminaire_report(uuid) from public;
revoke execute on function get_seminaire_report(uuid) from anon;
grant  execute on function get_seminaire_report(uuid) to authenticated;
