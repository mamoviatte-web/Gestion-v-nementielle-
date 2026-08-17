-- ═══════════════════════════════════════════════════════════════════════════
-- runner_packaging_rounding.sql — CDC V5 #3 : RUNNER_QUANTITY_ROUNDING.
--
-- On n'achemine pas 17 bouteilles quand elles viennent par cartons de 24 : la
-- quantité à acheminer est arrondie AU CONDITIONNEMENT supérieur. La taille du
-- pack existe déjà (products.packaging_qty) ; on ajoute packaging_rule (libellé
-- CDC : carton/pack/boudin/fût/bouteille/unité) et on applique l'arrondi après
-- la génération runner. Réservé ROLE_STADE.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1) Libellé de conditionnement (packaging_rule) ───────────────────────────
ALTER TABLE products ADD COLUMN IF NOT EXISTS packaging_rule TEXT;

UPDATE products SET packaging_rule = CASE
  WHEN packaging_unit ILIKE 'carton' THEN 'carton'
  WHEN packaging_unit ILIKE 'pack'   THEN 'pack'
  WHEN packaging_unit ILIKE 'boudin' THEN 'boudin'
  WHEN unit = 'fût'                   THEN 'fût'
  WHEN unit IN ('btl', 'bouteille')  THEN 'bouteille'
  ELSE 'unité'
END
WHERE packaging_rule IS NULL;

-- ── 2) Arrondi au conditionnement supérieur ──────────────────────────────────
CREATE OR REPLACE FUNCTION arrondi_conditionnement(p_qty NUMERIC, p_pack INT)
RETURNS INT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN COALESCE(p_qty, 0) <= 0 THEN 0
    WHEN COALESCE(p_pack, 1) <= 1 THEN CEIL(p_qty)::INT
    ELSE (CEIL(p_qty::NUMERIC / p_pack) * p_pack)::INT
  END;
$$;

-- ── 3) Appliquer l'arrondi aux lignes runner brouillon d'un événement ────────
CREATE OR REPLACE FUNCTION round_runner_to_packaging(p_event UUID)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_n INT;
BEGIN
  IF NOT is_stade() THEN RETURN json_build_object('success', false, 'error', 'Réservé équipe stade'); END IF;

  UPDATE runner_auto_planning r
     SET quantity_to_move = arrondi_conditionnement(r.quantity_to_move, p.packaging_qty)
    FROM products p
   WHERE p.product_id = r.product_id
     AND r.event_id = p_event
     AND COALESCE(r.validation_status, 'brouillon') = 'brouillon'
     AND COALESCE(p.packaging_qty, 1) > 1
     AND COALESCE(r.quantity_to_move, 0) > 0
     AND r.quantity_to_move <> arrondi_conditionnement(r.quantity_to_move, p.packaging_qty);

  GET DIAGNOSTICS v_n = row_count;
  RETURN json_build_object('success', true, 'lignes_arrondies', v_n);
END; $$;

GRANT EXECUTE ON FUNCTION arrondi_conditionnement(NUMERIC, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION round_runner_to_packaging(UUID) TO authenticated;
