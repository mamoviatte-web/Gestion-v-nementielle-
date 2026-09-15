-- =====================================================================
-- STOCK — SOCLE DE PRÉCISION (Chantier 1 + 2 + Audits)  — ADDITIF, SANS RISQUE
-- ---------------------------------------------------------------------
-- Objectif : faire du JOURNAL la source de vérité et rendre le solde
-- DÉRIVABLE et AUDITABLE, pour dépôts ET espaces (le stock initial gardé
-- dans les espaces = 2 621 u compte autant que la réserve).
--
-- Constat qui impose ce socle :
--   • stock_balances.current_quantity = compteur mutable (peut dériver).
--   • reconcile_stock_balances() est FAUX (ignore 'sortie', 'retour_fournisseur',
--     l'ancrage 'inventaire'…).
--   • le type 'inventaire' est SURCHARGÉ (ancre absolue OU correction négative,
--     ex. −4826 sur AUC) → inexploitable comme ancre fiable.
--
-- Solution : une table d'ancrage PROPRE (comptages physiques absolus) +
--   SOLDE_dérivé(produit, emplacement) = dernière ancre + Σ flux DEPUIS l'ancre
--   (crédité si to_location = emplacement, débité si from_location = emplacement ;
--    le type 'inventaire' historique est EXCLU des flux — l'ancre le remplace).
--
-- Rien n'est branché en écriture ici : les triggers live continuent de tenir
-- stock_balances. Ce socle OBSERVE (vue dérivée + audits) et fournit le
-- ré-ancrage (chantier 2). On bascule la source de vérité plus tard, en confiance.
-- =====================================================================

-- ── Chantier 2 : table d'ancrage (comptages physiques absolus) ───────────
create table if not exists public.stock_inventory_counts (
  id           uuid primary key default gen_random_uuid(),
  location_id  uuid not null references stock_locations(id),
  product_id   uuid not null references products(product_id),
  counted_qty  numeric not null check (counted_qty >= 0),
  counted_at   timestamptz not null default now(),
  counted_by   text,
  note         text,
  source       text default 'comptage',   -- 'comptage' | 'reprise_initiale'
  created_at   timestamptz default now()
);
create index if not exists idx_sic_loc_prod_at
  on public.stock_inventory_counts(location_id, product_id, counted_at desc);

-- Dernière ancre par (emplacement, produit)
create or replace view public.v_stock_anchor as
select distinct on (location_id, product_id)
  location_id, product_id, counted_qty as anchor_qty, counted_at as anchor_at
from public.stock_inventory_counts
order by location_id, product_id, counted_at desc;

-- ── Chantier 1 : SOLDE DÉRIVÉ (le journal fait foi) ──────────────────────
-- Une ligne par (produit, emplacement) apparaissant en solde, en mouvement,
-- ou en ancre. derived_qty = ancre + flux_in − flux_out (flux STRICTEMENT
-- après l'ancre ; type 'inventaire' exclu). counter_qty = compteur actuel.
create or replace view public.v_stock_ledger_balance as
with keys as (
  select product_id, location_id from public.stock_balances
  union select product_id, to_location_id   from public.stock_movements where to_location_id   is not null
  union select product_id, from_location_id from public.stock_movements where from_location_id is not null
  union select product_id, location_id from public.stock_inventory_counts
)
select
  k.product_id,
  k.location_id,
  l.name                       as location_name,
  l.location_type,
  coalesce(a.anchor_qty, 0)    as anchor_qty,
  a.anchor_at,
  coalesce((
    select sum(m.qty) from public.stock_movements m
     where m.product_id = k.product_id and m.to_location_id = k.location_id
       and m.movement_type <> 'inventaire'
       and (a.anchor_at is null or m.created_at > a.anchor_at)
  ), 0)                        as flux_in,
  coalesce((
    select sum(m.qty) from public.stock_movements m
     where m.product_id = k.product_id and m.from_location_id = k.location_id
       and m.movement_type <> 'inventaire'
       and (a.anchor_at is null or m.created_at > a.anchor_at)
  ), 0)                        as flux_out,
  coalesce(a.anchor_qty, 0)
    + coalesce((select sum(m.qty) from public.stock_movements m
        where m.product_id=k.product_id and m.to_location_id=k.location_id
          and m.movement_type <> 'inventaire'
          and (a.anchor_at is null or m.created_at > a.anchor_at)), 0)
    - coalesce((select sum(m.qty) from public.stock_movements m
        where m.product_id=k.product_id and m.from_location_id=k.location_id
          and m.movement_type <> 'inventaire'
          and (a.anchor_at is null or m.created_at > a.anchor_at)), 0)
                               as derived_qty,
  coalesce(sb.current_quantity, 0) as counter_qty
from keys k
join public.stock_locations l on l.id = k.location_id
left join public.v_stock_anchor a on a.product_id = k.product_id and a.location_id = k.location_id
left join public.stock_balances sb on sb.product_id = k.product_id and sb.location_id = k.location_id;

-- ── Audits (lecture seule) ───────────────────────────────────────────────
-- A1 : écarts compteur vs dérivé (le cœur : doit être 0 une fois ancré)
create or replace view public.v_stock_audit_ecarts as
select product_id, location_id, location_name, location_type,
       anchor_qty, anchor_at, flux_in, flux_out, derived_qty, counter_qty,
       (counter_qty - derived_qty) as ecart
from public.v_stock_ledger_balance
where counter_qty <> derived_qty;

-- A2 : soldes négatifs (compteur OU dérivé < 0 = manque réel masqué)
create or replace view public.v_stock_audit_negatifs as
select product_id, location_id, location_name, location_type, derived_qty, counter_qty
from public.v_stock_ledger_balance
where counter_qty < 0 or derived_qty < 0;

-- A3 : mouvements « fantômes » — une sortie/réassort sans ligne de solde source
create or replace view public.v_stock_audit_sorties_fantomes as
select m.movement_id, m.event_id, m.product_id, m.from_location_id,
       l.name as depot, m.movement_type, m.qty, m.created_at
from public.stock_movements m
left join public.stock_locations l on l.id = m.from_location_id
left join public.stock_balances sb on sb.product_id=m.product_id and sb.location_id=m.from_location_id
where m.movement_type in ('sortie','réassort_événement','retour_fournisseur')
  and m.from_location_id is not null
  and sb.product_id is null;

-- A4 : synthèse par emplacement (tableau de bord)
create or replace view public.v_stock_audit_synthese as
select location_name, location_type,
       count(*)                                   as refs,
       count(*) filter (where counter_qty <> derived_qty) as refs_en_ecart,
       count(*) filter (where counter_qty < 0 or derived_qty < 0) as refs_negatives,
       round(sum(abs(counter_qty - derived_qty)))  as ecart_abs_total,
       count(*) filter (where anchor_at is null)   as refs_sans_ancre,
       max(anchor_at)                              as derniere_ancre
from public.v_stock_ledger_balance
group by location_name, location_type
order by location_type, location_name;

-- ── RG-003 : réservé équipe stade (jamais anon) ─────────────────────────
grant select on public.stock_inventory_counts, public.v_stock_anchor,
  public.v_stock_ledger_balance, public.v_stock_audit_ecarts,
  public.v_stock_audit_negatifs, public.v_stock_audit_sorties_fantomes,
  public.v_stock_audit_synthese to authenticated;
revoke select on public.stock_inventory_counts, public.v_stock_anchor,
  public.v_stock_ledger_balance, public.v_stock_audit_ecarts,
  public.v_stock_audit_negatifs, public.v_stock_audit_sorties_fantomes,
  public.v_stock_audit_synthese from anon;
