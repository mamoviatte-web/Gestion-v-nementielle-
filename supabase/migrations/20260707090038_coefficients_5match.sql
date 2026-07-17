-- ═══════════════════════════════════════════════════════════════════════════
-- coefficients_5match.sql — Base runner 2026-2027 : coefficients réels 5 matchs.
--
-- ⚠ RÉCONCILIATION AVEC LE SCHÉMA RÉEL (vérifié en prod) — corrige les
--   incohérences de la version brute du prompt qui, appliquée telle quelle,
--   aurait perdu ou CORROMPU des données :
--
--   ESPACES :
--     • « LOGES … » → réel « Loge … » (singulier) → normalisé.
--     • « PMR » : aucun espace de ce nom → lignes ignorées (v_ko).
--     • « BUVETTE NORD OUEST / … » (9 noms géographiques) : les buvettes
--       réelles sont B1–B9 + Buvette 1/2 (pas de correspondance 1:1) → lignes
--       ignorées jusqu'à ce qu'un mapping nom→code soit décidé. Les données
--       restent dans ce fichier pour injection ultérieure.
--   PRODUITS :
--     • Table d'alias explicite (Cristaline 1 L, Pepsi 1L+, FADA * Bouteille,
--       Blanc Galiniere, CORONA SANS ALCOOL, GET 27…).
--     • Le fuzzy « %premier-mot% LIMIT 1 » du prompt est SUPPRIMÉ : il assignait
--       les coefficients au MAUVAIS produit. Un produit non résolu est ignoré,
--       jamais mal affecté.
--   • PAS de compute_space_coefficients() en fin d'injection : il recalcule
--     depuis les matchs clôturés (ON CONFLICT DO UPDATE) et écraserait cette
--     base de référence dès qu'un vrai match serait clôturé.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── BLOC A : mise à jour des prix HT (noms réels) ───────────────────────────
UPDATE products SET unit_price_ht = v.prix FROM (VALUES
  ('Mumm Blanc de Blanc',36.00),('Mumm Cordon Rouge',24.50),
  ('Perrier grande bouteille',1.05),('Pepsi bouteille 1L+',1.83),
  ('Pepsi Max bouteille',2.64),('Cristaline 50cl',0.17),
  ('Jus de fruits',2.60),('Schweppes',1.92),('Orangina 50cl',1.22),
  ('Ice Tea 50cl',1.26),('Pepsi 50cl',1.09),
  ('Blanc Galiniere',6.50),('Blanc du Seuil',6.30),('Blanc Montaurone',5.20),
  ('Rosé Miraval',8.50),('Rosé Pey Blanc',7.20),('Rosé Réal',8.70),
  ('Rosé NAIS',6.12),('Rouge Les Alexandrins',8.50),('Rouge Grand Boise',7.58),
  ('Rouge NAIS',4.74),('GET 27',12.21),('Lillet Blanc',12.65),
  ('Lillet Rosé',12.65),('Whisky Jameson',19.29),('Ricard classique',16.86),
  ('Fût BUD',99.99),('Fût LEFFE',132.03),('Fût Goose Island IPA',95.00),
  ('Fût Hoegaarden Blanche',112.00),('Bière en verre',1.36),
  ('Corona',1.63),('CORONA SANS ALCOOL',1.72),
  ('FADA IPA Bouteille',1.80),('FADA Blanche Bouteille',1.73),
  ('FADA Abricot Bouteille',1.80),('FADA Blonde Bouteille',1.48),
  ('San Pellegrino bouteille',0.94),('San Pellegrino 50cl',0.69)
) AS v(nom, prix)
WHERE product_name = v.nom AND active = true;

