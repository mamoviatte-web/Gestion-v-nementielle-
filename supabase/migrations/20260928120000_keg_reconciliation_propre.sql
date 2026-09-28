-- =====================================================================
-- REMISE AU PROPRE DU SUIVI DES FÛTS (kegs) — RÉCONCILIATION DE BOUT EN BOUT
-- ---------------------------------------------------------------------
-- Contexte : après le match Aurillac (2026-09-25, clôturé), audit_keg_closure
-- = 0 bloquant, MAIS 4 systèmes parallèles suivent les fûts et divergent :
--
--   (1) area_stocks              — reste-en-espace par espace  [SOURCE DE VÉRITÉ reste]
--   (2) stock_balances(espace)   — copie du (1)                [dérivé, cohérent avec (1)]
--   (3) keg_inventory(status)    — registre unité par unité    [PARALLÈLE, NON MAINTENU]
--   (4) keg_summary / keg_true_balance — vues centrales pleins/vides
--
-- CONSTATS CHIFFRÉS (lecture prod, 2026-09-28) :
--
-- A) keg_inventory.status='en_espace' est ORPHELIN et contredit area_stocks :
--    - Espaces NON conservés (retain_kegs_in_espace=false) qui devraient être à 0
--      gardent des lignes 'en_espace' fantômes issues de dispatchs jamais soldés :
--        Bistrot BUD 9 / LEFFE 6 · Nord OUEST BUD 10 / Hoegaarden 6 / LEFFE 5
--        SUD EST BUD 10 / Goose 4 / Hoegaarden 3 / LEFFE 3 · SUD OUEST 6/4/10/3
--        Salon Nord 5/4 · Salon Sud 5/4 · Bodega 4/12/5 · Club 70 Nord 4 / Sud 8
--        Virage OUEST 5/4/8/3 · Virage SUD OUEST 10/7 · Grandes Tablées 2/1 ...
--      → area_stocks = 0 partout (correct) ; keg_inventory 'en_espace' ≠ 0 (faux).
--    - Buvettes conservées (retain_kegs_in_espace=true) : keg_inventory 'en_espace'
--      ≠ area_stocks (autorité) :
--        Nord EST : area BUD 2 / Goose 5 / LEFFE 5 vs keg_inv 4 / 0 / 3
--        EST SUD  : area BUD 4 / Goose 4 vs keg_inv 0 / 0 ...
--
-- B) « Stockage Fûts · EN ESPACE 0 » sur la carte Dépôt central :
--    useDepots.ts lit keg_summary.en_espace, dont le CTE ne compte QUE les
--    dotations d'événements OUVERTS (initial+reassort). Aucun événement ouvert
--    ⇒ 0. Or les buvettes EST conservent réellement (area_stocks) :
--        BUD 8 · Goose 11 · Hoegaarden 4 · LEFFE 6  → devrait afficher, pas 0.
--
-- C) « VIP & Bars sans fût en stockage » / dépôt central vide :
--    keg_summary.pleins = 0 pour TOUS les fûts car l'ancrage (dernier comptage
--    physique 2026-09-21) est ANTÉRIEUR au match Aurillac (2026-09-25) et
--    INFÉRIEUR à la conso :
--        BUD  : comptage 40, conso Aurillac 59  → 40−59 = −19 → clamp 0
--        Goose: comptage  4, conso 18           → 0
--        LEFFE: comptage 21, conso 31           → 0   (idem tous produits)
--    En parallèle stock_balances(Stockage Fûts) est NÉGATIF (BUD −46, LEFFE −30)
--    et v_depot_balance_derived NÉGATIF différemment (BUD −76). 4 chiffres
--    contradictoires pour « pleins BUD en central » : 0 / −46 / −76 / (comptage 40).
--    → Ancrage périmé : la seule vérité terrain est un NOUVEAU comptage physique
--      post-Aurillac. On NE L'INVENTE PAS (garde-fou « base de vérité »).
--
-- MODÈLE DE VÉRITÉ RETENU (une source par étape) :
--   • Réception fournisseur → register_keg_reception : keg_inventory 'plein'
--     (event_id NULL) + stock_balances(Stockage Fûts) + mouvement (RG-002).
--   • Pleins en central → keg_inventory_counts (dernier comptage physique) via
--     record_keg_count() qui ré-ancre keg_summary ET stock_balances(Stockage Fûts).
--     Valide UNIQUEMENT si un comptage existe APRÈS le dernier match clôturé.
--   • Dispatch → espace → keg_inventory 'plein'→'en_espace' + event_stock_lines.
--   • Clôture → on_stock_final_entered : vides→'vide' ; reste-en-espace :
--       - buvette EST (retain) : area_stocks + stock_balances(espace) = final ;
--       - non conservé          : area_stocks + stock_balances(espace) = 0.
--     ⇒ AUTORITÉ du reste-en-espace = area_stocks (et sa copie stock_balances).
--   • keg_inventory 'en_espace' est un registre DÉRIVÉ qui doit refléter (1),
--     jamais l'inverse.
--
-- CE QUE FAIT CETTE MIGRATION (idempotente, RIEN d'inventé) :
--   1. keg_summary.en_espace inclut désormais le reste conservé des buvettes EST
--      (area_stocks) → corrige « EN ESPACE 0 » sans toucher au calcul des pleins.
--   2. reconcile_keg_inventory_to_truth() : ré-aligne keg_inventory 'en_espace'
--      sur area_stocks (autorité). Photo d'inventaire (comme
--      reconcile_non_retained_keg_espace), pas un mouvement de stock.
--   3. keg_central_anchor_status() : diagnostic LECTURE SEULE listant les fûts
--      dont l'ancrage central est périmé et exige un comptage physique.
--   NB : les négatifs de stock_balances(Stockage Fûts) NE sont PAS corrigés ici :
--        ils doivent l'être par un comptage physique réel (voir bloc final commenté).
-- =====================================================================


