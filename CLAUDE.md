# Stade Maurice David — Provence Rugby
## CDC V1.1 — Source de vérité pour toutes les sessions Claude Code

---

## STACK TECHNIQUE
```
Frontend    : React 18 + Vite + TypeScript strict + Tailwind CSS
Backend     : Supabase (PostgreSQL + Auth + RLS + REST API)
Export      : SheetJS (xlsx)
Routing     : React Router v6
État global : React Context + useReducer
Déploiement : Vercel (frontend) + Supabase région eu-west-1 Frankfurt (RGPD)
```

---

## CONVENTIONS DE CODE
- Interface : français partout (libellés, messages, erreurs, placeholders)
- Variables / fonctions : anglais camelCase
- Composants : PascalCase
- TypeScript strict, zéro `any`
- Dates : `new Date(d).toLocaleDateString('fr-FR', {...})`
- Monnaie : `value.toFixed(2) + ' € HT'`
- Imports absolus via alias `@/` → `src/`

---

## MODÈLE DE DONNÉES — 10 TABLES (noms et colonnes EXACTS)

### Table `spaces` — 16 espaces du stade
```sql
CREATE TABLE spaces (
  space_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_name  TEXT NOT NULL,
  space_type  TEXT NOT NULL CHECK (space_type IN ('VIP','Bar','Buvette')),
  access_code TEXT UNIQUE NOT NULL,
  capacity    INT,
  active      BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT now()
);
```

### Table `users`
```sql
CREATE TABLE users (
  user_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  email         TEXT UNIQUE,
  role          TEXT NOT NULL CHECK (role IN ('ROLE_STADE','ROLE_RESPONSABLE')),
  space_id      UUID REFERENCES spaces(space_id),
  is_active     BOOLEAN DEFAULT true,
  last_login_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT now()
);
```

### Table `products` — catalogue (cible 269 produits)
```sql
CREATE TABLE products (
  product_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_name  TEXT NOT NULL,
  category      TEXT NOT NULL CHECK (category IN ('Vins','Bières','Soft','Sirops','Spiritueux','Matériel')),
  unit          TEXT NOT NULL,
  packaging     TEXT,
  unit_price_ht DECIMAL(10,2),   -- NULL autorisé → alerte RG-005
  stock_min     INT DEFAULT 0,
  active        BOOLEAN DEFAULT true
);
```

### Table `events`
```sql
CREATE TABLE events (
  event_id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_name         TEXT NOT NULL,
  event_type         TEXT CHECK (event_type IN ('match','séminaire','cocktail','réception_vip','événement_partenaire','réunion','autre')),
  event_date         DATE NOT NULL,
  start_time         TIME,
  end_time           TIME,
  expected_attendees INT,
  status             TEXT DEFAULT 'brouillon' CHECK (status IN ('brouillon','préparé','en_cours','clôture_en_attente','clôturé','archivé')),
  created_at         TIMESTAMPTZ DEFAULT now()
);
```

### Table `event_spaces` — espaces activés par événement
```sql
CREATE TABLE event_spaces (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id                 UUID NOT NULL REFERENCES events(event_id) ON DELETE CASCADE,
  space_id                 UUID NOT NULL REFERENCES spaces(space_id),
  responsible_default_name TEXT,
  UNIQUE(event_id, space_id)
);
```

### Table `runner_dotations` — fiches runner digitalisées (CDC §8)
```sql
CREATE TABLE runner_dotations (
  dotation_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        UUID NOT NULL REFERENCES events(event_id),
  space_id        UUID NOT NULL REFERENCES spaces(space_id),
  product_id      UUID NOT NULL REFERENCES products(product_id),
  planned_qty     INT NOT NULL DEFAULT 0,
  office_qty      INT DEFAULT 0,
  cartons_to_move INT DEFAULT 0,
  runner_status   TEXT DEFAULT 'à_préparer' CHECK (runner_status IN ('à_préparer','préparé','monté','contrôlé','annulé')),
  runner_comment  TEXT,
  updated_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE(event_id, space_id, product_id)
);
```

### Table `event_stock_lines` — état stock par événement/espace/produit (CDC §9)
```sql
-- ATTENTION : consumed_qty est CALCULÉ côté applicatif
-- consumed_qty = initial_qty + reassort_qty - final_qty
CREATE TABLE event_stock_lines (
  line_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        UUID NOT NULL REFERENCES events(event_id),
  space_id        UUID NOT NULL REFERENCES spaces(space_id),
  product_id      UUID NOT NULL REFERENCES products(product_id),
  initial_qty     INT DEFAULT 0,
  reassort_qty    INT DEFAULT 0,
  final_qty       INT,              -- NULL tant que clôture non faite
  product_state   TEXT CHECK (product_state IN ('fermé','ouvert','cassé','perdu','périmé','fût_vide','fût_percuté')),
  anomaly_comment TEXT,             -- obligatoire si conso < 0 (RG-004)
  responsable_nom TEXT NOT NULL,    -- RG-001 : traçabilité nominative obligatoire
  submitted_at    TIMESTAMPTZ,
  UNIQUE(event_id, space_id, product_id)
);
```

