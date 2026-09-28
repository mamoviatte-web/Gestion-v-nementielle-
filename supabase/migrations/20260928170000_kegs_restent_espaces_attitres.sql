-- =====================================================================
-- LES FÛTS RESTENT DANS LES ESPACES ATTITRÉS (règle durable + rattrapage Aurillac)
-- ---------------------------------------------------------------------
-- EXIGENCE MÉTIER (utilisateur, répétée) :
--   « Les stocks finaux (soft / fûts / vins) doivent rester dans les espaces
--     attitrés. » Donc un espace qui CONSERVE son stock (retains_stock=true)
--   conserve AUSSI ses fûts → retain_kegs_in_espace doit être aligné sur
--   retains_stock.
--
-- ÉTAT AVANT (lecture prod 2026-09-28, event Aurillac 7720c0de-…-687a clôturé) :
--   • retains_stock=true & retain_kegs_in_espace=false pour 13 espaces ACTIFS :
--       VIP  : Salon Nord, Salon Sud, Loge Est, Loge Ouest Nord, Loge Ouest Sud
--       Bars : Bistrot, Bodega, Club 70 Nord, Club 70 Sud, Comptoir, Le Pub,
--              Wine bar Nord, Wine bar Sud
--     → à la clôture, leurs fûts pleins restants étaient renvoyés en central
--       (area_stocks/espace forcés à 0) alors que les soft/vins, eux, restaient
--       correctement dans l'espace. Les fûts « disparaissaient » de l'espace.
--   • Seules les buvettes EST (EST NORD, EST SUD, Nord EST) avaient déjà
--     retain_kegs_in_espace=true (fûts OK, final==area).
--   • Les buvettes retains_stock=false (Nord OUEST, SUD *, Virages, Parvis,
--     Tente CTS, Grandes Tablées, Buvettes 1/2, Toinou…) se vident à chaque
--     match : leurs fûts repartent en central → CORRECT, on n'y touche PAS.
--
-- POURQUOI L'ALIGNEMENT DU DRAPEAU SUFFIT POUR LES FUTURS MATCHS :
--   Toute la logique de clôture route DÉJÀ les fûts selon retain_kegs_in_espace
--   (et non retains_stock) :
--     - on_stock_final_entered()  : branche fût → garde le final en espace SSI
--       retain_kegs_in_espace, sinon espace=0 (cf. 20260922110000) ;
--     - finalize_event_espace_stocks() : idem + filet reconcile_non_retained_keg_espace ;
--     - reconcile_non_retained_keg_espace() : ne cible que retain_kegs_in_espace=false ;
--     - vue event_keg_reconciliation.destination_pleins : garde_sur_place SSI
--       retain_kegs_in_espace (cf. 20260922130000) ;
--     - keg_summary.retenu_espace / reconcile_keg_inventory_to_truth : lisent
--       area_stocks des espaces retain_kegs_in_espace=true.
--   → Il suffit donc de basculer le drapeau : AUCUNE fonction à modifier. Les
--     prochains matchs conserveront automatiquement les fûts dans ces espaces.
--
-- CE QUE FAIT CETTE MIGRATION (idempotente, RIEN d'inventé) :
--   A) Aligne retain_kegs_in_espace := retains_stock (règle durable, tous espaces).
--   B) Ré-propage les fûts pleins restants d'Aurillac dans area_stocks +
--      stock_balances(espace) + keg_inventory('en_espace') pour ces espaces.
--   C) Corrige l'anomalie CO2 : réserve centrale AUC = -14 (impossible) → plancher 0,
--      journalisé, comptage physique à CONFIRMER par l'utilisateur.
--
-- CONSERVATION (point clé, vérifié par l'historique des mouvements) :
--   Les fûts pleins restants d'Aurillac ont été DÉBITÉS du central au dispatch
--   ('sortie' Stockage Fûts → espace) puis l'espace a été mis à 0 à la clôture
--   SANS écriture de retour ('retour_réutilisable' vers Stockage Fûts INEXISTANT
--   pour ces espaces — vérifié dans stock_movements). Ils ne sont donc plus dans
--   AUCUN solde (espace=0, déjà sortis du central) : ils sont « en limbes ».
--   → Les re-créditer à l'espace RESTAURE la conservation (une seule copie).
--     DÉCRÉMENTER à nouveau le central les retirerait une 2e fois = DOUBLE
--     SOUSTRACTION. On ne touche donc PAS Stockage Fûts. La correction espace est
--     une PHOTO D'INVENTAIRE (recalage), tracée par un mouvement 'inventaire'
--     (RG-002) ; c'est la symétrie exacte du zéro-espace posé à tort à la clôture.
--
-- NB CENTRAL (pré-existant, hors périmètre — comptage physique requis) :
--   stock_balances(Stockage Fûts) est négatif (BUD -46, LEFFE -30…) et
--   keg_summary.pleins est clampé à 0 car l'ancrage (comptage 2026-09-21) est
--   ANTÉRIEUR à Aurillac (2026-09-25). Cette migration NE corrige PAS les pleins
--   centraux : cela exige un COMPTAGE PHYSIQUE post-Aurillac (record_keg_count),
--   déjà signalé par 20260928120000 / keg_central_anchor_status(). NON inventé ici.
--
-- GARDE-FOUS : RG-001 (responsable_nom tracé sur chaque écriture), RG-002 (chaque
--   correction = ligne stock_movements ; recalage = photo d'inventaire), RG-004
--   (aucune conso négative touchée), RG-009 (aucun DELETE de produit/événement),
--   RG-011 (aucune suppression d'événement). Base de vérité = finals responsables.
-- =====================================================================


-- ─────────────────────────────────────────────────────────────────────
-- DRY-RUN / VÉRIFICATION (à exécuter EN LECTURE avant application)
-- ─────────────────────────────────────────────────────────────────────
-- 1) Espaces qui vont basculer retain_kegs_in_espace false→true :
--   select space_name, service_type, retains_stock, retain_kegs_in_espace, active
--     from spaces where retain_kegs_in_espace is distinct from retains_stock
--    order by active desc, service_type, space_name;
--
-- 2) Fûts pleins restants d'Aurillac à re-propager (avant = area 0) :
--   select s.space_name, p.product_name, esl.final_qty, esl.product_state,
--          coalesce(a.current_qty,0) as area_avant
--     from event_stock_lines esl
--     join spaces s on s.space_id=esl.space_id and s.retains_stock and s.active
--     join products p on p.product_id=esl.product_id and p.unit='fût'
--     left join area_stocks a on a.area_id=esl.space_id and a.product_id=esl.product_id
--    where esl.event_id='7720c0de-2e1b-4258-904e-830cf8bd687a'
--      and greatest(coalesce(esl.final_qty,0),0) > 0
--      and coalesce(esl.product_state,'fermé') not in ('cassé','perdu','périmé','fût_vide','fût_percuté')
--    order by s.space_name, p.product_name;
--   -- Attendu (28 fûts) : Bistrot BUD 4 / LEFFE 4 · Bodega FADA Blanche 2 /
--   --   Blonde 2 / IPA 2 · Club 70 Sud BUD 6 · Salon Nord LEFFE 3 ·
--   --   Salon Sud BUD 3 / LEFFE 2.
--
-- 3) CO2 avant : central AUC -14 ; espaces = 19 (Club70N 1, Club70S 4,
--    Comptoir 5, Salon Nord 4, Salon Sud 5) ; total système = 5.
--   select loc.name, sb.current_quantity from stock_balances sb
--     join stock_locations loc on loc.id=sb.location_id
--     join products p on p.product_id=sb.product_id
--    where p.product_name ilike 'CO2%' order by loc.location_type, loc.name;


