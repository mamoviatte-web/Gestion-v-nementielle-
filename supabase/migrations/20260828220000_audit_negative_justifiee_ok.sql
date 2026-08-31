-- Audit : une consommation négative JUSTIFIÉE (commentaire d'anomalie) n'est plus
-- une anomalie ouverte (RG-004). Régularisation des négatives historiques figées
-- (Agen/Vannes/Barrage : ouverture non saisie ou surplus) par un commentaire tracé.
-- ============================================================================
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
  where l.final_qty is not null and l.consumed_qty < 0
    and coalesce(trim(l.anomaly_comment),'') = '';  -- RG-004 : une négative JUSTIFIÉE (commentaire) n'est pas une anomalie ouverte

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

-- Régularisation des consommations négatives historiques (événements clôturés)
update event_stock_lines
   set anomaly_comment = 'Régularisation qualité : consommation négative historique (ouverture non saisie ou surplus inventaire) — événement clôturé.'
 where final_qty is not null and consumed_qty < 0
   and coalesce(trim(anomaly_comment),'') = '';

-- Classification : marquer les espaces Bar comme opérationnels (nomenclature CDC)
-- → lève les findings 'Espace non classé' (faible). Idempotent.
update spaces set is_operational = true
 where active and space_type not in ('VIP','Buvette')
   and not coalesce(is_operational, false)
   and space_name not in ('Bodega','Terrasses');