-- ── 1) keg_summary : EN ESPACE = dotations d'événements ouverts + reste conservé
--        des buvettes EST (area_stocks). Le calcul des « pleins » est INCHANGÉ
--        (la branche comptage n'utilise pas `en`, aucune régression).
create or replace view public.keg_summary as
 with cnt as (
         select distinct on (kic.product_id) kic.product_id, kic.counted_full, kic.counted_at
           from keg_inventory_counts kic
          order by kic.product_id, kic.counted_at desc
        ), recu as (
         select ki.product_id,
            sum(ki.qty) as recu_total,
            sum(ki.qty) filter (where c_1.counted_at is not null and ki.received_at > c_1.counted_at) as recu_since
           from keg_inventory ki
             left join cnt c_1 on c_1.product_id = ki.product_id
          where ki.status = 'plein'::text and ki.event_id is null and ki.received_at is not null
          group by ki.product_id
        ), era as (
         select coalesce(min(keg_inventory.received_at), now()) as d0
           from keg_inventory
          where keg_inventory.status = 'plein'::text and keg_inventory.event_id is null and keg_inventory.received_at is not null
        ), conso as (
         select esl.product_id,
            sum(greatest(coalesce(esl.consumed_qty, 0), 0)) filter (where e.event_date >= (( select era.d0::date as d0 from era))) as conso_era,
            sum(greatest(coalesce(esl.consumed_qty, 0), 0)) filter (where c_1.counted_at is not null and e.event_date > c_1.counted_at::date) as conso_since
           from event_stock_lines esl
             join events e on e.event_id = esl.event_id and (lower(coalesce(e.status, ''::text)) = any (array['clôturé'::text, 'cloture'::text, 'archivé'::text, 'archive'::text]))
             join spaces s on s.space_id = esl.space_id and s.space_name <> 'Purge tireuses'::text
             left join cnt c_1 on c_1.product_id = esl.product_id
          group by esl.product_id
        ), purge as (
         select esl.product_id,
            sum(greatest(coalesce(esl.consumed_qty, 0), 0)) as purge_total,
            sum(greatest(coalesce(esl.consumed_qty, 0), 0)) filter (where c_1.counted_at is not null and e.event_date > c_1.counted_at::date) as purge_since
           from event_stock_lines esl
             join spaces s on s.space_id = esl.space_id and s.space_name = 'Purge tireuses'::text
             join events e on e.event_id = esl.event_id
             left join cnt c_1 on c_1.product_id = esl.product_id
          group by esl.product_id
        ), en_espace as (
         select esl.product_id,
            sum(greatest(coalesce(esl.initial_qty, 0) + coalesce(esl.reassort_qty, 0), 0)) as qte
           from event_stock_lines esl
             join events e on e.event_id = esl.event_id and (lower(coalesce(e.status, ''::text)) <> all (array['clôturé'::text, 'cloture'::text, 'archivé'::text, 'archive'::text]))
             join spaces s on s.space_id = esl.space_id and s.space_name <> 'Purge tireuses'::text
          group by esl.product_id
        ), retenu_espace as (   -- << AJOUT : reste conservé par les buvettes EST (autorité area_stocks)
         select a.product_id, sum(greatest(coalesce(a.current_qty, 0), 0)) as qte
           from area_stocks a
             join spaces s on s.space_id = a.area_id and coalesce(s.retain_kegs_in_espace, false) = true
          group by a.product_id
        ), vide_phys as (
         select keg_inventory.product_id, sum(keg_inventory.qty) as qte
           from keg_inventory
          where keg_inventory.status = 'vide'::text
          group by keg_inventory.product_id
        )
 select p.product_id,
    p.product_name,
    p.unit,
    p.unit_price_ht,
    coalesce(kvs.volume_liters, 0::numeric)::numeric(6,2) as volume_unit,
    greatest(
        case
            when cnt.counted_at is not null then cnt.counted_full + coalesce(r.recu_since, 0::bigint) - coalesce(c.conso_since, 0::bigint) - coalesce(pu.purge_since, 0::bigint)
            else coalesce(r.recu_total, 0::bigint) - coalesce(c.conso_era, 0::bigint) - coalesce(pu.purge_total, 0::bigint) - coalesce(en.qte, 0::bigint)
        end, 0::bigint) as pleins,
    (coalesce(en.qte, 0::bigint) + coalesce(re.qte, 0::bigint)) as en_espace,   -- << ouverts + reste conservé
    coalesce(vp.qte, 0::bigint) as vides,
    0::bigint as retournes,
    greatest(
        case
            when cnt.counted_at is not null then cnt.counted_full + coalesce(r.recu_since, 0::bigint) - coalesce(c.conso_since, 0::bigint) - coalesce(pu.purge_since, 0::bigint)
            else coalesce(r.recu_total, 0::bigint) - coalesce(c.conso_era, 0::bigint) - coalesce(pu.purge_total, 0::bigint) - coalesce(en.qte, 0::bigint)
        end, 0::bigint)::numeric * coalesce(kvs.volume_liters, 0::numeric) as litres_disponibles
   from products p
     left join cnt on cnt.product_id = p.product_id
     left join recu r on r.product_id = p.product_id
     left join conso c on c.product_id = p.product_id
     left join purge pu on pu.product_id = p.product_id
     left join en_espace en on en.product_id = p.product_id
     left join retenu_espace re on re.product_id = p.product_id
     left join vide_phys vp on vp.product_id = p.product_id
     left join keg_volume_standards kvs on kvs.product_id = p.product_id
  where p.active = true and (p.product_name ~~* '%Fût%'::text or p.product_name ~~* 'CO2%'::text);

grant select on public.keg_summary to authenticated;


-- ── 2) Ré-alignement du registre unité (keg_inventory 'en_espace') sur l'autorité
--        area_stocks. Photo d'inventaire de fin de match (pas un mouvement de stock,
--        même classe que reconcile_non_retained_keg_espace — cf. RG-002 : recalage).
--        Idempotent : rejouable sans effet cumulatif.
create or replace function public.reconcile_keg_inventory_to_truth(p_event_id uuid default null)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_by         text := 'Réconciliation registre fûts → area_stocks (autorité)';
  v_deleted    int  := 0;
  v_realigned  int  := 0;
  r record;