-- ─────────────────────────────────────────────────────────────────────
-- A) RÈGLE DURABLE : retain_kegs_in_espace := retains_stock (idempotent)
--    Affecte les 13 espaces actifs (5 VIP + 8 bars, Bodega incluse) et, par
--    cohérence, 2 buvettes C70 legacy INACTIVES (retains_stock=true) — sans
--    effet opérationnel (inactives). Les espaces retains_stock=false restent
--    à false ; les buvettes EST restent à true.
-- ─────────────────────────────────────────────────────────────────────
update public.spaces
   set retain_kegs_in_espace = retains_stock
 where retain_kegs_in_espace is distinct from retains_stock;


-- ─────────────────────────────────────────────────────────────────────
-- B) RATTRAPAGE AURILLAC : ré-propager les fûts pleins restants dans l'espace
--    attitré. area_stocks = autorité ; stock_balances(espace) = copie ;
--    keg_inventory('en_espace') = registre dérivé aligné. Central NON touché
--    (cf. note conservation). Idempotent : mouvement 'inventaire' inséré
--    uniquement si le solde espace change réellement (delta<>0).
-- ─────────────────────────────────────────────────────────────────────
do $$
declare
  v_event uuid := '7720c0de-2e1b-4258-904e-830cf8bd687a';
  v_by    text := 'Régie clôture Aurillac — fûts restent en espace attitré';
  r       record;
  v_loc   uuid;
  v_cur   int;
  v_delta int;
  v_vol   numeric;
  v_moves int := 0;
  v_lines int := 0;
