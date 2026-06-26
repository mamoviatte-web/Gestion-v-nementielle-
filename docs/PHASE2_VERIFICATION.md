# Phase 2 — Vérifications module Stocks

Les tests ci-dessous nécessitent un projet Supabase configuré (`.env` +
`schema.sql` + `rls_policies.sql` + `seed.sql`). Pour chacun : où la règle est
appliquée dans le code, et comment la vérifier manuellement.

## RG-001 — `responsable_nom` obligatoire
- **Code** : `useStock.assertResponsable()` lève une erreur si le nom < 2 car.
  avant toute écriture (ouverture / réassort / clôture). En amont, la route
  `/provider/stock` est protégée par `RequireResponsableName` et `StockEntryPage`
  redirige vers `/provider/home` si le nom n'est pas saisi.
- **Test** : se connecter `SN2026` → la page nom s'affiche ; impossible
  d'atteindre la saisie de stock sans renseigner un nom ≥ 2 caractères.

## RG-002 — Toute mutation = ligne dans `stock_movements`
- **Code** : `useStock.insertMovement()` est appelé **avant** l'écriture dans
  `event_stock_lines` pour chaque produit :
  - ouverture → mouvement `entrée`
  - réassort → mouvement `réassort`
  - clôture → mouvement `inventaire`
- **Test** : après chaque validation, vérifier en base
  `select * from stock_movements where event_id = … order by created_at desc`.

## RG-003 — Aucun prix HT côté Responsable
- **Code** : en contexte Responsable, `useProducts(false)` lit la vue
  `products_public` (sans `unit_price_ht`). La RLS ne pose **aucune** policy de
  SELECT sur `products` pour le rôle Responsable. Aucune page provider
  n'affiche de prix ni de coût.
- **Test** : connecté en `SN2026`, dans l'onglet réseau des devtools, vérifier
  qu'aucun appel `/rest/v1/products?...unit_price_ht...` n'aboutit (la requête
  directe sur `products` renvoie 0 ligne ; l'app interroge `products_public`).

## RG-004 — Consommation négative bloquante sans commentaire
- **Code** : `useStock` (mutation de clôture) valide **toutes** les lignes
  avant écriture : si `initial + réassort − final < 0` et `anomaly_comment`
  vide → `throw` (aucune écriture). Côté UI, `ClosingForm` affiche le champ
  d'anomalie dès qu'une consommation devient négative.
- **Test** : en clôture, saisir un restant > (initial + réassort) sans
  commentaire → message d'erreur bloquant ; renseigner le commentaire →
  la validation passe.

## RG-005 — Prix manquant : alerte, pas de blocage
- **Code** : `formatEuro(null)` → « — ». `StockDotationsTable` affiche un badge
  « Prix manquant », exclut ces produits du total et signale un total partiel.
- **Test** : côté admin, un produit Matériel (sans prix) apparaît avec le badge
  et n'est pas compté dans le total HT.

## RG-006 — Clôture événement = ROLE_STADE
- Hors périmètre Phase 2 (bouton de clôture d'événement traité en Phase 6).
  La RLS réserve déjà l'écriture sur `events` au ROLE_STADE.

## Build / type-check
- `npm run type-check` → 0 erreur.
- `npm run build` → succès.
