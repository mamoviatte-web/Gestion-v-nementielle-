# Stade Maurice David — Gestion événementielle

Application de gestion événementielle (boissons & matériel par espace) pour le
Stade Maurice David — Provence Rugby (CDC V1.1).

Stack : **React + TypeScript + Vite + Tailwind + Supabase + React Query**.

## Démarrage rapide

```bash
cp .env.example .env      # renseigner les clés Supabase
npm install
npm run dev               # http://localhost:5173
```

Scripts disponibles :

| Commande | Description |
|----------|-------------|
| `npm run dev` | Serveur de développement (Vite). |
| `npm run build` | Build de production (type-check + bundle). |
| `npm run type-check` | Vérification TypeScript stricte. |
| `npm run preview` | Prévisualisation du build. |

## Base de données (Supabase)

Exécuter dans le SQL Editor, dans l'ordre :

1. `supabase/schema.sql`
2. `supabase/rls_policies.sql`
3. `supabase/seed.sql`

## Comptes de démonstration

- **Équipe Stade** : `admin@stade-mauricedavid.fr` / `admin2026`
- **Responsable** : code d'accès `SN2026` (ou `BV12026`, etc.)

> Les comptes Responsable (`{code}@stade.fr`, `user_metadata.role =
> ROLE_RESPONSABLE`, `space_id`) doivent être créés côté Supabase
> (Dashboard ou Admin API). Voir `CLAUDE.md` pour les détails.

Voir [`CLAUDE.md`](./CLAUDE.md) pour la spécification complète.
