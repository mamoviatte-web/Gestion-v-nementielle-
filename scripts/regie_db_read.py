#!/usr/bin/env python3
"""
regie_db_read.py — lecture SEULE de la base de prod pour l'agent « régie-stock »
et le protocole de contrôle quotidien.

Usage :  python3 scripts/regie_db_read.py "SELECT ... "

- Le jeton d'accès est lu dans l'environnement (JAMAIS commité) :
  SUPABASE_ACCESS_TOKEN (ou SUPABASE_PAT). À configurer comme SECRET
  d'environnement de la session (Réglages environnement → secrets).
- Garde-fou intégré : seules les requêtes de LECTURE sont autorisées
  (select / with / explain / show). Toute écriture (insert/update/delete/
  drop/alter/create/grant/truncate…) est refusée → l'agent ne peut pas
  muter la prod par ce canal, conformément à sa charte.
- Le ref projet est public (cf. supabase/config.toml) ; seul le jeton est secret.
"""
import json
import os
import re
import sys
import urllib.error
import urllib.request

PROJECT_REF = "xaudmdnffyumqqdvzpqd"  # « Gestion stock Maurice David » (public)
ENDPOINT = f"https://api.supabase.com/v1/projects/{PROJECT_REF}/database/query"

# Un seul énoncé, commençant par un mot-clé de lecture. On rejette les
# points-virgules intermédiaires (multi-statements) pour éviter de glisser
# une écriture après un SELECT.
READ_START = re.compile(r"^\s*(with|select|explain|show)\b", re.IGNORECASE)
WRITE_WORDS = re.compile(
    r"\b(insert|update|delete|drop|alter|create|grant|revoke|truncate|"
    r"comment|do|call|copy|merge|refresh|reindex|vacuum|set|reset)\b",
    re.IGNORECASE,
)


def is_read_only(sql: str) -> bool:
    s = sql.strip().rstrip(";")
    if ";" in s:  # pas de multi-statements
        return False
    if not READ_START.match(s):
        return False
    if WRITE_WORDS.search(s):
        return False
    return True


def run(sql: str):
    token = os.environ.get("SUPABASE_ACCESS_TOKEN") or os.environ.get("SUPABASE_PAT")
    if not token:
        return {"_err": "Jeton absent : définir le secret SUPABASE_ACCESS_TOKEN dans l'environnement."}
    if not is_read_only(sql):
        return {"_err": "Refusé (garde-fou lecture seule) : seules les requêtes SELECT/WITH/EXPLAIN/SHOW mono-énoncé sont autorisées."}
    req = urllib.request.Request(
        ENDPOINT,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        data=json.dumps({"query": sql}).encode(),
        method="POST",
    )
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        return {"_err": f"{e.code} {e.read().decode()[:300]}"}


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("usage: python3 scripts/regie_db_read.py \"SELECT ...\"", file=sys.stderr)
        sys.exit(2)
    print(json.dumps(run(sys.argv[1]), ensure_ascii=False, indent=2))
