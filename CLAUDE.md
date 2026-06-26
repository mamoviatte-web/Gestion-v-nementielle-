# CLAUDE.md — Stade Maurice David (CDC V1.1 — Provence Rugby)

> ⚠️ **Note de provenance.** Le fichier `CLAUDE.md` original du CDC n'était pas
> présent dans le dépôt au démarrage de la Session 1. Ce document a été
> **reconstruit** à partir des spécifications embarquées dans
> `PROMPT_SESSION_1.md`. Le **modèle de données détaillé (colonnes)** a été
> **inféré** des calculs métier, des politiques RLS et du seed. Si le CDC
> original est retrouvé, vérifier les noms/colonnes de tables et ajuster
> `src/lib/types.ts`, `supabase/schema.sql` et le seed en conséquence.

Application de gestion événementielle pour le Stade Maurice David
(boissons & matériel par espace, pour Provence Rugby).

## Stack technique

- **Frontend** : React 18 + TypeScript (strict, jamais de `any`) + Vite
- **Styles** : Tailwind CSS v3
- **Routing** : react-router-dom v6
- **Données / Auth** : Supabase (PostgreSQL + RLS)
- **State serveur** : @tanstack/react-query
- **Export** : xlsx
- **Icônes** : lucide-react ; **classes** : clsx
- **Alias** : `@/` → `src/`

### Conventions

- Noms de variables/identifiants en **anglais**, libellés UI en **français**.
- TypeScript **strict**, aucun `any`.
- Composants UI sans logique métier dans `src/components/ui`.

## Rôles & règles de gestion

Deux rôles applicatifs (lus depuis `user_metadata` du JWT Supabase) :

- **ROLE_STADE** — back-office complet (accès total).
- **ROLE_RESPONSABLE** — responsable d'un espace, accès restreint à son
  `space_id`.

Règles de gestion référencées :

- **RG-001** — le responsable saisit son nom à la connexion (stocké en
  `sessionStorage`, repris dans `event_spaces.responsable_name`).
- **RG-003** — le prix HT (`unit_price_ht`) est **masqué** au ROLE_RESPONSABLE
  (vue `event_stock_lines_public` + le client ne sélectionne jamais la colonne).
- **RG-005** — un coût est `null` si le prix unitaire est manquant.
- **RG-008** — statut prestataire calculé selon retard/présence/départ.
- **CDC §9** — formule centrale : `consommé = (initial + réassort) − final`.

## Modèle de données — 10 tables

| Table | Rôle |
|-------|------|
| `spaces` | Les 16 espaces du stade (code d'accès unique). |
| `products` | Catalogue produits (boissons + matériel), prix HT nullable. |
| `events` | Événements (matchs, séminaires, privatisations). |
| `event_spaces` | Espaces ouverts pour un événement (+ nom responsable). |
| `runner_dotations` | Dotations logistiques préparées par le Stade. |
| `event_stock_lines` | Stock initial / réassort / final par espace·produit. |
| `stock_movements` | Journal des mouvements de stock. |
| `provider_presence` | Présence prestataires (RG-008). |
| `schedules` | Horaires du personnel par espace. |
| `debriefs` | Débrief de fin d'événement par espace. |

Le DDL complet, les contraintes CHECK (enums), index et triggers sont dans
`supabase/schema.sql`. Les types TypeScript miroir sont dans `src/lib/types.ts`.

## Les 16 espaces (codes)

`SN2026` Salon Nord · `SS2026` Salon Sud · `PUB2026` Le Pub ·
`LE2026` Loge Est · `CO2026` Comptoir · `BI2026` Bistrot ·
`LON2026` Loge Ouest Nord · `LOS2026` Loge Ouest Sud ·
`WBN2026` Wine bar Nord · `WBS2026` Wine bar Sud ·
`C70N26` Club 70 Nord · `C70S26` Club 70 Sud ·
`TER2026` Terrasses · `BOD2026` Bodega ·
`BV12026` Buvette 1 · `BV22026` Buvette 2.

## Structure du projet

```
src/
  lib/          types.ts, calculations.ts, supabase.ts
  context/      AuthContext.tsx
  components/
    ui/         Badge, Button, Input, Select, Textarea, Table, Alert, Spinner, EmptyState
    layout/     AdminLayout, ProviderLayout, PageHeader
    ProtectedRoute.tsx, RequireResponsableName.tsx
  pages/
    auth/       LoginPage
    admin/      Dashboard, Events, EventDetail, Catalog, Spaces, Export
    provider/   ProviderHome (RG-001), StockEntry, Schedule, Debrief
  hooks/        (à venir)
  services/     (accès données Supabase, à venir)
supabase/       schema.sql, rls_policies.sql, seed.sql
```

## Routing

```
/                 → redirige selon le rôle connecté
/login            → public

/admin/dashboard  /admin/events  /admin/events/:id
/admin/catalog    /admin/spaces  /admin/export      (ROLE_STADE)

/provider/home    (saisie nom RG-001)
/provider/stock   /provider/schedule  /provider/debrief  (ROLE_RESPONSABLE)
```

## Authentification

- **Équipe Stade** : email + mot de passe.
- **Responsable** : un seul champ « code d'accès » (ex : `SN2026`).
  L'email envoyé est `{code}@stade.fr` et le mot de passe est le code lui-même.

## Démarrage

```bash
cp .env.example .env      # renseigner VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
npm install
npm run dev               # http://localhost:5173
npm run build             # build de production
npm run type-check        # vérification de types (zéro any)
```

Côté Supabase, exécuter dans l'ordre : `schema.sql`, `rls_policies.sql`,
`seed.sql`.

## État d'avancement

- **Phase 1 (terminée)** : init projet, types, calculs, client Supabase,
  schéma + RLS + seed SQL, AuthContext, login deux modes, routing protégé,
  layouts, composants UI de base. Les pages métier sont des écrans-placeholder.