### Table `stock_movements` — historique complet (RG-002)
```sql
CREATE TABLE stock_movements (
  movement_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        UUID NOT NULL REFERENCES events(event_id),
  space_id        UUID NOT NULL REFERENCES spaces(space_id),
  product_id      UUID NOT NULL REFERENCES products(product_id),
  movement_type   TEXT NOT NULL CHECK (movement_type IN ('entrée','sortie','réassort','retour','casse','perte','correction','inventaire')),
  qty             INT NOT NULL,
  responsable_nom TEXT NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT now()
);
```

### Table `provider_presence` — prestataires présents (CDC §7)
```sql
CREATE TABLE provider_presence (
  provider_presence_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id              UUID NOT NULL REFERENCES events(event_id),
  space_id              UUID REFERENCES spaces(space_id),   -- NULL = tout stade
  provider_company      TEXT NOT NULL,
  provider_type         TEXT NOT NULL CHECK (provider_type IN ('traiteur','sécurité','nettoyage','technique','logistique','animation','autre')),
  provider_contact_name TEXT,
  provider_phone        TEXT,
  planned_arrival_time  TIME,
  actual_arrival_time   TIME,
  planned_start_time    TIME,
  actual_start_time     TIME,
  planned_end_time      TIME,
  actual_end_time       TIME,
  actual_departure_time TIME,
  status                TEXT DEFAULT 'prévu' CHECK (status IN ('prévu','présent','en_retard','terminé','absent','annulé')),
  responsable_nom       TEXT,
  comment               TEXT
);
```

### Table `schedules` — horaires staff par espace
```sql
CREATE TABLE schedules (
  schedule_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id             UUID NOT NULL REFERENCES events(event_id),
  space_id             UUID NOT NULL REFERENCES spaces(space_id),
  staff_name           TEXT NOT NULL,
  role                 TEXT,
  planned_arrival      TIME,
  planned_departure    TIME,
  actual_departure     TIME,
  confirmed_by_staff   BOOLEAN DEFAULT false,
  confirmed_by_manager BOOLEAN DEFAULT false
);
```

### Table `debriefs` — formulaire post-événement (7 sections)
```sql
CREATE TABLE debriefs (
  debrief_id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id                UUID NOT NULL REFERENCES events(event_id),
  space_id                UUID NOT NULL REFERENCES spaces(space_id),
  responsable             TEXT NOT NULL,
  -- 1.1 Effectif
  nb_personnes            INT,
  effectif_adapte         TEXT,
  effectif_comment        TEXT,
  efficacite              TEXT,
  efficacite_comment      TEXT,
  suggestion_effectif     TEXT,
  -- 1.2 Organisation
  amenagement             TEXT,
  amenagement_comment     TEXT,
  problemes_espace        TEXT,
  -- 1.3 Stocks
  stocks_suffisants       TEXT,
  stocks_comment          TEXT,
  suggestions_stocks      TEXT,
  besoins_materiel        TEXT,
  -- 2.1 Communication interne
  consignes_claires       TEXT,
  consignes_comment       TEXT,
  problemes_coordination  TEXT,
  -- 2.2 Communication clients
  retours_clients         TEXT,
  retours_clients_detail  TEXT,
  -- 3. Propreté
  espace_etat_bon         TEXT,
  espace_etat_comment     TEXT,
  problemes_dechets       TEXT,
  suggestions_proprete    TEXT,
  -- 5. Suggestions
  suggestions_generales   TEXT,
  besoins_specifiques     TEXT,
  signature               BOOLEAN DEFAULT false,
  submitted_at            TIMESTAMPTZ,
  created_at              TIMESTAMPTZ DEFAULT now(),
  UNIQUE(event_id, space_id)
);
```

---

## RÈGLES MÉTIER CRITIQUES (CDC §12) — À implémenter sans exception

