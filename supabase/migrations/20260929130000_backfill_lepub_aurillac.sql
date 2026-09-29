-- =====================================================================
-- BACK-FILL fiche « Le Pub » — match AURILLAC (event 7720c0de-…-687a)
-- ---------------------------------------------------------------------
-- CONTEXTE : Le Pub était bien activé sur Aurillac (event_spaces) mais AUCUNE
--   ligne de stock n'avait été saisie (nb_lignes = 0). L'utilisateur fournit la
--   fiche papier de consommation du Pub pour Aurillac ; on l'intègre.
--
-- POURQUOI CE FICHIER (et pas une saisie live) : Aurillac est CLÔTURÉ et le
--   stock central des fûts vient d'être ré-ancré au comptage physique. Écrire
--   ces lignes en passant par le trigger de dispatch `on_initial_entered`
--   RE-DÉBITERAIT le central d'aujourd'hui (double dispatch d'un match passé) →
--   corromprait l'alignement. On neutralise donc `trg_initial_entered` le temps
--   de l'INSERT, dans une transaction atomique (réactivation garantie même en
--   cas d'erreur : ALTER TABLE est transactionnel).
--   • L'INSERT est autorisé sur un événement clôturé (le verrou
--     `trg_lock_closed_lines` ne couvre que UPDATE/DELETE, pas INSERT).
--   • `auto_compute_line_cost` (BEFORE INSERT) calcule tout seul
--     `consumed_qty = initial + réassort − final` et `consumption_cost_ht`.
--   • `on_stock_final_entered` ne se déclenche qu'en UPDATE → ne touche pas le
--     live ici (voulu : le live est déjà aligné au comptage physique).
--
-- APRÈS APPLICATION (étapes live, à lancer séparément après validation) :
--   -- Reporter les finals du Pub dans son stock d'espace (dernier match) :
--   --   select reanchor_espace_live_to_last_match(
--   --     'aad36e50-255a-4845-8d54-42e5eee453bf', null, true);  -- dry-run puis false
--   -- Rafraîchir les tendances de conso de l'espace :
--   --   select compute_space_coefficients();   (ou recalcul DataPilot)
--
-- Conso recalculée = fiche à l'unité près (ex. Mumm 35−22=13, Fût BUD 8−4=4,
--   Lillet Blanc 8+8−11=5, Ricard classique 2+2−1=3). Les rangées vides de la
--   fiche (aucun stock) sont volontairement ignorées. RG-001 (responsable tracé),
--   RG-002 (aucun mouvement live forcé ici), coûts via prix catalogue.
-- =====================================================================

do $$
begin
  alter table public.event_stock_lines disable trigger trg_initial_entered;

  insert into public.event_stock_lines
    (event_id, space_id, product_id, initial_qty, reassort_qty, final_qty,
     product_state, responsable_nom, submitted_at)
  select '7720c0de-2e1b-4258-904e-830cf8bd687a'::uuid,
         'aad36e50-255a-4845-8d54-42e5eee453bf'::uuid,
         v.pid::uuid, v.ini, v.rea, v.fin, 'fermé',
         'M. Viatte (fiche Le Pub — Aurillac)', now()
  from (values
    ('ef052c42-caec-4b2d-9f34-9f298e97383b', 35, 0, 22),  -- Mumm Cordon Rouge
    ('00755134-7027-4ae9-be41-9f953c5eab30',  5, 0,  1),  -- Rosé Réal
    ('056a3e3a-c074-457c-9966-a5c98040e8a1',  1, 0,  1),  -- Rosé Miraval
    ('e17d4f66-b29b-464d-9236-cc69ad83b768', 25, 0, 23),  -- Rouge Grand Boise
    ('333bb2dd-7016-4dd1-b401-2a4a2d00ae21', 26, 0, 20),  -- Blanc du Seuil
    ('6cc890cc-ad92-49ce-ae90-1ab60909d92c',  6, 0,  3),  -- Blanc Montaurone
    ('5459c24f-0993-4538-8a85-7c0bfa174d17',  8, 0,  4),  -- Fût BUD
    ('1b99d9a0-4294-4cc9-baa8-7b57b13d3f28',  2, 0,  0),  -- Fût LEFFE
    ('0583ad72-5c12-4203-a186-0f4310aad9f8',  4, 0,  4),  -- CO2
    ('800e26a7-5d25-4a2e-96eb-feabac36fe1a', 12, 0,  3),  -- Pepsi bouteille 1L+
    ('db3ce9c0-1e46-4cb1-a53a-5a073669f96b',  3, 0,  1),  -- Pepsi Max bouteille
    ('e4f25bc7-dd41-4036-aff6-877c925e1679', 12, 0,  5),  -- Perrier grande bouteille
    ('8b33ceba-1945-4539-b5c8-142820504554', 13, 0,  5),  -- Schweppes
    ('c430ebe8-e635-48e3-b41f-aa1b30303d61',  1, 0,  1),  -- Sirop de pêche
    ('c00a79f4-f560-4e54-bcae-da4444a8c438',  0, 1,  1),  -- Sirop de menthe
    ('dec7af25-40d4-4a4d-b7d3-deed6d6b108c',  2, 0,  2),  -- Sirop de grenadine
    ('69217d5b-a1c1-4764-ad95-5417f29ad52d',  1, 0,  1),  -- Sirop de citron
    ('651fce04-bf3f-4d3e-a1d7-ddd4a05a6afe',  1, 0,  1),  -- Sirop Orgeat
    ('271f1cdb-49c6-4bd0-a029-d5f839bfc84a',  9, 0,  0),  -- Cristaline 50cl
    ('03d4c105-1fb6-4eb4-89d4-f11ea3764d87',  3, 0,  2),  -- Whisky Jameson
    ('27d55c20-9761-4c39-a6bf-a6c5faf9334e',  8, 8, 11),  -- Lillet Blanc
    ('766c7278-e14f-442f-86c5-25c17aace260', 16, 0, 13),  -- Lillet Rosé
    ('40de0dac-e3e4-409f-8fef-5c87234490cc',  2, 2,  1)   -- Ricard classique
  ) as v(pid, ini, rea, fin);

  alter table public.event_stock_lines enable trigger trg_initial_entered;
end $$;

-- VÉRIFICATION (lecture) :
--   select p.product_name, l.initial_qty, l.reassort_qty, l.final_qty, l.consumed_qty, l.consumption_cost_ht
--     from event_stock_lines l join products p on p.product_id=l.product_id
--    where l.event_id='7720c0de-2e1b-4258-904e-830cf8bd687a'
--      and l.space_id='aad36e50-255a-4845-8d54-42e5eee453bf'
--    order by p.category, p.product_name;
--   -- Contrôle : stock_balances(« Stockage Fûts ») BUD/LEFFE INCHANGÉS (23 / 21).
-- =====================================================================
