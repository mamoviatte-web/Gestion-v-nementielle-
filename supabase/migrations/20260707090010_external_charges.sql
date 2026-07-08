-- ═══════════════════════════════════════════════════════════════════════════
-- external_charges.sql — Charges externes d'un événement (traiteur, sécurité,
-- technique, déco…) + intégration au P&L séminaire.
--
-- Contexte : le traiteur était saisi comme simple texte (traiteur_company) et
-- n'était donc jamais déduit du gain net. Cette migration crée une table de
-- charges externes chiffrées et les intègre dans get_event_costs — la fonction
-- déjà consommée par le rapport séminaire (useSeminarReportDraft), qui calcule
-- total_cost_ht = F&B + RH + charges externes.
--
-- NB : on n'utilise PAS event_commercial_data (table non alimentée pour les
-- séminaires ; le P&L vit dans seminar_report_draft, calculé côté client).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Table des charges externes ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS event_external_charges (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id      UUID NOT NULL REFERENCES events(event_id) ON DELETE CASCADE,
  provider_name TEXT NOT NULL,
  charge_type   TEXT NOT NULL DEFAULT 'autre' CHECK (charge_type IN (
                  'traiteur','securite','technique','decoration','transport',
                  'animation','photo_video','nettoyage','location','communication','autre')),
  amount_ht     DECIMAL(12,2) NOT NULL DEFAULT 0,
  tva_rate      DECIMAL(5,2) DEFAULT 20,
  amount_ttc    DECIMAL(12,2) GENERATED ALWAYS AS (amount_ht * (1 + tva_rate / 100)) STORED,
  invoice_ref   TEXT,
  is_confirmed  BOOLEAN DEFAULT false,
  notes         TEXT,
  created_by    TEXT,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ext_charges_event ON event_external_charges(event_id);

ALTER TABLE event_external_charges ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS stade_full_charges ON event_external_charges;
CREATE POLICY stade_full_charges ON event_external_charges
  FOR ALL TO authenticated USING (is_stade()) WITH CHECK (is_stade());

-- ── get_event_costs : intègre les charges externes au total ─────────────────
CREATE OR REPLACE FUNCTION get_event_costs(p_event_id UUID)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_fb      DECIMAL(12,2) := 0;
  v_rh      DECIMAL(12,2) := 0;
  v_occ     DECIMAL(12,2) := 0;
  v_ext     DECIMAL(12,2) := 0;
  v_missing INT := 0;
BEGIN
  SELECT
    COALESCE(SUM((esl.initial_qty + COALESCE(esl.reassort_qty,0)
                  - COALESCE(esl.final_qty,0)) * COALESCE(p.unit_price_ht,0)), 0),
    COUNT(*) FILTER (WHERE esl.final_qty IS NULL
                       AND (esl.initial_qty > 0 OR COALESCE(esl.reassort_qty,0) > 0))
  INTO v_fb, v_missing
  FROM event_stock_lines esl
  JOIN products p ON p.product_id = esl.product_id
  WHERE esl.event_id = p_event_id AND p.unit_price_ht IS NOT NULL;

  SELECT COALESCE(SUM(CASE WHEN sc.actual_departure IS NOT NULL AND sc.hourly_rate IS NOT NULL
    THEN compute_actual_hours(sc.planned_arrival, sc.actual_departure) * sc.hourly_rate ELSE 0 END), 0)
  INTO v_rh FROM schedules sc WHERE sc.event_id = p_event_id;

  IF to_regclass('public.occasional_hours') IS NOT NULL THEN
    EXECUTE 'SELECT COALESCE(SUM(total_cost),0) FROM occasional_hours WHERE event_id = $1'
      INTO v_occ USING p_event_id;
  END IF;

  SELECT COALESCE(SUM(amount_ht), 0) INTO v_ext
  FROM event_external_charges WHERE event_id = p_event_id;

  RETURN json_build_object(
    'fb_cost_ht',       ROUND(v_fb, 2),
    'rh_cost',          ROUND(v_rh + v_occ, 2),
    'external_cost_ht', ROUND(v_ext, 2),
    'total_cost_ht',    ROUND(v_fb + v_rh + v_occ + v_ext, 2),
    'missing_clotures', v_missing
  );
END; $$;

-- ── Migration : traiteur saisi en texte numérique → charge chiffrée ─────────
-- Si traiteur_company contient un nombre (ex : "1400"), on crée une charge
-- traiteur. Guard NOT EXISTS pour l'idempotence.
INSERT INTO event_external_charges (event_id, provider_name, charge_type, amount_ht, is_confirmed, notes)
SELECT src.event_id, 'Traiteur', 'traiteur', src.val, true, 'Migré depuis le champ texte traiteur'
FROM (
  SELECT event_id, regexp_replace(traiteur_company, ',', '.')::DECIMAL AS val
  FROM seminar_report_draft
  WHERE traiteur_company ~ '^\s*\d+([.,]\d+)?\s*$'
  UNION
  SELECT event_id, regexp_replace(traiteur_company, ',', '.')::DECIMAL AS val
  FROM event_commercial_data
  WHERE traiteur_company ~ '^\s*\d+([.,]\d+)?\s*$'
) src
WHERE src.val > 0
  AND NOT EXISTS (
    SELECT 1 FROM event_external_charges ec
    WHERE ec.event_id = src.event_id AND ec.charge_type = 'traiteur'
  );
