#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# deploy_functions.sh — déploiement des edge functions Supabase du projet.
#
#   • read-invoice          (verify-jwt ON  — admin authentifié)      → ANTHROPIC_API_KEY
#   • read-rh-planning      (--no-verify-jwt — valide le token RH)    → ANTHROPIC_API_KEY
#   • cleanup-event-storage (--no-verify-jwt)                         → (secrets auto)
#
# Les variables SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY
# sont injectées automatiquement par le runtime — NE PAS les définir ici
# (`supabase secrets set` refuse d'ailleurs les noms préfixés SUPABASE_).
#
# ─── Utilisation ───────────────────────────────────────────────────────────
#   export SUPABASE_ACCESS_TOKEN=sbp_xxx        # PAT (dashboard → account → tokens)
#   export ANTHROPIC_API_KEY=sk-ant-xxx         # clé Anthropic (serveur uniquement)
#   bash supabase/deploy_functions.sh
#
#   PROJECT_REF est pré-rempli depuis supabase/config.toml ; surchargeable :
#   PROJECT_REF=autre_ref bash supabase/deploy_functions.sh
#
# ⚠ Aucun secret n'est stocké dans ce fichier : il est versionné.
#   Révoque le PAT après usage (il donne accès à tout le compte Supabase).
# ═══════════════════════════════════════════════════════════════════════════
set -uo pipefail

PROJECT_REF="${PROJECT_REF:-xaudmdnffyumqqdvzpqd}"

# ── Garde-fous : variables d'environnement obligatoires ─────────────────────
fail=0
if [[ -z "${SUPABASE_ACCESS_TOKEN:-}" ]]; then
  echo "❌ SUPABASE_ACCESS_TOKEN manquant (PAT sbp_...). export SUPABASE_ACCESS_TOKEN=sbp_..." >&2
  fail=1
fi
if [[ -z "${ANTHROPIC_API_KEY:-}" ]]; then
  echo "❌ ANTHROPIC_API_KEY manquant (sk-ant-...). export ANTHROPIC_API_KEY=sk-ant-..." >&2
  fail=1
fi
[[ "$fail" -eq 1 ]] && exit 1

# ── Résolution de la CLI Supabase (binaire local sinon npx) ─────────────────
if command -v supabase >/dev/null 2>&1; then
  SB=(supabase)
else
  echo "ℹ CLI 'supabase' absente → utilisation de 'npx --yes supabase@latest'."
  SB=(npx --yes supabase@latest)
fi

# ── Se placer à la racine du repo (le script vit dans supabase/) ────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.." || { echo "❌ Impossible de rejoindre la racine du repo." >&2; exit 1; }

echo "═══════════════════════════════════════════════════════════════"
echo "  Projet : $PROJECT_REF"
echo "  CLI    : ${SB[*]}"
echo "═══════════════════════════════════════════════════════════════"

# ── Étape 1 — secret ANTHROPIC_API_KEY (fatal si échec) ─────────────────────
echo ""
echo "▸ [1/4] Déclaration du secret ANTHROPIC_API_KEY…"
if "${SB[@]}" secrets set "ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY" --project-ref "$PROJECT_REF"; then
  echo "  ✅ Secret défini."
else
  echo "  ❌ Échec de la définition du secret — les fonctions IA échoueraient. Arrêt." >&2
  exit 1
fi

# ── Étape 2-4 — déploiement des fonctions (indépendantes) ───────────────────
declare -a FAILED=()

deploy() {
  local name="$1"; shift
  local step="$1"; shift
  echo ""
  echo "▸ [$step] Déploiement de '$name' ($*)…"
  if [[ ! -f "supabase/functions/$name/index.ts" ]]; then
    echo "  ⚠ supabase/functions/$name/index.ts introuvable — ignoré." >&2
    FAILED+=("$name (fichier absent)")
    return
  fi
  if "${SB[@]}" functions deploy "$name" --project-ref "$PROJECT_REF" "$@"; then
    echo "  ✅ $name déployée."
  else
    echo "  ❌ Échec du déploiement de $name." >&2
    FAILED+=("$name")
  fi
}

deploy read-invoice          "2/4"                    # verify-jwt ON (défaut)
deploy read-rh-planning      "3/4" --no-verify-jwt
deploy cleanup-event-storage "4/4" --no-verify-jwt

# ── Bilan ───────────────────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════════════════"
if [[ "${#FAILED[@]}" -eq 0 ]]; then
  echo "  ✅ Les 3 edge functions sont déployées."
  echo "     Vérifie : Dashboard → Edge Functions (invocations & logs)."
  exit 0
else
  echo "  ⚠ Échecs : ${FAILED[*]}"
  echo "     Relance après correction (le script est ré-exécutable)."
  exit 1
fi