| Code  | Règle | Contrôle côté code |
|-------|-------|--------------------|
| RG-001 | `responsable_nom` obligatoire sur toutes les saisies ROLE_RESPONSABLE | Bloquer si vide ou < 2 caractères. Écran de saisie nom avant toute action. |
| RG-002 | Toute modification de stock = ligne dans `stock_movements` | INSERT dans stock_movements AVANT UPDATE event_stock_lines |
| RG-003 | ROLE_RESPONSABLE ne voit jamais `unit_price_ht` ni les coûts | RLS Supabase + masquage front. Jamais exposé dans l'API. |
| RG-004 | Consommation négative = anomalie, `anomaly_comment` obligatoire | Bloquer le submit si `initial_qty + reassort_qty - final_qty < 0` sans commentaire |
| RG-005 | Prix HT manquant → alerte visible, ne bloque pas l'opérationnel | Badge "Prix manquant", total financier affiché "—" |
| RG-006 | Clôture événement = ROLE_STADE uniquement | Bouton masqué + vérification backend |
| RG-007 | Horaires format HH:MM | Validation champ `time` HTML5 |
| RG-008 | Retard prestataire > 15 min → statut `en_retard` + alerte dashboard | `actual_arrival_time - planned_arrival_time > 15 min` |
| RG-009 | Produit supprimé → `active=false`, historique conservé | Pas de DELETE, UPDATE active=false uniquement |
| RG-010 | Erreurs source #REF! → isolées, pas intégrées au total | Contrôle à l'import, ne pas inclure dans totaux |

---

## FORMULES CENTRALES (src/lib/calculations.ts)
```typescript
// CDC §9 — formule principale
consumed_qty = initial_qty + reassort_qty - final_qty
consumption_cost_ht = consumed_qty * unit_price_ht  // null si unit_price_ht null

// CDC §7 — prestataires
delay_minutes = toMinutes(actual_arrival_time) - toMinutes(planned_arrival_time)
presence_duration_hours = (toMinutes(actual_departure) - toMinutes(actual_arrival)) / 60
// Gérer passage minuit : si diff < 0, ajouter 1440

// RG-008 : statut prestataire
if (actual_departure_time) → 'terminé'
if (!actual_arrival_time) → 'prévu'
if (delay_minutes > 15) → 'en_retard'
else → 'présent'

// KPI taux de retour
return_rate = final_qty / (initial_qty + reassort_qty)
```

---

## 16 ESPACES — DONNÉES DE RÉFÉRENCE EXACTES (seed.sql)
```
Salon Nord       | VIP     | SN2026
Salon Sud        | VIP     | SS2026
Le Pub           | Bar     | PUB2026
Loge Est         | VIP     | LE2026
Comptoir         | Bar     | CO2026
Bistrot          | Bar     | BI2026
Loge Ouest Nord  | VIP     | LON2026
Loge Ouest Sud   | VIP     | LOS2026
Wine bar Nord    | Bar     | WBN2026
Wine bar Sud     | Bar     | WBS2026
Club 70 Nord     | Bar     | C70N26
Club 70 Sud      | Bar     | C70S26
Terrasses        | Bar     | TER2026
Bodega           | Bar     | BOD2026
Buvette 1        | Buvette | BV12026
Buvette 2        | Buvette | BV22026
```

---

## 25 PRODUITS — DONNÉES DE RÉFÉRENCE EXACTES (seed.sql)
```
-- VINS (5)
Mumm Cordon Rouge       | Vins        | btl  | 23.96
Mumm Blanc de Blanc     | Vins        | btl  | 38.11
Rosé Réal               | Vins        | btl  |  8.70
Rosé Pey Blanc          | Vins        | btl  |  7.20
Rosé Miraval            | Vins        | btl  | 12.50
-- BIÈRES (3)
Fût BUD                 | Bières      | fût  | 97.95
Fût LEFFE               | Bières      | fût  | 129.75
Bière en verre          | Bières      | u    |  1.34
-- SOFT (4)
Pepsi bouteille         | Soft        | btl  |  1.80
Cristaline 50cl         | Soft        | btl  |  0.17
Jus de fruits           | Soft        | btl  |  2.60
Schweppes               | Soft        | btl  |  2.41
-- SIROPS (4)
Sirop de pêche          | Sirops      | btl  |  6.45
Sirop de grenadine      | Sirops      | btl  |  5.01
Sirop de menthe         | Sirops      | btl  |  5.50
Sirop de citron         | Sirops      | btl  |  4.80
-- SPIRITUEUX (5)
Whisky Jameson          | Spiritueux  | btl  | 18.59
Lillet Blanc            | Spiritueux  | btl  | 12.52
Lillet Rosé             | Spiritueux  | btl  | 13.10
Ricard classique        | Spiritueux  | btl  | 16.79
GET 27                  | Spiritueux  | btl  | 12.21
-- MATÉRIEL (4) — sans prix HT (unit_price_ht = NULL)
Housses Mange debout    | Matériel    | u    | NULL
Housses Buffet          | Matériel    | u    | NULL
Housse Desk D'accueil   | Matériel    | u    | NULL
Nappes de rechange      | Matériel    | u    | NULL
```

---

## DEUX ACCÈS UTILISATEURS (CDC §4)

