-- =====================================================================
-- Figeage automatique des prix fûts sur les SÉMINAIRES
-- ---------------------------------------------------------------------
-- Objectif : dès qu'un fût est consommé sur un séminaire, son prix est figé
-- aux valeurs officielles de la feuille régie (comme sur les matchs), pour
-- une valorisation F&B homogène et reproductible.
--
-- Source de vérité des prix « feuille » : les prix déjà figés sur les matchs
-- (frozen_unit_price_ht). On les recopie dans une table de référence
-- keg_reference_price, puis un trigger BEFORE INSERT/UPDATE applique ce prix
-- à toute ligne fût d'un séminaire — AVANT auto_compute_line_cost, pour que
-- le coût de consommation soit recalculé sur le prix figé.
-- =====================================================================

-- 1) Table de référence des prix fûts (feuille régie) -----------------
create table if not exists public.keg_reference_price (
  product_id uuid primary key references products(product_id),
  price_ht   numeric(10,2) not null,
  updated_at timestamptz default now()
);

comment on table public.keg_reference_price is
  'Prix officiels des fûts (feuille régie), figés sur les séminaires par trigger.';

-- 2) Seed depuis les prix figés sur les matchs (valeur dominante) ------
insert into public.keg_reference_price (product_id, price_ht)
select l.product_id,
       mode() within group (order by l.frozen_unit_price_ht) as price_ht
from event_stock_lines l
join products p on p.product_id = l.product_id
join events e   on e.event_id   = l.event_id
where e.event_type = 'match'
  and p.product_name ilike 'Fût %'
  and l.frozen_unit_price_ht is not null
group by l.product_id
on conflict (product_id) do update
  set price_ht = excluded.price_ht, updated_at = now();

-- 3) Trigger : figer le prix fût sur les lignes de séminaire -----------
create or replace function public.freeze_keg_price_seminaire()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_price numeric; v_type text;
begin
  select event_type into v_type from events where event_id = NEW.event_id;
  if v_type is distinct from 'séminaire' then
    return NEW;
  end if;
  select price_ht into v_price from keg_reference_price where product_id = NEW.product_id;
  if v_price is not null then
    NEW.frozen_unit_price_ht := v_price;   -- prix feuille prioritaire
  end if;
  return NEW;
end $function$;

-- Nom préfixé « trg_00 » pour s'exécuter AVANT trg_auto_compute_line_cost
-- (ordre alphabétique des triggers BEFORE) → le coût utilise le prix figé.
drop trigger if exists trg_00_freeze_keg_seminaire on public.event_stock_lines;
create trigger trg_00_freeze_keg_seminaire
  before insert or update on public.event_stock_lines
  for each row execute function public.freeze_keg_price_seminaire();

-- 4) Backfill : figer les fûts déjà saisis sur des séminaires ---------
do $$
begin
  perform set_config('app.allow_adjustment','on', true);
  update event_stock_lines l
     set frozen_unit_price_ht = r.price_ht
  from keg_reference_price r, events e
  where l.product_id = r.product_id
    and e.event_id = l.event_id
    and e.event_type = 'séminaire'
    and l.frozen_unit_price_ht is distinct from r.price_ht;
end $$;
