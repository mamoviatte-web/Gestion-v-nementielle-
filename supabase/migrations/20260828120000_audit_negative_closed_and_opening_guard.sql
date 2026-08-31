-- Qualité clôture — 3 correctifs suite à la revue du match Agen
-- ============================================================================
-- 1) AUDIT · point aveugle : le contrôle « Consommation négative » excluait les
--    événements CLÔTURÉS — précisément quand la donnée est figée (cas Bodega Agen :
--    15 conso négatives non remontées). Il les inclut désormais, en sévérité
--    'critique' sur clôture définitive.
-- 2) AUDIT · « Mélange de gammes » RETIRÉ (décision métier) : plusieurs produits
--    d'un même type (plusieurs blancs / plusieurs rouges…) = variété de gamme
--    normale, pas une anomalie. L'assortiment se pilote sur les retours des
--    responsables (débrief), pas sur ce contrôle.
-- 3) GARDE-FOU · ouverture obligatoire avant clôture : impossible de clôturer un
--    espace sans ouverture/réassort (évite les consommations négatives type Bodega).
--    Double couverture : message propre dans save_zone_stock (chemin responsable)
--    + trigger backstop sur event_stock_lines (couvre tous les chemins, admin inclus).
--    Échappatoire tracée : app.allow_adjustment='on' (imports / ajustements).

