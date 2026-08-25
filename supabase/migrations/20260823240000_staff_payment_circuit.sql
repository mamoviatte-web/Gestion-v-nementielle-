-- Paie DAF — circuit de paiement par personne/mois (franchise / contrat)
-- ============================================================================
-- Le récap de paie mensuel doit permettre de cocher chaque personne en
-- « Franchise » (à facturer, taux de base) ou « Contrat » (paie). Le format
-- CONTRAT porte directement le taux horaire à 18 €/h.
--
-- total_cost (occasional_hours) et rh_cost (zone_staff_hours) sont des colonnes
-- GÉNÉRÉES à partir de hourly_rate → on agit donc sur hourly_rate. Pour rester
-- réversible (contrat ⇄ franchise), on mémorise le taux d'origine dans
-- base_hourly_rate (capturé une seule fois). Franchise = restaure base_hourly_rate ;
-- Contrat = 18. Le coût se recalcule automatiquement (colonne générée), et le
-- récap rh_monthly_hours (qui somme ces coûts) se met à jour tout seul.

alter table occasional_hours  add column if not exists base_hourly_rate numeric;
alter table zone_staff_hours  add column if not exists base_hourly_rate numeric;

create or replace function public.set_staff_payment_circuit(
  p_staff text, p_mois text, p_type text
) returns void
  language plpgsql security definer set search_path to 'public'
as $$
begin
  if not is_stade() then
    raise exception 'Réservé ROLE_STADE';
  end if;
  if p_type not in ('franchise','contrat') then
    raise exception 'Type de circuit invalide : %', p_type;
  end if;

  -- Heures ponctuelles / hors espace (total_cost = généré depuis hourly_rate)
  update occasional_hours o
     set base_hourly_rate = coalesce(o.base_hourly_rate, o.hourly_rate),
         hourly_rate = case when p_type = 'contrat'
                            then 18
                            else coalesce(o.base_hourly_rate, o.hourly_rate) end,
         payment_type = p_type
   where o.staff_name = p_staff
     and to_char(coalesce((select e.event_date from events e where e.event_id = o.event_id),
                          o.work_date)::timestamptz, 'YYYY-MM') = p_mois;

  -- Heures en zone (matchs / séminaires ; rh_cost = généré depuis hourly_rate)
  update zone_staff_hours z
     set base_hourly_rate = coalesce(z.base_hourly_rate, z.hourly_rate),
         hourly_rate = case when p_type = 'contrat'
                            then 18
                            else coalesce(z.base_hourly_rate, z.hourly_rate) end,
         payment_type = p_type
   where z.staff_name = p_staff
     and to_char(coalesce((select e.event_date from events e where e.event_id = z.event_id),
                          current_date)::timestamptz, 'YYYY-MM') = p_mois;
end $$;

grant execute on function public.set_staff_payment_circuit(text, text, text) to authenticated;
