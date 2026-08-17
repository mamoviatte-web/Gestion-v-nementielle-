-- ═══════════════════════════════════════════════════════════════════════════
-- apply_selection_groups.sql — CDC V5 #1 (intégration génération).
--
-- Après génération runner, ne garder que la VARIANTE PRINCIPALE de chaque gamme
-- « non multiple » (vins rouge/blanc/rosé, champagne) : retire les autres
-- variantes des lignes brouillon. Bière/cola/eaux = allow_multiple (plusieurs
-- produits légitimes : BUD + LEFFE + Goose…), donc non concernés.
--
-- Garde de sécurité : on ne retire une variante QUE si la principale choisie est
-- elle-même présente sur la fiche (jamais de gamme vidée). Réservé ROLE_STADE.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1) Seules les gammes vin/champagne imposent un seul actif ────────────────
UPDATE product_selection_groups SET allow_multiple = true
 WHERE code IN ('BEER_DRAFT_SPACE_EVENT','SOFT_COLA_SPACE_EVENT','WATER_FLAT_SPACE_EVENT','WATER_SPARKLING_SPACE_EVENT');

-- ── 2) Appliquer la sélection aux dotations runner ───────────────────────────
CREATE OR REPLACE FUNCTION apply_selection_groups(p_event UUID)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_n INT;
BEGIN
  IF NOT is_stade() THEN RETURN json_build_object('success', false, 'error', 'Réservé équipe stade'); END IF;

  DELETE FROM runner_auto_planning r
   USING products p, product_selection_groups g, event_area_product_selection sel
   WHERE r.event_id = p_event
     AND COALESCE(r.validation_status, 'brouillon') = 'brouillon'
     AND p.product_id = r.product_id
     AND p.selection_group_id = g.id
     AND NOT g.allow_multiple
     AND sel.event_id = r.event_id AND sel.space_id = r.space_id
     AND sel.selection_group_id = g.id AND sel.is_primary
     AND sel.product_id <> r.product_id
     -- garde : la principale doit exister sur la fiche (ne jamais vider la gamme)
     AND EXISTS (SELECT 1 FROM runner_auto_planning r2
                 WHERE r2.event_id = r.event_id AND r2.space_id = r.space_id AND r2.product_id = sel.product_id);

  GET DIAGNOSTICS v_n = row_count;
  RETURN json_build_object('success', true, 'lignes_supprimees', v_n);
END; $$;

GRANT EXECUTE ON FUNCTION apply_selection_groups(UUID) TO authenticated;