-- 1+2) run_business_audit -----------------------------------------------------
CREATE OR REPLACE FUNCTION public.run_business_audit(p_by text DEFAULT 'AuditPilot'::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_run uuid; v_crit int; v_warn int; v_info int; v_score int;
  physical_names text[] := array['Nord OUEST','Nord EST','EST NORD','EST SUD','Virage SUD EST','SUD EST','SUD OUEST','Virage SUD OUEST','Virage OUEST','Parvis Nord','Buvette Toinou'];
  closed_pat text := '%clôtur%';
begin
  insert into audit_runs(status, created_by) values ('running', p_by) returning id into v_run;

  insert into audit_findings(audit_run_id,finding_type,severity,title,description,affected_entity_type,affected_entity_id,suggested_fix)
  select v_run,'données','critique','Ligne runner sans événement',
    'Une ligne de dotation/runner n''est rattachée à aucun événement (event_id NULL).','event_stock_line',l.line_id,
    'Rattacher la ligne à un événement ou la supprimer via procédure tracée.'
  from event_stock_lines l where l.event_id is null;

  insert into audit_findings(audit_run_id,finding_type,severity,title,description,affected_entity_type,affected_entity_id,suggested_fix)
  select v_run,'données','critique','Ligne runner sans espace',
    'Une ligne runner n''est rattachée à aucun espace (space_id NULL).','event_stock_line',l.line_id,
    'Rattacher la ligne à un espace (VIP/Buvette/Terrasse/Bodega).'
  from event_stock_lines l where l.space_id is null;

  insert into audit_findings(audit_run_id,finding_type,severity,title,description,affected_entity_type,affected_entity_id,suggested_fix)
  select v_run,'données','critique','Produit non identifié par product_id',
    'Ligne sans product_id, ou product_id absent du référentiel products.','event_stock_line',l.line_id,
    'Le produit doit être identifié par product_id (jamais par nom libre). Mapper le produit avant intégration.'
  from event_stock_lines l
  where l.product_id is null or not exists (select 1 from products p where p.product_id=l.product_id);

  insert into audit_findings(audit_run_id,finding_type,severity,title,description,affected_entity_type,affected_entity_id,suggested_fix)
  select v_run,'stock','critique','Formule de consommation incohérente',
    format('consumed_qty=%s mais initial(%s)+réassort(%s)−final(%s)=%s.',
           l.consumed_qty,l.initial_qty,coalesce(l.reassort_qty,0),l.final_qty,
           coalesce(l.initial_qty,0)+coalesce(l.reassort_qty,0)-l.final_qty),
    'event_stock_line',l.line_id,'Recalculer via StockEngine : consommation_reelle = stock_initial + reassort - stock_final.'
  from event_stock_lines l
  where l.final_qty is not null
    and l.consumed_qty is distinct from (coalesce(l.initial_qty,0)+coalesce(l.reassort_qty,0)-l.final_qty);

  -- Consommation négative — INCLUT désormais les événements clôturés (donnée figée) :
  -- c'est justement là que l'anomalie compte le plus. Sévérité 'critique' si l'événement
  -- est clos (non corrigeable), 'moyenne' sinon.
  insert into audit_findings(audit_run_id,finding_type,severity,title,description,affected_entity_type,affected_entity_id,suggested_fix)
  select v_run,'stock',
    case when (e.status ilike closed_pat or e.status ilike '%clotur%' or e.status in ('closed','archived','terminé'))
         then 'critique' else 'moyenne' end,
    'Consommation négative',
    format('Consommation négative (%s) sur « %s »%s : le final dépasse initial+réassort (ouverture non saisie ou surplus).',
           l.consumed_qty, e.event_name,
           case when (e.status ilike closed_pat or e.status ilike '%clotur%' or e.status in ('closed','archived','terminé'))
                then ' — événement CLÔTURÉ, donnée figée' else '' end),
    'event_stock_line',l.line_id,
    'Vérifier que l''ouverture (stock initial) a bien été saisie. Sur clôture définitive : donnée non corrigeable, à tracer en SURPLUS_INVENTAIRE (coût plafonné à 0).'
  from event_stock_lines l join events e on e.event_id=l.event_id
  where l.final_qty is not null and l.consumed_qty < 0;

  insert into audit_findings(audit_run_id,finding_type,severity,title,description,affected_entity_type,affected_entity_id,suggested_fix)
  select v_run,'stock','critique','Coût HT négatif',
    format('consumption_cost_ht=%s : un coût négatif est interdit.',l.consumption_cost_ht),
    'event_stock_line',l.line_id,'Bloquer : cout_ht = max(consommation,0) × prix_unitaire_ht. Corriger via auto_compute_line_cost.'
  from event_stock_lines l where l.consumption_cost_ht < 0;

  insert into audit_findings(audit_run_id,finding_type,severity,title,description,affected_entity_type,affected_entity_id,suggested_fix)
  select v_run,'stock','moyenne','Prix unitaire manquant',
    format('Produit consommé (%s u) sans prix HT (ni prix figé ni prix catalogue).',l.consumed_qty),
    'product',l.product_id,'Renseigner unit_price_ht ou figer un prix. Rapport autorisé en quantité, coût bloqué (BLOCK_004).'
  from event_stock_lines l
  where l.final_qty is not null and coalesce(l.consumed_qty,0) > 0
    and coalesce(l.frozen_unit_price_ht, (select unit_price_ht from products p where p.product_id=l.product_id), 0) = 0;

  insert into audit_findings(audit_run_id,finding_type,severity,title,description,affected_entity_type,affected_entity_id,suggested_fix)
  select v_run,'stock','moyenne','Consommation comptée avant retour',
    'Une ligne sans final saisi porte déjà un coût de consommation : la conso ne se calcule qu''après retour événement.',
    'event_stock_line',l.line_id,'Remettre le coût à NULL tant que final_qty est NULL. La fiche runner est un transfert, pas une consommation.'
  from event_stock_lines l where l.final_qty is null and coalesce(l.consumption_cost_ht,0) <> 0;

  -- « Mélange de gammes » RETIRÉ (décision métier) : avoir plusieurs produits d'un
  -- même type (plusieurs vins blancs, plusieurs rouges…) n'est PAS une anomalie —
  -- c'est la variété de gamme normale d'un espace, qui porte des quantités par type.
  -- Le pilotage de l'assortiment se fait sur les retours des responsables (débrief),
  -- pas sur un contrôle de mélange par espace. Contrôle supprimé de l'audit.

  insert into audit_findings(audit_run_id,finding_type,severity,title,description,affected_entity_type,affected_entity_id,suggested_fix)
  select v_run,'métier','moyenne','Bodega ouverte sans gamme vin',
    format('Événement « %s » : la Bodega est ouverte mais aucune ligne vin (Rouge/Blanc/Rosé) n''est présente.', e.event_name),
    'event', es.event_id,'La Bodega doit toujours proposer une gamme vin cohérente si elle est ouverte (BODEGA_WINE_REQUIRED).'
  from event_spaces es
  join spaces sp on sp.space_id=es.space_id and sp.space_name='Bodega'
  join events e on e.event_id=es.event_id
  where e.status in ('en_cours','clôture_en_attente')
    and not exists (
    select 1 from event_stock_lines l join products p on p.product_id=l.product_id
    join product_selection_groups sg on sg.id=p.selection_group_id
    where l.event_id=es.event_id and l.space_id=es.space_id
      and sg.code in ('WINE_RED_SPACE_EVENT','WINE_WHITE_SPACE_EVENT','WINE_ROSE_SPACE_EVENT'));

  insert into audit_findings(audit_run_id,finding_type,severity,title,description,affected_entity_type,affected_entity_id,suggested_fix)
  select v_run,'métier','moyenne','Buvette hors nomenclature',
    format('Buvette « %s » : ne respecte ni les codes B1→B9 ni les noms physiques officiels.', sp.space_name),
    'space', sp.space_id,'Renommer selon la nomenclature officielle (noms physiques primer, B1→B9 en alias) ; convertir via space_import_aliases.'
  from spaces sp
  where sp.service_type='buvette' and sp.active
    and not coalesce(sp.is_supervisor_slot,false)
    and not coalesce(sp.is_operational,false)
    and not (sp.space_name = any(physical_names)) and sp.space_name !~ '^B[1-9]$';

  insert into audit_findings(audit_run_id,finding_type,severity,title,description,affected_entity_type,affected_entity_id,suggested_fix)
  select v_run,'métier','faible','Espace non classé (nomenclature CDC)',
    format('Espace « %s » (type=%s) n''est pas classé en VIP / Buvette / Terrasse / Bodega / Stock général.', sp.space_name, sp.space_type),
    'space', sp.space_id,'Classer l''espace dans une des 5 catégories CDC pour la cohérence des règles produits.'
  from spaces sp
  where sp.active and sp.space_type not in ('VIP','Buvette')
    and not coalesce(sp.is_operational,false)
    and sp.space_name not in ('Bodega','Terrasses');

  select count(*) filter (where severity='critique'),
         count(*) filter (where severity='moyenne'),
         count(*) filter (where severity='faible')
    into v_crit, v_warn, v_info
  from audit_findings where audit_run_id=v_run;

  v_score := greatest(0, round(100 - v_crit*15 - v_warn*1 - v_info*0.25)::int);

  update audit_runs set finished_at=now(), status='completed',
         global_score=v_score, critical_count=v_crit, warning_count=v_warn, info_count=v_info
   where id=v_run;

  return json_build_object('success',true,'audit_run_id',v_run,
    'global_score',v_score,'critical',v_crit,'warning',v_warn,'info',v_info);
exception when others then
  update audit_runs set status='failed', finished_at=now() where id=v_run;
  return json_build_object('success',false,'audit_run_id',v_run,'error',sqlerrm);
end $function$

;

-- 3a) save_zone_stock (garde-fou message responsable) ------------------------
CREATE OR REPLACE FUNCTION public.save_zone_stock(p_token text, p_step text, p_responsable text, p_lines jsonb)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_e UUID; v_s UUID; v_n TEXT; rec JSONB; v_name TEXT;
BEGIN
  SELECT * INTO v_e, v_s, v_n FROM _zone_resolve(p_token);
  IF v_e IS NULL THEN RETURN json_build_object('success', false, 'error', 'Session expirée'); END IF;
  v_name := UPPER(TRIM(p_responsable));
  IF length(v_name) < 2 THEN RETURN json_build_object('success', false, 'error', 'Nom requis (RG-001)'); END IF;

  -- Garde-fou anti « cas Bodega » : interdire la clôture d'un espace sans aucune
  -- ouverture/réassort. Sans stock d'ouverture, tout final produit une consommation
  -- négative non calculable. L'ouverture (étape « Ouverture ») doit précéder la clôture.
  IF p_step = 'cloture'
     AND NOT EXISTS (
       SELECT 1 FROM event_stock_lines esl
        WHERE esl.event_id = v_e AND esl.space_id = v_s
          AND (COALESCE(esl.initial_qty,0) > 0 OR COALESCE(esl.reassort_qty,0) > 0))
  THEN
    RETURN json_build_object('success', false,
      'error', 'Ouverture non saisie pour cet espace : enregistrez d''abord le stock initial (étape « Ouverture ») avant la clôture. Sans ouverture, la consommation serait négative et non calculable.');
  END IF;

  FOR rec IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    INSERT INTO event_stock_lines (event_id, space_id, product_id, initial_qty, reassort_qty, final_qty, product_state, anomaly_comment, responsable_nom, submitted_at)
    VALUES (v_e, v_s, (rec->>'product_id')::uuid,
      COALESCE((rec->>'initial_qty')::int, 0), COALESCE((rec->>'reassort_qty')::int, 0),
      CASE WHEN p_step = 'cloture' THEN (rec->>'final_qty')::int END,
      CASE WHEN p_step = 'cloture' THEN NULLIF(rec->>'product_state','') END,
      CASE WHEN p_step = 'cloture' THEN NULLIF(rec->>'anomaly_comment','') END,
      v_name, CASE WHEN p_step = 'cloture' THEN now() END)
    ON CONFLICT (event_id, space_id, product_id) DO UPDATE SET
      initial_qty  = CASE WHEN p_step = 'ouverture' THEN EXCLUDED.initial_qty ELSE event_stock_lines.initial_qty END,
      reassort_qty = CASE WHEN p_step = 'reassort'  THEN EXCLUDED.reassort_qty ELSE event_stock_lines.reassort_qty END,
      final_qty    = CASE WHEN p_step = 'cloture'   THEN EXCLUDED.final_qty ELSE event_stock_lines.final_qty END,
      product_state = CASE WHEN p_step = 'cloture'  THEN EXCLUDED.product_state ELSE event_stock_lines.product_state END,
      anomaly_comment = CASE WHEN p_step = 'cloture' THEN EXCLUDED.anomaly_comment ELSE event_stock_lines.anomaly_comment END,
      responsable_nom = v_name,
      submitted_at = CASE WHEN p_step = 'cloture' THEN now() ELSE event_stock_lines.submitted_at END;
    -- RG-002 : la traçabilité stock_movements est assurée par les triggers déjà
    -- en place sur event_stock_lines (trg_reassort_updated → 'réassort_événement',
    -- trg_stock_final_entered → consommation). On ne double-écrit PAS ici.
  END LOOP;
  RETURN json_build_object('success', true);