begin
  for r in
    select esl.space_id, esl.product_id, p.product_name,
           greatest(coalesce(esl.final_qty,0),0) as keep
      from event_stock_lines esl
      join spaces s on s.space_id = esl.space_id
           and coalesce(s.retains_stock,false) = true
           and coalesce(s.retain_kegs_in_espace,false) = true   -- après (A)
      join products p on p.product_id = esl.product_id and p.unit = 'fût'
     where esl.event_id = v_event
       and esl.final_qty is not null
       and greatest(coalesce(esl.final_qty,0),0) > 0
       and coalesce(esl.product_state,'fermé') not in ('cassé','perdu','périmé','fût_vide','fût_percuté')
  loop
    v_loc := espace_location_of(r.space_id);

    select coalesce(current_qty,0) into v_cur
      from area_stocks where area_id = r.space_id and product_id = r.product_id;
    v_cur   := coalesce(v_cur, 0);
    v_delta := r.keep - v_cur;
    select volume_liters into v_vol from keg_volume_standards where product_id = r.product_id;

    -- RG-002 : trace de la correction d'inventaire espace (recalage, pas un
    -- transfert central). Uniquement si le solde change → idempotent.
    if v_delta <> 0 then
      insert into stock_movements (event_id, space_id, product_id, movement_type, qty,
                                   from_location_id, to_location_id, is_anomaly,
                                   event_category, status, responsable_nom)
      values (v_event, r.space_id, r.product_id, 'inventaire', v_delta,
              null, v_loc, false, 'match', 'validated', v_by);
      v_moves := v_moves + 1;
    end if;

    -- area_stocks = autorité du reste-en-espace
    insert into area_stocks (area_id, product_id, current_qty, initial_qty, last_updated, updated_by)
    values (r.space_id, r.product_id, r.keep, r.keep, now(), v_by)
    on conflict (area_id, product_id) do update
      set current_qty = excluded.current_qty, initial_qty = excluded.initial_qty,
          last_updated = now(), updated_by = v_by;

    -- stock_balances(espace) = copie de l'autorité
    if v_loc is not null then
      insert into stock_balances (product_id, location_id, current_quantity, last_movement_at, updated_by)
      values (r.product_id, v_loc, r.keep, now(), v_by)
      on conflict (product_id, location_id) do update
        set current_quantity = excluded.current_quantity, last_movement_at = now(), updated_by = v_by;
    end if;

    -- keg_inventory('en_espace') = registre dérivé, aligné sur area_stocks
    delete from keg_inventory
     where status = 'en_espace' and space_id = r.space_id and product_id = r.product_id;
    insert into keg_inventory (product_id, status, qty, volume_liters, event_id, space_id,
                               dispatched_at, responsable_nom, notes)
    values (r.product_id, 'en_espace', r.keep, v_vol, v_event, r.space_id, now(), v_by,
            'Fûts pleins restants conservés en espace attitré (clôture Aurillac)');

    v_lines := v_lines + 1;
  end loop;

  raise notice 'Aurillac fûts : % lignes re-propagées, % mouvements inventaire tracés (central NON décrémenté — cf. conservation).', v_lines, v_moves;
end $$;


-- ─────────────────────────────────────────────────────────────────────
-- C) ANOMALIE CO2 : central AUC = -14 (impossible). Plancher à 0, journalisé.
--    On n'invente PAS de stock physique : le vrai central CO2 exige un comptage
--    à CONFIRMER par l'utilisateur (mouvement marqué is_anomaly=true).
--    Idempotent : n'agit que si le central est encore négatif.
-- ─────────────────────────────────────────────────────────────────────
do $$
declare
  v_co2   uuid;
  v_auc   uuid;
  v_cur   numeric;
  v_delta numeric;
  v_by    text := 'Régie — plancher CO2 réserve (comptage physique à confirmer)';
