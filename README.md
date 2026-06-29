# Stade Maurice David — Application de gestion opérationnelle

Provence Rugby | CDC V1.1

Gestion événementielle (boissons & matériel par espace) : stocks, dotations
runner, prestataires, horaires staff, débriefs, dashboard et export Excel.

Stack : **React 18 + Vite + TypeScript + Tailwind CSS + Supabase**.

## 🚀 Application en ligne

URL cible (après déploiement Vercel) : `https://stade-maurice-david.vercel.app`
*(le déploiement nécessite `vercel login` — voir [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md)).*

## Comptes de démonstration

### Équipe Stade (vision complète, prix & coûts)
| Email | Mot de passe |
|-------|--------------|
| `mviatte@provencerugby.com` | `StadeMD2026!` |
| `csadras@provencerugby.com` | `StadeMD2026!` |
| `amartinez@provencerugby.com` | `StadeMD2026!` |

### Responsables d'espaces (saisie terrain, sans prix)
| Espace | Email | Mot de passe |
|--------|-------|--------------|
| Salon Nord | `sn2026@stade.fr` | `SN2026` |
| Buvette 1 | `bv12026@stade.fr` | `BV12026` |
| Le Pub | `pub2026@stade.fr` | `PUB2026` |
| *(les 16 espaces, code en majuscules)* | `{code}@stade.fr` | `{CODE}` |

### Scénario de démonstration
1. Connexion **admin** → dashboard avec un événement **archivé** (vs Vannes,
   données complètes) et un **en cours** (vs Montauban, partiel).
2. « vs Vannes » → stocks + coûts + prestataires (1 en retard, 1 absent) + débrief.
3. « vs Montauban » → stocks ouverts (en cours).
4. Déconnexion → connexion **SN2026** → saisie du nom → stocks ouverts.
5. Vérifier : **aucun prix** visible côté responsable (RG-003).

## Prérequis

- Node.js 18+
- Compte Supabase (région **eu-west-1**, Frankfurt — RGPD)

## Installation

```bash
npm install
cp .env.example .env.local
# Remplir VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY
```

## Configuration Supabase

Dans Supabase → SQL Editor, exécuter dans l'ordre :

1. `supabase/schema.sql` — 11 tables, contraintes, index, triggers
2. `supabase/rls_policies.sql` — politiques RLS par rôle + vue `products_public`
3. `supabase/seed.sql` — 16 espaces, 25 produits, comptes, événement de démo

## Création des comptes utilisateurs

Supabase Dashboard → **Authentication → Users → Add user**.

### Comptes ROLE_STADE (Équipe Stade)

Cochez « Auto Confirm User » et renseignez le `User Metadata`
`{ "role": "ROLE_STADE", "name": "<Nom>" }`. Mot de passe temporaire
**`StadeMD2026!`** (à changer à la première connexion).

| Email | Nom | Mot de passe |
|-------|-----|--------------|
| `mviatte@provencerugby.com` | M. Viatte | `StadeMD2026!` |
| `csadras@provencerugby.com` | C. Sadras | `StadeMD2026!` |
| `amartinez@provencerugby.com` | A. Martinez | `StadeMD2026!` |

### Comptes ROLE_RESPONSABLE (responsables d'espace)

Email = `{code}@stade.fr`, mot de passe = `{code}`, metadata
`{ "role": "ROLE_RESPONSABLE", "space_id": "<uuid>", "space_code": "<code>" }`.
Création automatisée recommandée :

```bash
SUPABASE_URL="https://xxxx.supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="..." \
npx tsx scripts/create-providers.ts
```

| Code | Espace | Type |
|------|--------|------|
| SN2026 | Salon Nord | VIP |
| SS2026 | Salon Sud | VIP |
| PUB2026 | Le Pub | Bar |
| LE2026 | Loge Est | VIP |
| CO2026 | Comptoir | Bar |
| BI2026 | Bistrot | Bar |
| LON2026 | Loge Ouest Nord | VIP |
| LOS2026 | Loge Ouest Sud | VIP |
| WBN2026 | Wine bar Nord | Bar |
| WBS2026 | Wine bar Sud | Bar |
| C70N26 | Club 70 Nord | Bar |
| C70S26 | Club 70 Sud | Bar |
| TER2026 | Terrasses | Bar |
| BOD2026 | Bodega | Bar |
| BV12026 | Buvette 1 | Buvette |
| BV22026 | Buvette 2 | Buvette |

## Lancement

```bash
npm run dev        # http://localhost:5173
npm run build      # build de production
npm run type-check # vérification TypeScript stricte
```

## Vérifications (sans navigateur)

```bash
# Connexion + comptage des référentiels (compte ROLE_STADE recommandé)
SUPABASE_URL=... SUPABASE_ANON_KEY=... \
STADE_EMAIL="mviatte@provencerugby.com" STADE_PASSWORD="StadeMD2026!" \
npx tsx supabase/scripts/check-connection.ts

# Tests RLS automatisés (RG-001/002/003/006)
SUPABASE_URL=... SUPABASE_ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=... \
npx tsx supabase/scripts/verify-rls.ts
```

> ⚠ Les clés sont lues depuis l'environnement, **jamais commitées**.
> `supabase/scripts/*.env` est exclu via `.gitignore`.

## Agent Skills (outillage assistant, optionnel)

Skills Supabase pour les outils d'IA. Réinstallation depuis le lockfile :

```bash
npx skills add supabase/agent-skills   # (ré)installe dans .agents/ (non versionné)
```

`skills-lock.json` est versionné ; le contenu installé (`.agents/`) ne l'est pas.

## Déploiement

Voir [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md) (Vercel + checklist finale).
Spécification complète : [`CLAUDE.md`](./CLAUDE.md).