-- ── BLOC B : résolution d'alias produit (prompt → nom réel) ─────────────────
CREATE OR REPLACE FUNCTION _resolve_product_alias(p_name TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE UPPER(TRIM(p_name))
    WHEN 'CRISTALLINE 50CL'    THEN 'Cristaline 50cl'
    WHEN 'CRISTALLINE 50cl'    THEN 'Cristaline 50cl'
    WHEN 'PEPSI BOUTEILLE'     THEN 'Pepsi bouteille 1L+'
    WHEN 'BLANC GALINIÈRE'     THEN 'Blanc Galiniere'
    WHEN 'GET BODEGA'          THEN 'GET 27'
    WHEN 'BIÈRE EN VERRE BUD'  THEN 'Bière en verre'
    WHEN 'FADA IPA'            THEN 'FADA IPA Bouteille'
    WHEN 'FADA BLANCHE'        THEN 'FADA Blanche Bouteille'
    WHEN 'FADA ABRICOT'        THEN 'FADA Abricot Bouteille'
    WHEN 'FADA BLONDE BTL'     THEN 'FADA Blonde Bouteille'
    WHEN 'FADA BLANCHE BTL'    THEN 'FADA Blanche Bouteille'
    WHEN 'FADA ABRICOT BTL'    THEN 'FADA Abricot Bouteille'
    WHEN 'CORONA 0% SS ALCOOL' THEN 'CORONA SANS ALCOOL'
    WHEN 'FÛT FADA VP'         THEN NULL   -- pas d'équivalent → ignoré
    WHEN 'ROUGE PARADIS'       THEN NULL   -- pas d'équivalent → ignoré
    ELSE p_name                            -- ILIKE gère la casse pour le reste
  END;
$$;

-- ── BLOC C : injection ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION inject_5match_coefficients()
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_ok INT := 0; v_ko INT := 0; v_ko_space INT := 0; v_ko_product INT := 0;
  rec RECORD;
BEGIN
  FOR rec IN
    SELECT * FROM (VALUES
    ('SALON NORD','MUMM BLANC DE BLANC',31.0,70.0,1.0,5),
    ('SALON NORD','Perrier grande bouteille',27.5,35.0,17.0,4),
    ('SALON NORD','VITTEL VERRE',21.8,32.0,13.0,4),
    ('SALON NORD','Pepsi bouteille',18.0,22.0,14.0,5),
    ('SALON NORD','San Pellegrino bouteille',16.0,32.0,0.0,4),
    ('SALON NORD','MUMM CORDON ROUGE',15.0,20.0,5.0,5),
    ('SALON NORD','Blanc Galinière',14.2,25.0,3.0,5),
    ('SALON NORD','Rosé Miraval',11.2,15.0,6.0,5),
    ('SALON NORD','Blanc Montaurone',10.0,17.0,3.0,2),
    ('SALON NORD','GET 27',8.0,14.0,2.0,5),
    ('SALON NORD','Schweppes',6.4,10.0,2.0,5),
    ('SALON NORD','Rouge Les Alexandrins',6.2,11.0,0.0,5),
    ('SALON NORD','Jus de fruits',6.0,11.0,2.0,5),
    ('SALON NORD','Rouge Grand Boise',5.2,10.0,1.0,4),
    ('SALON NORD','Lillet Blanc',4.7,6.0,0.0,5),
    ('SALON NORD','Pepsi Max bouteille',4.6,6.0,3.0,5),
    ('SALON NORD','Whisky Jameson',3.4,9.0,1.0,5),
    ('SALON NORD','Blanc du Seuil',3.2,6.0,1.0,5),
    ('SALON NORD','Fût BUD',3.2,5.0,2.0,5),
    ('SALON NORD','Fût LEFFE',2.4,4.0,1.0,5),
    ('SALON NORD','Ricard classique',2.0,3.0,1.0,5),
    ('SALON NORD','Lillet rosé',1.7,3.0,1.0,3),
    ('SALON NORD','Sirop de pêche',1.0,1.0,1.0,3),
    ('SALON NORD','Sirop de menthe',1.0,1.0,1.0,2),
    ('SALON NORD','Sirop de grenadine',1.0,1.0,1.0,1),
    ('SALON SUD','San Pellegrino bouteille',46.8,55.0,42.0,4),
    ('SALON SUD','MUMM CORDON ROUGE',29.0,36.0,23.0,4),
    ('SALON SUD','VITTEL VERRE',22.5,32.0,8.0,4),
    ('SALON SUD','MUMM BLANC DE BLANC',21.0,36.0,0.0,3),
    ('SALON SUD','Rouge Grand Boise',18.5,35.0,2.0,2),
    ('SALON SUD','Blanc du Seuil',16.0,30.0,2.0,4),
    ('SALON SUD','Pepsi bouteille',14.2,17.0,10.0,5),
    ('SALON SUD','GET 27',13.8,21.0,10.0,4),
    ('SALON SUD','Blanc Galinière',13.5,17.0,10.0,2),
    ('SALON SUD','Rouge Les Alexandrins',12.7,14.0,11.0,3),
    ('SALON SUD','Blanc Montaurone',7.5,14.0,0.0,3),
    ('SALON SUD','Schweppes',7.3,14.0,2.0,4),
    ('SALON SUD','Perrier grande bouteille',7.3,14.0,1.0,3),
    ('SALON SUD','Rosé Réal',6.8,9.0,6.0,4),
    ('SALON SUD','Pepsi Max bouteille',5.8,11.0,3.0,4),
    ('SALON SUD','Jus de fruits',3.2,7.0,1.0,4),
    ('SALON SUD','Rosé Miraval',2.5,3.0,2.0,2),
    ('SALON SUD','Whisky Jameson',2.0,4.0,1.0,4),
    ('SALON SUD','Ricard classique',2.0,3.0,1.0,4),
    ('SALON SUD','Fût BUD',1.8,3.0,1.0,5),
    ('SALON SUD','Fût LEFFE',1.8,3.0,1.0,5),
    ('LOGE EST','Bière en verre',186.8,445.0,16.0,5),
    ('LOGE EST','Cristalline 50CL',155.0,280.0,60.0,3),
    ('LOGE EST','Pepsi bouteille',27.0,28.0,26.0,2),
    ('LOGE EST','MUMM CORDON ROUGE',23.4,40.0,1.0,5),
    ('LOGE EST','Perrier grande bouteille',18.0,26.0,5.0,3),
    ('LOGE EST','Rouge Grand Boise',16.0,26.0,0.0,3),
    ('LOGE EST','Blanc du Seuil',13.5,22.0,5.0,3),
    ('LOGE EST','Blanc Montaurone',11.3,30.0,1.0,4),
    ('LOGE EST','Ricard classique',10.0,14.0,4.0,3),
    ('LOGE EST','Rouge Les Alexandrins',8.5,15.0,2.0,3),
    ('LOGE EST','Jus de fruits',7.2,15.0,1.0,5),
    ('LOGE EST','Whisky Jameson',7.2,12.0,3.0,5),
    ('LOGE EST','Rosé Réal',7.0,10.0,4.0,3),
    ('LOGE EST','Rosé Miraval',3.5,6.0,1.0,2),
    ('LOGE OUEST NORD','Bière en verre',42.0,62.0,24.0,4),
    ('LOGE OUEST NORD','Cristalline 50CL',36.8,41.0,29.0,4),
    ('LOGE OUEST NORD','MUMM CORDON ROUGE',10.8,18.0,8.0,4),
    ('LOGE OUEST NORD','Perrier grande bouteille',5.5,8.0,4.0,4),
    ('LOGE OUEST NORD','Rouge Grand Boise',5.0,8.0,3.0,3),
    ('LOGE OUEST NORD','Pepsi bouteille',4.8,8.0,1.0,4),
    ('LOGE OUEST NORD','Blanc du Seuil',3.7,5.0,3.0,3),
    ('LOGE OUEST NORD','Blanc Montaurone',3.5,6.0,1.0,2),
    ('LOGE OUEST NORD','Ricard classique',1.7,2.0,1.0,4),
    ('LOGE OUEST NORD','Jus de fruits',1.5,3.0,1.0,4),
    ('LOGE OUEST NORD','Whisky Jameson',1.3,2.0,1.0,4),
    ('LOGE OUEST SUD','Cristalline 50CL',83.0,88.0,78.0,2),
    ('LOGE OUEST SUD','Bière en verre',78.3,87.0,68.0,3),
    ('LOGE OUEST SUD','MUMM CORDON ROUGE',7.7,8.0,7.0,3),
    ('LOGE OUEST SUD','Pepsi bouteille',7.0,8.0,5.0,3),
    ('LOGE OUEST SUD','Rouge Grand Boise',6.7,8.0,5.0,3),
    ('LOGE OUEST SUD','Perrier grande bouteille',4.7,7.0,2.0,3),
    ('LOGE OUEST SUD','Jus de fruits',4.3,6.0,2.0,3),
    ('LOGE OUEST SUD','Ricard classique',3.5,4.0,3.0,2),
    ('LOGE OUEST SUD','Whisky Jameson',2.7,3.0,2.0,3),
    ('WINE BAR NORD','Bière en verre',103.7,192.0,41.0,3),
    ('WINE BAR NORD','Cristalline 50CL',28.3,38.0,13.0,3),
    ('WINE BAR NORD','Pepsi bouteille',6.3,11.0,2.0,3),
    ('WINE BAR NORD','Jus de fruits',4.0,8.0,1.0,3),
    ('WINE BAR NORD','Perrier grande bouteille',1.7,2.0,1.0,3),
    ('WINE BAR SUD','Bière en verre',62.3,73.0,54.0,3),
    ('WINE BAR SUD','Cristalline 50CL',58.0,90.0,26.0,3),
    ('WINE BAR SUD','Pepsi bouteille',7.0,10.0,4.0,3),
    ('WINE BAR SUD','Perrier grande bouteille',5.7,8.0,4.0,3),
    ('WINE BAR SUD','Jus de fruits',3.7,4.0,3.0,3),
    ('CLUB 70 NORD','Cristalline 50CL',58.7,73.0,48.0,3),
    ('CLUB 70 NORD','MUMM CORDON ROUGE',18.4,24.0,14.0,5),
    ('CLUB 70 NORD','Blanc du Seuil',8.7,10.0,7.0,4),
    ('CLUB 70 NORD','Pepsi bouteille',8.2,11.0,6.0,5),
    ('CLUB 70 NORD','Blanc Montaurone',8.0,10.0,6.0,2),
    ('CLUB 70 NORD','Perrier grande bouteille',7.2,18.0,3.0,5),
    ('CLUB 70 NORD','Rouge Les Alexandrins',6.0,8.0,5.0,4),
    ('CLUB 70 NORD','Rosé Pey Blanc',5.0,11.0,2.0,5),
    ('CLUB 70 NORD','Rosé Miraval',4.0,5.0,3.0,2),
    ('CLUB 70 NORD','Fût BUD',4.0,6.0,3.0,5),
    ('CLUB 70 NORD','Pepsi Max bouteille',3.2,6.0,1.0,5),
    ('CLUB 70 NORD','Jus de fruits',1.0,1.0,1.0,4),
    ('CLUB 70 SUD','Cristalline 50CL',44.0,58.0,26.0,3),
    ('CLUB 70 SUD','Blanc du Seuil',20.0,21.0,19.0,2),
    ('CLUB 70 SUD','MUMM CORDON ROUGE',15.3,25.0,9.0,3),
    ('CLUB 70 SUD','Blanc Galinière',14.0,14.0,14.0,1),
    ('CLUB 70 SUD','Rosé Pey Blanc',8.0,12.0,4.0,2),
    ('CLUB 70 SUD','Rosé Miraval',7.0,12.0,2.0,3),
    ('CLUB 70 SUD','Perrier grande bouteille',7.3,10.0,5.0,3),
    ('CLUB 70 SUD','Pepsi bouteille',7.0,8.0,5.0,3),
    ('CLUB 70 SUD','Rouge Les Alexandrins',6.0,9.0,4.0,3),
    ('CLUB 70 SUD','Fût BUD',4.0,5.0,3.0,4),
    ('CLUB 70 SUD','Pepsi Max bouteille',2.3,4.0,1.0,3),
    ('CLUB 70 SUD','Jus de fruits',2.0,3.0,1.0,2),
    ('LE PUB','MUMM CORDON ROUGE',20.6,30.0,8.0,5),
    ('LE PUB','Perrier grande bouteille',20.4,28.0,16.0,5),
    ('LE PUB','Pepsi bouteille',17.8,21.0,14.0,5),
    ('LE PUB','Blanc du Seuil',13.7,19.0,8.0,3),
    ('LE PUB','Blanc Galinière',10.3,16.0,6.0,4),
    ('LE PUB','Schweppes',9.2,17.0,3.0,5),
    ('LE PUB','Lillet Blanc',5.8,10.0,3.0,5),
    ('LE PUB','Rosé Miraval',4.8,6.0,3.0,5),
    ('LE PUB','Rouge Grand Boise',4.8,6.0,2.0,5),
    ('LE PUB','Pepsi Max bouteille',3.6,7.0,1.0,5),
    ('LE PUB','Jus de fruits',3.2,4.0,2.0,5),
    ('LE PUB','Whisky Jameson',3.2,5.0,2.0,5),
    ('LE PUB','Ricard classique',3.0,5.0,1.0,5),
    ('LE PUB','Fût BUD',2.8,3.0,2.0,5),
    ('LE PUB','Fût LEFFE',1.6,2.0,1.0,5),
    ('LE PUB','Lillet rosé',2.0,3.0,1.0,3),
    ('BISTROT','Corona',60.0,91.0,38.0,5),
    ('BISTROT','Cristalline 50CL',56.0,60.0,48.0,3),
    ('BISTROT','Perrier grande bouteille',21.6,28.0,13.0,5),
    ('BISTROT','Pepsi bouteille',20.8,28.0,14.0,5),
    ('BISTROT','Fada IPA',18.2,35.0,3.0,5),
    ('BISTROT','Schweppes',15.4,22.0,9.0,5),
    ('BISTROT','Fada Blanche',14.4,21.0,9.0,5),
    ('BISTROT','Blanc Montaurone',12.5,15.0,10.0,4),
    ('BISTROT','Corona 0% SS ALCOOL',10.0,32.0,1.0,5),
    ('BISTROT','Lillet Blanc',7.8,12.0,3.0,5),
    ('BISTROT','Fada Abricot',6.2,10.0,0.0,5),
    ('BISTROT','Rouge Paradis',6.5,9.0,4.0,4),
    ('BISTROT','Rosé Réal',5.8,11.0,3.0,4),
    ('BISTROT','Pepsi Max bouteille',5.8,9.0,4.0,5),
    ('BISTROT','Blanc du Seuil',5.3,12.0,0.0,5),
    ('BISTROT','Lillet rosé',5.4,10.0,2.0,5),
    ('BISTROT','Fût BUD',5.0,7.0,4.0,5),
    ('BISTROT','Jus de fruits',5.0,7.0,1.0,5),
    ('BISTROT','Ricard classique',4.0,7.0,0.0,5),
    ('BISTROT','Fût LEFFE',3.2,4.0,2.0,5),
    ('BISTROT','Whisky Jameson',2.0,3.0,1.0,4),
    ('COMPTOIR','Pepsi bouteille',7.2,8.0,6.0,4),
    ('COMPTOIR','Schweppes',6.7,13.0,3.0,3),
    ('COMPTOIR','Rosé Miraval',6.7,7.0,6.0,3),
    ('COMPTOIR','Perrier grande bouteille',6.0,7.0,4.0,4),
    ('COMPTOIR','Rouge Les Alexandrins',5.5,6.0,5.0,2),
    ('COMPTOIR','Fût BUD',5.2,6.0,4.0,4),
    ('COMPTOIR','Blanc Montaurone',3.7,6.0,1.0,3),
    ('COMPTOIR','Blanc Galinière',3.5,4.0,3.0,2),
    ('COMPTOIR','Pepsi Max bouteille',3.0,5.0,1.0,4),
    ('COMPTOIR','Jus de fruits',2.8,3.0,2.0,4),
    ('COMPTOIR','Ricard classique',2.7,4.0,1.0,3),
    ('COMPTOIR','Lillet Blanc',2.0,3.0,1.0,4),
    ('COMPTOIR','Whisky Jameson',1.7,2.0,1.0,3),
    ('BODEGA','Cristalline 50cl',59.6,136.0,16.0,5),
    ('BODEGA','GET BODEGA',42.6,52.0,22.0,5),
    ('BODEGA','BLANC MONTAURONE',29.4,54.0,17.0,5),
    ('BODEGA','Pepsi 50cl',27.8,40.0,21.0,5),
    ('BODEGA','Perrier grande bouteille',25.2,52.0,9.0,5),
    ('BODEGA','San Pellegrino 50cl',17.8,25.0,11.0,5),
    ('BODEGA','Ice Tea 50cl',15.2,37.0,7.0,5),
    ('BODEGA','Fût FADA Blonde',11.8,14.0,10.0,5),
    ('BODEGA','Rosé NAIS',11.0,18.0,2.0,5),
    ('BODEGA','Orangina 50cl',9.0,16.0,2.0,5),
    ('BODEGA','MUMM CORDON ROUGE',8.6,17.0,6.0,5),
    ('BODEGA','Pepsi bouteille',8.2,14.0,5.0,5),
    ('BODEGA','ROUGE NAIS',8.0,24.0,0.0,5),
    ('BODEGA','Jus de fruits',6.0,9.0,4.0,5),
    ('BODEGA','Fût FADA IPA',3.6,5.0,2.0,5),
    ('BODEGA','Fût FADA VP',3.2,4.0,2.0,5),
    ('BODEGA','Fût FADA Blanche',3.0,4.0,1.0,5),
    -- PMR : aucun espace de ce nom → ignoré (données conservées)
    ('PMR','FADA BLONDE BTL',143.8,189.0,115.0,4),
    ('PMR','Cristalline 50CL',77.8,131.0,35.0,4),
    ('PMR','FADA ABRICOT BTL',64.2,108.0,33.0,4),
    ('PMR','Bière en verre BUD',60.0,72.0,51.0,3),
    ('PMR','FADA BLANCHE BTL',58.2,101.0,32.0,4),
    ('PMR','Pepsi bouteille',11.5,14.0,9.0,4),
    ('PMR','Perrier grande bouteille',6.8,9.0,4.0,4),
    ('PMR','Blanc Galinière',6.5,8.0,5.0,2),
    ('PMR','Blanc du Seuil',6.0,6.0,6.0,2),
    ('PMR','Jus de fruits',4.5,6.0,3.0,4),
    ('PMR','Rosé Miraval',4.0,7.0,1.0,3),
    ('PMR','Rouge Les Alexandrins',4.7,9.0,1.0,3),
    -- BUVETTES : noms géographiques sans correspondance B1–B9 → ignoré
    ('BUVETTE NORD OUEST','Cristalline 50cl',34.6,48.0,22.0,5),
    ('BUVETTE NORD OUEST','Pepsi 50cl',29.4,47.0,15.0,5),
    ('BUVETTE NORD OUEST','Ice Tea 50cl',26.4,36.0,14.0,5),
    ('BUVETTE NORD OUEST','San Pellegrino 50cl',21.2,25.0,15.0,5),
    ('BUVETTE NORD OUEST','Orangina 50cl',19.4,34.0,10.0,5),
    ('BUVETTE NORD OUEST','Fût Bud',6.8,9.0,4.0,5),
    ('BUVETTE NORD EST','Cristalline 50cl',37.8,48.0,27.0,5),
    ('BUVETTE NORD EST','Pepsi 50cl',28.8,45.0,17.0,5),
    ('BUVETTE EST GALICE','Cristalline 50cl',27.8,45.0,13.0,5),
    ('BUVETTE EST PAGNOL','Cristalline 50cl',32.0,47.0,22.0,5),
    ('BUVETTE SUD EST','Pepsi 50cl',26.2,60.0,13.0,5),
    ('BUVETTE SUD OUEST','Cristalline 50cl',25.4,48.0,13.0,5),
    ('BUVETTE VIRAGE OUEST','Cristalline 50cl',24.2,47.0,12.0,5),
    ('BUVETTE VIRAGE SUD OUEST','Ice Tea 50cl',11.2,24.0,5.0,5)
    ) AS d(space_name, product_name, avg_c, max_c, min_c, n_match)
  LOOP
    DECLARE v_sp UUID; v_pd UUID; v_name TEXT;
    BEGIN
      -- Espace : « LOGES » → « LOGE » (correction du pluriel).
      SELECT space_id INTO v_sp FROM spaces
      WHERE UPPER(TRIM(space_name)) = UPPER(TRIM(REPLACE(rec.space_name, 'LOGES ', 'LOGE ')))
        AND active = true LIMIT 1;
      IF v_sp IS NULL THEN v_ko := v_ko + 1; v_ko_space := v_ko_space + 1; CONTINUE; END IF;

      -- Produit : alias explicite, PAS de fuzzy (jamais de mauvaise affectation).
      v_name := _resolve_product_alias(rec.product_name);
      IF v_name IS NULL THEN v_ko := v_ko + 1; v_ko_product := v_ko_product + 1; CONTINUE; END IF;
      SELECT product_id INTO v_pd FROM products
      WHERE product_name ILIKE v_name AND active = true LIMIT 1;
      IF v_pd IS NULL THEN v_ko := v_ko + 1; v_ko_product := v_ko_product + 1; CONTINUE; END IF;

      INSERT INTO space_product_coefficients (
        space_id, product_id, avg_consumption, max_consumption, min_consumption,
        total_matches, confidence_level, recommended_qty
      ) VALUES (
        v_sp, v_pd, rec.avg_c, rec.max_c, rec.min_c, rec.n_match,
        CASE WHEN rec.n_match >= 5 THEN 'très élevé'
             WHEN rec.n_match >= 4 THEN 'élevé'
             WHEN rec.n_match >= 3 THEN 'moyen'
             ELSE 'faible' END,
        ROUND(rec.avg_c * 1.20)
      )
      ON CONFLICT (space_id, product_id) DO UPDATE SET
        avg_consumption  = EXCLUDED.avg_consumption,
        max_consumption  = EXCLUDED.max_consumption,
        min_consumption  = EXCLUDED.min_consumption,
        total_matches    = EXCLUDED.total_matches,
        confidence_level = EXCLUDED.confidence_level,
        recommended_qty  = EXCLUDED.recommended_qty,
        last_computed_at = now();
      v_ok := v_ok + 1;
    END;
  END LOOP;

  -- ⚠ PAS de compute_space_coefficients() ici (écraserait la base injectée).
  RETURN json_build_object('ok', v_ok, 'ko', v_ko,
    'ko_espaces_non_trouves', v_ko_space, 'ko_produits_non_trouves', v_ko_product);
END;
$$;
GRANT EXECUTE ON FUNCTION inject_5match_coefficients() TO authenticated;
SELECT inject_5match_coefficients();

-- ── BLOC D : vue fiche runner ───────────────────────────────────────────────
CREATE OR REPLACE VIEW v_runner_sheet AS
SELECT
  s.space_name, s.service_type,
  p.product_name, p.category, p.unit, p.unit_price_ht,
  spc.avg_consumption AS conso_moy,
  spc.max_consumption AS conso_max,
  spc.min_consumption AS conso_min,
  spc.recommended_qty AS dotation_runner,
  spc.confidence_level,
  spc.total_matches   AS nb_matchs,
  ROUND(spc.recommended_qty * COALESCE(p.unit_price_ht, 0), 2) AS cout_dotation_ht,
  CASE WHEN spc.max_consumption > spc.avg_consumption * 2.5 THEN '⚡ Très variable'
       WHEN spc.max_consumption > spc.avg_consumption * 1.5 THEN '⚠️ Variable'
       ELSE '→ Stable' END AS variabilite
FROM space_product_coefficients spc
JOIN spaces   s ON s.space_id   = spc.space_id
JOIN products p ON p.product_id = spc.product_id
WHERE s.active = true AND p.active = true AND spc.avg_consumption > 0
ORDER BY s.service_type, s.space_name, spc.avg_consumption DESC;

ALTER VIEW v_runner_sheet SET (security_invoker = on);
GRANT SELECT ON v_runner_sheet TO authenticated;
REVOKE SELECT ON v_runner_sheet FROM anon;  -- RG-003 : prix/coûts admin only
