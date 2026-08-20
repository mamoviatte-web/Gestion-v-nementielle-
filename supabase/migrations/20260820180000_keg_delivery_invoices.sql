-- ═══════════════════════════════════════════════════════════════════════════
-- Axe « Livraisons & Factures » (Dépôts) : bucket de stockage des PDF de facture,
-- rattachement facture ↔ livraison, et garde anti-doublon sur le n° de facture.
-- S'appuie sur register_keg_reception + supplier_delivery_registry (déjà en base).
-- ═══════════════════════════════════════════════════════════════════════════

-- Bucket privé pour les PDF de facture fournisseur.
INSERT INTO storage.buckets (id, name, public)
VALUES ('invoices', 'invoices', false)
ON CONFLICT (id) DO NOTHING;

-- Accès aux objets du bucket réservé à l'équipe stade (is_stade()).
DROP POLICY IF EXISTS invoices_stade_all ON storage.objects;
CREATE POLICY invoices_stade_all ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'invoices' AND public.is_stade())
  WITH CHECK (bucket_id = 'invoices' AND public.is_stade());

-- ─────────────────────────────────────────────────────────────────────────────
-- attach_delivery_invoice — écrit les métadonnées facture (PDF + dates + montants)
-- sur une livraison existante. Réservé ROLE_STADE.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.attach_delivery_invoice(
  p_delivery_id uuid,
  p_pdf_url text DEFAULT NULL,
  p_invoice_ref text DEFAULT NULL,
  p_invoice_date date DEFAULT NULL,
  p_amount_ht numeric DEFAULT NULL,
  p_amount_ttc numeric DEFAULT NULL)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT is_stade() THEN RETURN json_build_object('success',false,'error','Réservé à l''équipe stade.'); END IF;
  IF p_delivery_id IS NULL THEN RETURN json_build_object('success',false,'error','Livraison requise.'); END IF;

  UPDATE public.supplier_deliveries SET
    invoice_pdf_url  = COALESCE(nullif(p_pdf_url,''), invoice_pdf_url),
    invoice_ref      = COALESCE(nullif(btrim(p_invoice_ref),''), invoice_ref),
    invoice_date     = COALESCE(p_invoice_date, invoice_date),
    invoice_amount_ht  = COALESCE(p_amount_ht, invoice_amount_ht),
    invoice_amount_ttc = COALESCE(p_amount_ttc, invoice_amount_ttc)
  WHERE id = p_delivery_id;

  IF NOT FOUND THEN RETURN json_build_object('success',false,'error','Livraison introuvable.'); END IF;
  RETURN json_build_object('success',true,'delivery_id',p_delivery_id);
END $$;
GRANT EXECUTE ON FUNCTION public.attach_delivery_invoice(uuid,text,text,date,numeric,numeric) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- invoice_ref_exists — anti-doublon : renvoie l'id de la livraison portant déjà
-- ce n° de facture (NULL si aucune). Sert d'avertissement avant saisie.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.invoice_ref_exists(p_ref text)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM public.supplier_deliveries
   WHERE nullif(btrim(p_ref),'') IS NOT NULL
     AND upper(btrim(invoice_ref)) = upper(btrim(p_ref))
   ORDER BY created_at DESC LIMIT 1;
$$;
GRANT EXECUTE ON FUNCTION public.invoice_ref_exists(text) TO authenticated;
