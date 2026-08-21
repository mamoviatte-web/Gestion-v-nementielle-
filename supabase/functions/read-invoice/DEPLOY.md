# Activer la lecture automatique de factures (`read-invoice`)

La fonction edge `read-invoice` lit une facture/BL (image ou PDF) via Claude et
renvoie les lignes extraites. Tant qu'elle n'est **pas déployée** avec une **clé
Anthropic**, le bouton « Lire la facture » affiche « lecture indisponible » et il
faut saisir la livraison manuellement.

Deux prérequis :
1. Un **token d'accès Supabase** (PAT `sbp_…`) — Dashboard → *Account → Access Tokens*.
2. Une **clé API Anthropic** (`sk-ant-…`) — <https://console.anthropic.com> → *API Keys*.
   La clé reste **côté serveur** (secret), jamais dans le navigateur.

Projet : **`xaudmdnffyumqqdvzpqd`** (déjà dans `supabase/config.toml`).

---

## Option A — script tout-en-un (recommandé)

Depuis la racine du dépôt, sur une machine avec **Docker Desktop lancé** (le CLI
empaquette les fonctions avec Docker) :

```bash
export SUPABASE_ACCESS_TOKEN=sbp_xxx        # ton PAT Supabase
export ANTHROPIC_API_KEY=sk-ant-xxx         # ta clé Anthropic
bash supabase/deploy_functions.sh
```

Le script : pose le secret `ANTHROPIC_API_KEY`, puis déploie `read-invoice`,
`read-rh-planning` et `cleanup-event-storage`. Ré-exécutable sans risque.

## Option B — déployer uniquement `read-invoice`

```bash
export SUPABASE_ACCESS_TOKEN=sbp_xxx

# 1) Poser la clé Anthropic (secret serveur)
npx --yes supabase@latest secrets set ANTHROPIC_API_KEY=sk-ant-xxx \
  --project-ref xaudmdnffyumqqdvzpqd

# 2) Déployer la fonction (verify-jwt ON : réservée aux utilisateurs connectés)
npx --yes supabase@latest functions deploy read-invoice \
  --project-ref xaudmdnffyumqqdvzpqd
```

> **Sans Docker** : ajoute `--use-api` à la commande `functions deploy` (le CLI
> empaquette et téléverse via l'API, sans conteneur local). Nécessite une CLI
> récente (`supabase@latest`).

## Option C — 100 % dashboard (sans CLI ni Docker)

1. **Secret** : Dashboard → *Edge Functions → Secrets* (ou *Manage secrets*) →
   ajouter `ANTHROPIC_API_KEY = sk-ant-…`.
2. **Fonction** : *Edge Functions → Deploy a new function* → nom `read-invoice`
   → coller le contenu de `supabase/functions/read-invoice/index.ts` → *Deploy*.
   Laisser « Verify JWT » **activé**.

---

## Vérifier

- Dashboard → *Edge Functions* : `read-invoice` apparaît, statut *deployed*.
- Dans l'app (connecté équipe stade) : *Stocks → Dépôts → Facture Montaner* ou
  « Réceptionner des fûts » → **Lire la facture** → charger le PDF → les lignes
  se pré-remplissent (à vérifier avant validation).
- Logs : *Edge Functions → read-invoice → Logs* en cas d'erreur.

## Dépannage

| Message | Cause | Correctif |
|---|---|---|
| « lecture indisponible / Failed to send a request » | fonction non déployée | déployer (ci-dessus) |
| `ANTHROPIC_API_KEY non configurée côté serveur` (500) | secret absent | `secrets set ANTHROPIC_API_KEY=…` puis redéployer |
| `Claude API 401` | clé Anthropic invalide/expirée | regénérer la clé, refaire `secrets set` |
| Docker requis / échec bundling | Docker non lancé | démarrer Docker **ou** utiliser `--use-api` (Option B) / le dashboard (Option C) |

> Sécurité : **révoque le PAT `sbp_…` après le déploiement** (il donne accès à
> tout le compte). La clé Anthropic, elle, reste posée comme secret serveur.
