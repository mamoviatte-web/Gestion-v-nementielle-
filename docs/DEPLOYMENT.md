# Déploiement & checklist finale — Stade Maurice David

## 1. Checklist de tests manuels (règles de gestion)

| Règle | Scénario | Attendu |
|-------|----------|---------|
| RG-001 | Connexion `SN2026` → page nom | Impossible de saisir un stock sans nom ≥ 2 caractères |
| RG-002 | Saisir un stock initial | Une ligne apparaît dans `stock_movements` (`entrée`) |
| RG-003 | Devtools réseau en `SN2026` | Aucun `unit_price_ht` dans les réponses API provider |
| RG-004 | Clôture avec final > initial + réassort | Erreur bloquante + champ commentaire requis |
| RG-005 | Produit sans prix | Badge « Prix manquant », total affiché « — » / partiel |
| RG-006 | Compte Responsable | Bouton « Clôturer l'événement » absent (réservé Stade) |
| RG-008 | Arrivée réelle 20 min après prévue | Statut `en_retard` + badge rouge dashboard/sidebar |

> Les tests RG-002/003/004 se vérifient avec un projet Supabase configuré.
> Voir aussi `docs/PHASE2_VERIFICATION.md`.

## 2. Performance (mise en œuvre)

- **Filtrage `event_id`** systématique sur toutes les requêtes de volume.
- **react-query `staleTime: 30s`** sur les données de référence (produits,
  événements, espaces, alertes prestataires).
- **Pagination** de l'historique des mouvements (50 lignes/page,
  `MovementHistory`).
- **Code-splitting** des pages via `React.lazy` + `Suspense`.
- **`useMemo`** sur les agrégats coûteux (totaux par espace, stats événement).

## 3. Offline-first basique

- Brouillon de débrief sauvegardé en `localStorage` toutes les 30 s
  (`useAutosaveDraft`) et restauré au montage.
- Toast « Données sauvegardées localement » si la soumission échoue hors ligne.
- Indicateur « Hors ligne » dans l'en-tête Responsable.

## 4. Supabase

1. Région **eu-west-1 (Frankfurt)** — RGPD.
2. SQL Editor, dans l'ordre : `supabase/schema.sql`,
   `supabase/rls_policies.sql`, `supabase/seed.sql`.
3. Vérifier que **RLS est activé** sur toutes les tables.
4. Créer les comptes d'authentification :
   - Admin (`ROLE_STADE`) via le Dashboard, metadata
     `{ "role": "ROLE_STADE", "name": "Admin Stade" }`.
   - Les 16 Responsables via le script :
     ```bash
     SUPABASE_URL="https://xxxx.supabase.co" \
     SUPABASE_SERVICE_ROLE_KEY="..." \
     npx tsx scripts/create-providers.ts
     ```
     ⚠ La `service_role` key ne doit jamais être commitée.

## 5. Vercel

1. Importer le dépôt dans Vercel (framework détecté : Vite).
2. Variables d'environnement (Project Settings → Environment Variables) :
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
3. `vercel.json` fournit déjà les *rewrites* SPA (toutes les routes →
   `index.html`).
4. Déployer : `vercel --prod`.

## 6. Checklist avant livraison

- [ ] `npm run build` → 0 erreur TypeScript
- [ ] `npm run preview` → application fonctionnelle
- [ ] Login admin → dashboard complet
- [ ] Login `SN2026` → saisie nom → stocks sans prix
- [ ] Ouverture + réassort + clôture sur un espace
- [ ] Export Excel téléchargé et lisible (Excel/LibreOffice)
- [ ] Mobile (iPhone Safari / Android Chrome)
- [ ] RLS vérifié (aucun prix dans les appels API provider)
- [ ] Région Supabase eu-west-1 confirmée
- [ ] Déploiement Vercel HTTPS