END; $function$

;

-- 3b) Backstop universel : bloque la saisie d'un final sur un espace sans ouverture
create or replace function public.guard_close_requires_opening()
  returns trigger language plpgsql set search_path to 'public' as $fn$
begin
  -- Ne s'applique qu'au moment où un final est posé (clôture) et pour une conso négative
  if NEW.final_qty is not null
     and (TG_OP = 'INSERT' or OLD.final_qty is null)
     and NEW.final_qty > coalesce(NEW.initial_qty,0) + coalesce(NEW.reassort_qty,0)
     and coalesce(current_setting('app.allow_adjustment', true),'') <> 'on'
     and not exists (
       select 1 from event_stock_lines esl
        where esl.event_id = NEW.event_id and esl.space_id = NEW.space_id
          and esl.line_id <> NEW.line_id
          and (coalesce(esl.initial_qty,0) > 0 or coalesce(esl.reassort_qty,0) > 0))
     and coalesce(NEW.initial_qty,0) = 0 and coalesce(NEW.reassort_qty,0) = 0
  then
    raise exception 'Ouverture non saisie pour cet espace : enregistrez le stock initial avant la clôture (garde-fou anti consommation négative).'
      using errcode = 'P0001';
  end if;
  return NEW;
end $fn$;

drop trigger if exists trg_guard_close_requires_opening on event_stock_lines;
create trigger trg_guard_close_requires_opening
  before insert or update of final_qty on event_stock_lines
  for each row execute function public.guard_close_requires_opening();