begin
  if auth.uid() is not null and not coalesce(is_stade(), false) then
    return json_build_object('success', false, 'error', 'Action réservée à l''équipe stade.');
  end if;

  -- (a) Espaces NON conservés : le reste-en-espace DOIT être 0 → toute ligne
  --     'en_espace' est fantôme (dispatch jamais soldé). On la retire du registre
  --     live (le devenir réel — vide/consommé/retour central — est déjà porté par
  --     event_stock_lines + area_stocks + les lignes 'vide').
  delete from keg_inventory ki
   using spaces s, products p
   where ki.status = 'en_espace'
     and ki.space_id = s.space_id and coalesce(s.retain_kegs_in_espace, false) = false
     and ki.product_id = p.product_id and p.unit = 'fût'
     and (p_event_id is null or ki.space_id in (select space_id from event_spaces where event_id = p_event_id));
  get diagnostics v_deleted = row_count;

  -- (b) Buvettes EST conservées : la quantité 'en_espace' du registre doit égaler
  --     area_stocks (autorité). On collapse en UNE ligne par (espace, produit).
  for r in
    select a.area_id as space_id, a.product_id, greatest(coalesce(a.current_qty, 0), 0) as reste
      from area_stocks a
      join spaces s on s.space_id = a.area_id and coalesce(s.retain_kegs_in_espace, false) = true
      join products p on p.product_id = a.product_id and p.unit = 'fût'
     where (p_event_id is null or a.area_id in (select space_id from event_spaces where event_id = p_event_id))
  loop
    delete from keg_inventory
     where status = 'en_espace' and space_id = r.space_id and product_id = r.product_id;
    if r.reste > 0 then
      insert into keg_inventory (product_id, status, qty, volume_liters, space_id, dispatched_at, responsable_nom, notes)
        values (r.product_id, 'en_espace', r.reste,
                (select volume_liters from keg_volume_standards where product_id = r.product_id),
                r.space_id, now(), v_by, 'Recalage sur area_stocks (reste conservé buvette EST)');
    end if;
    v_realigned := v_realigned + 1;
  end loop;

  return json_build_object('success', true, 'event_id', p_event_id,
    'lignes_fantomes_supprimees', v_deleted, 'couples_conserves_realignes', v_realigned);