### ROLE_STADE
- Login : email + mot de passe Supabase Auth standard
- Accès complet : dashboard, coûts, tous espaces, exports, clôture

### ROLE_RESPONSABLE
- Login : code espace = email `{code}@stade.fr` + password = `{code}`
  → Exemple : SN2026 → email `SN2026@stade.fr`, password `SN2026`
- Metadata Supabase : `{ role: 'ROLE_RESPONSABLE', space_id: uuid }`
- Doit saisir `responsable_nom` (min 2 car.) avant toute action → RG-001
- Voit uniquement son espace et ses événements ouverts
- Ne voit JAMAIS `unit_price_ht` ni aucun coût

### Politiques RLS critiques
```sql
-- ROLE_RESPONSABLE : jamais accès aux prix
-- Sur products : SELECT sans unit_price_ht (utiliser une vue ou security invoker)
-- Sur event_stock_lines : SELECT/INSERT/UPDATE filtrés par space_id
-- Sur runner_dotations : SELECT uniquement (pas d'écriture)
-- Sur events : SELECT uniquement si son space_id dans event_spaces
-- Toutes les autres tables admin (users, event global) : interdites
```

---

## MATRICE DES DROITS (CDC §4.1)
```
Fonctionnalité                  | ROLE_STADE | ROLE_RESPONSABLE
Dashboard global                | ✅         | ❌
Créer un événement              | ✅         | ❌
Voir tous les espaces           | ✅         | ❌ (son espace uniquement)
Créer/modifier produit          | ✅         | ❌ (lecture seule, sans prix)
Voir unit_price_ht et coûts     | ✅         | ❌ (RG-003, RLS)
Saisir stock initial/réassort   | ✅         | ✅ (avec responsable_nom — RG-001)
Saisir stock final (clôture)    | ✅         | ✅ (avec product_state + RG-004)
Avancer runner_status           | ✅         | ❌
Clôturer un événement           | ✅         | ❌ (RG-006)
Saisir/voir provider_presence   | ✅         | ✅ (son espace)
Saisir horaires staff           | ✅         | ✅ (son espace)
Remplir débrief                 | ✅         | ✅ (son espace)
Exporter Excel                  | ✅         | ❌
```

---

## ROADMAP MVP (CDC §15)
```
Phase 1 — Base        : setup, schema DB, auth 2 rôles, référentiels, routing ← EN COURS
Phase 2 — Stocks      : ouverture/réassort/clôture, RG-001/002/003/004/005
Phase 3 — Dotations   : runner_dotations, runner_status lifecycle
Phase 4 — Prestataires: provider_presence, calculs retard, RG-008
Phase 5 — Staff/Débrief: schedules, formulaire débrief 7 sections
Phase 6 — Dashboard   : KPIs, alertes, totaux
Phase 7 — Export      : xlsx 3 feuilles, déploiement
```

---

## STRUCTURE DES DOSSIERS (EXACTE)
```
src/
├── components/
│   ├── ui/              → Badge, Button, Input, Select, Textarea, Table, Alert, Spinner, EmptyState
│   ├── stock/           → StockTable, DotationRow, MovementHistory, RunnerStatusBadge
│   ├── providers/       → ProviderCard, PresenceTable
│   └── layout/          → AdminLayout, ProviderLayout, Sidebar
├── pages/
│   ├── auth/            → LoginPage.tsx
│   ├── admin/           → DashboardPage, EventsPage, EventDetailPage, CatalogPage, SpacesPage, ExportPage
│   └── provider/        → ProviderHomePage (saisie nom RG-001), StockEntryPage, SchedulePage, DebriefPage
├── hooks/               → useAuth, useEvents, useStock, useProviders, useDebriefs
├── lib/                 → supabase.ts, types.ts, calculations.ts
└── context/             → AuthContext.tsx
supabase/
├── schema.sql           → DDL complet (10 tables + contraintes + index)
├── rls_policies.sql     → Politiques RLS par rôle
└── seed.sql             → 16 espaces + 25 produits + 1 événement démo + compte admin
```

---

## VARIABLES D'ENVIRONNEMENT
```bash
VITE_SUPABASE_URL=https://[projet].supabase.co
VITE_SUPABASE_ANON_KEY=[clé-anon-publique]
```

---

## CONTRAINTES NON-NÉGOCIABLES
1. RLS Supabase activé sur toutes les tables — `unit_price_ht` jamais exposé à ROLE_RESPONSABLE
2. Mobile-first interface provider : font ≥ 14px, zones tactiles ≥ 44px
3. Supabase region `eu-west-1` (Frankfurt) — RGPD obligatoire
4. RG-002 : chaque mutation stock = ligne dans stock_movements (jamais bypasser)
5. Performance : toujours filtrer par `event_id`, jamais charger toute la DB
