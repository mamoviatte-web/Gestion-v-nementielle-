# Liaison GitHub ↔ Supabase — appliquer les migrations automatiquement

Objectif : **push GitHub → migrations appliquées en base**, sans copier-coller manuel.

Tout est déjà en place dans le repo :
- `supabase/config.toml` — référence du projet (`xaudmdnffyumqqdvzpqd`)
- `supabase/migrations/` — les 6 migrations, ordonnées et idempotentes
- `.github/workflows/supabase-deploy.yml` — le workflow qui applique (`supabase db push`)

Il ne reste qu'à **fournir 2 secrets** à GitHub (une seule fois). Après ça, chaque push
qui modifie `supabase/migrations/**` applique automatiquement les nouvelles migrations.

---

## Étape unique — Ajouter 2 secrets GitHub

Dans **GitHub → le repo → Settings → Secrets and variables → Actions → New repository secret** :

| Nom du secret | Où le trouver |
|---------------|---------------|
| `SUPABASE_ACCESS_TOKEN` | https://supabase.com/dashboard/account/tokens → **Generate new token** |
| `SUPABASE_DB_PASSWORD` | Dashboard → projet → **Project Settings → Database → Database password** (ou « Reset database password » si oublié) |

C'est tout. Ces secrets ne sont **jamais** visibles dans le code ni les logs.

## Lancer la première application

Deux options :
1. **Automatique** : le prochain push touchant `supabase/migrations/**` déclenche le workflow.
2. **Manuel maintenant** : GitHub → onglet **Actions** → « Supabase — appliquer les migrations » → **Run workflow** (bouton, grâce à `workflow_dispatch`).

Suis l'exécution dans l'onglet **Actions**. À la fin : « ✅ Migrations appliquées ».
Les migrations étant idempotentes, seules celles jamais enregistrées dans
`supabase_migrations.schema_migrations` sont exécutées ; les suivantes sont ignorées.

---

## Ce que la première exécution installe (dans l'ordre)

1. `20260707090001_apply_all` — tables/fonctions/colonnes de rattrapage + reset stocks
2. `20260707090002_corrections_4` — stocks espaces→0, `dismissed_alerts`, `consumption_by_product`
3. `20260707090003_buvettes_capacites` — B1–B9, `max_pax`/`service_type`, `get_vip_dotation`, vue match
4. `20260707090004_runner_season_ref` — historique S-1 (Salon Nord/Sud/Pub) + analytics
5. `20260707090005_runner_chain` — espaces complémentaires + `event_full_chain` + trigger
6. `20260707090006_match_access` — **`match_access_code` + trigger + code Vannes généré + RPC**

Après ça : le message orange « Code d'accès non encore généré » disparaît, le code
du match Vannes est généré, et `/match/<code>` est opérationnel.

> ⚠️ **À savoir** : la migration `20260707090001_apply_all` contient une **remise à zéro
> des stocks** (Phase 1). Elle ne s'exécute **qu'une seule fois** (suivi par la CLI) et la
> base est actuellement à zéro, donc sans effet indésirable. Si tu as déjà saisi un
> inventaire réel avant de lancer le workflow, préviens-moi : on retirera le reset de
> cette migration d'abord.

---

## Alternative — Intégration native du dashboard Supabase

À la place (ou en plus) du workflow, tu peux utiliser l'intégration officielle :
**Dashboard Supabase → Project Settings → Integrations → GitHub → Connect repository**,
puis pointer la branche. Elle lit le même dossier `supabase/migrations/` et applique les
migrations à chaque merge. Le dossier est déjà prêt pour ça — aucune modification requise.

Note : la connexion GitHub↔Supabase (OAuth) et l'ajout des secrets sont des actions que
**toi seul** peux réaliser (elles demandent ta session authentifiée). Je ne peux pas les
faire depuis l'agent — mais tout le reste (config, migrations, workflow) est déjà livré.