begin
  select product_id into v_co2 from products where product_name ilike 'CO2%' order by product_name limit 1;
  select id into v_auc from stock_locations
    where name = 'AUC — Réserve générale' and location_type = 'reserve_centrale' limit 1;

  if v_co2 is null or v_auc is null then
    raise notice 'CO2 / AUC introuvable — plancher CO2 ignoré.';
    return;
  end if;

  select coalesce(current_quantity,0) into v_cur
    from stock_balances where product_id = v_co2 and location_id = v_auc;
  v_cur := coalesce(v_cur, 0);

  if v_cur < 0 then
    v_delta := 0 - v_cur;   -- -14 → correction +14

    -- RG-002 : correction d'inventaire central, marquée anomalie (à confirmer).
    insert into stock_movements (event_id, space_id, product_id, movement_type, qty,
                                 from_location_id, to_location_id, is_anomaly, status, responsable_nom)
    values (null, null, v_co2, 'inventaire', v_delta::int,
            null, v_auc, true, 'validated', v_by);

    update stock_balances
       set current_quantity = 0, last_movement_at = now(), updated_by = v_by
     where product_id = v_co2 and location_id = v_auc;

    raise notice 'CO2 central : % → 0 (plancher, correction +% ; COMPTAGE PHYSIQUE À CONFIRMER).', v_cur, v_delta;
  else
    raise notice 'CO2 central déjà >= 0 (%), aucun plancher appliqué.', v_cur;
  end if;
end $$;


-- ─────────────────────────────────────────────────────────────────────
-- VÉRIFICATION APRÈS APPLICATION (lecture)
-- ─────────────────────────────────────────────────────────────────────
-- 1) Plus aucun espace désaligné :
--   select count(*) as desalignes from spaces
--    where retain_kegs_in_espace is distinct from retains_stock;   -- attendu 0
--
-- 2) Fûts Aurillac désormais en espace (area == final) :
--   select s.space_name, p.product_name, esl.final_qty, a.current_qty as area_apres
--     from event_stock_lines esl
--     join spaces s on s.space_id=esl.space_id and s.retains_stock and s.active
--     join products p on p.product_id=esl.product_id and p.unit='fût'
--     join area_stocks a on a.area_id=esl.space_id and a.product_id=esl.product_id
--    where esl.event_id='7720c0de-2e1b-4258-904e-830cf8bd687a'
--      and greatest(coalesce(esl.final_qty,0),0) > 0
--      and coalesce(esl.product_state,'fermé') not in ('cassé','perdu','périmé','fût_vide','fût_percuté')
--    order by s.space_name, p.product_name;   -- attendu : area == final
--
-- 3) keg_summary.en_espace intègre le reste conservé (attendu approx) :
--    Fût BUD 8→21 · Fût LEFFE 6→15 · FADA Blanche 0→2 · Blonde 0→2 · IPA 0→2 ·
--    CO2 0→19.  (pleins inchangés/clampés → recomptage physique central requis.)
--   select product_name, pleins, en_espace, vides from keg_summary
--    where product_name ilike '%Fût%' or product_name ilike 'CO2%' order by product_name;
--
-- 4) CO2 central plancher :
--   select current_quantity from stock_balances sb
--     join stock_locations loc on loc.id=sb.location_id
--     join products p on p.product_id=sb.product_id
--    where p.product_name ilike 'CO2%' and loc.name='AUC — Réserve générale';  -- attendu 0
--
-- 5) Audit de clôture fûts (doit rester sans bloquant) :
--   select audit_keg_closure('7720c0de-2e1b-4258-904e-830cf8bd687a');
--
-- ÉTAPE MANUELLE HORS MIGRATION (donnée terrain, NON inventée) :
--   Recompter physiquement le Stockage Fûts (pleins) ET le central CO2 post-Aurillac,
--   puis record_keg_count(...) pour les fûts (ré-ancre keg_summary.pleins +
--   stock_balances) et confirmer/ajuster le plancher CO2. Voir keg_central_anchor_status().
-- =====================================================================