end;
$function$;

grant execute on function public.reconcile_keg_inventory_to_truth(uuid) to authenticated;


-- ── 3) Diagnostic LECTURE SEULE : ancrage central périmé (comptage physique requis)
--        Aucune écriture, aucune donnée inventée. Sert de filet avant de faire
--        confiance à keg_summary.pleins.
create or replace function public.keg_central_anchor_status()
returns table (
  product_id            uuid,
  product_name          text,
  dernier_comptage      date,
  dernier_match_cloture date,
  ancrage_perime        boolean,
  pleins_affiches       bigint,
  action_requise        text
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with last_match as (
    select max(event_date) as d
      from events
     where event_type = 'match'
       and lower(coalesce(status, '')) = any (array['clôturé','cloture','archivé','archive'])
  ),
  last_count as (
    select product_id, max(counted_at)::date as d
      from keg_inventory_counts
     group by product_id
  )
  select p.product_id,
         p.product_name,
         lc.d as dernier_comptage,
         (select d from last_match) as dernier_match_cloture,
         (lc.d is null or lc.d < (select d from last_match)) as ancrage_perime,
         coalesce(ks.pleins, 0) as pleins_affiches,
         case
           when lc.d is null then 'Aucun comptage : record_keg_count(produit, pleins_physiques, ...)'
           when lc.d < (select d from last_match)
             then 'Ancrage périmé : recompter physiquement post-match via record_keg_count(...)'
           else 'À jour'
         end as action_requise
    from products p
    left join last_count lc on lc.product_id = p.product_id
    left join keg_summary ks on ks.product_id = p.product_id
   where p.active = true and p.unit = 'fût'
   order by ancrage_perime desc, p.product_name;
$function$;

grant execute on function public.keg_central_anchor_status() to authenticated;


-- =====================================================================
-- ÉTAPE MANUELLE OBLIGATOIRE (hors migration — donnée terrain, non inventée) :
-- Ré-ancrer le Stockage Fûts par un COMPTAGE PHYSIQUE post-Aurillac. Cela remet
-- keg_summary.pleins ET stock_balances(Stockage Fûts) au réel (négatifs corrigés)
-- et trace un mouvement 'inventaire' (RG-002). Exemple (à remplacer par le réel) :
--
--   select record_keg_count('<product_id BUD>',  <pleins_comptés>, 'M. Viatte', 'Comptage post-Aurillac');
--   select record_keg_count('<product_id LEFFE>', <pleins_comptés>, 'M. Viatte', 'Comptage post-Aurillac');
--   ... (un appel par fût actif : liste via keg_central_anchor_status())
--
-- Puis (après validation humaine) :
--   select reconcile_keg_inventory_to_truth(null);   -- aligne le registre unité
-- =====================================================================
