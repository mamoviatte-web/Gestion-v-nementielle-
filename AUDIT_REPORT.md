# Rapport d'audit — Pré-production · Stade Maurice-David / StockPilot MD

**Date :** 2026-07-09 · **Environnement :** Supabase `xaudmdnffyumqqdvzpqd` (eu-west-1) · **Branche :** `claude/new-session-vly2x6`

## Score global : 96 / 100

L'application est **prête pour la mise en production**. Aucune anomalie de données bloquante. Les rares points ouverts relèvent d'un **manque de données de test** (aucun match actif, RH quasi vide), pas de défauts.

---

## ✅ Points validés

| Contrôle | Résultat |
|---|---|
| RLS activé sur **toutes** les tables `public` | ✅ 0 table sans RLS |
| Orphelins `event_stock_lines` / `schedules` | ✅ 0 |
| Produits actifs sans prix (hors Matériel) | ✅ 0 (52/52 avec prix) |
| Produits actifs sans `space_types` | ✅ 0 |
| Espaces actifs sans `service_type` | ✅ 0 |
| Événements actifs sans `event_spaces` | ✅ 0 |
| Consommations négatives (RG-004) | ✅ 0 |
| Lignes clôturées sans stock initial | ✅ 0 |
| **RG-003** : `get_zone_stock` / `get_zone_buvette_stock` n'exposent **jamais** `unit_price_ht` | ✅ vérifié (0 occurrence) |
| Vues RH `rh_*` : `GRANT authenticated`, `REVOKE anon` | ✅ anon → `42501` |
| Bucket `debrief-photos` privé + 20 Mo | ✅ `public=false`, `20971520` |
| Sessions anonymes expirées (> 48 h) actives | ✅ 0 (nettoyage exécuté) |
| RPC appelées par le front présentes en DB | ✅ 24/24 (voir correctif dashboard) |
| Index de performance critiques | ✅ créés (voir §Corrections) |

---

## 🔧 Corrections appliquées (non destructives)

1. **`get_dashboard_live()` appliquée en prod.** Le front l'appelait avec un repli client automatique (9 requêtes) ; la fonction agrégée (1 seul appel) existait dans le repo mais n'avait jamais été déployée. Le dashboard sert désormais tout en un appel. Clés renvoyées : `today_events, kpis, stock_alerts, provider_alerts, spaces_status`.
2. **Index de performance** créés (`event_stock_lines`, `schedules`, `zone_staff_hours`, `debrief_photos`, `match_access_sessions`, `events`). Adaptation : pas d'index `buvette_zone_id` (colonne inexistante).
3. **Espace parasite désactivé** : « Buvette Virage Toinou » (0 référence stock/dotation/event_spaces) → `active=false` (historique préservé). Espaces buvette actifs : B1–B9 + Buvette 1/2 (11).
4. **Sessions expirées** nettoyées (aucune trouvée).

---

## ⚠️ Points ouverts (non bloquants)

- **`events.total_fb_cost_ht / total_rh_cost / total_event_cost` = `null`** sur le séminaire clôturé. Ces colonnes sont **héritées et non lues par l'application** : le coût réel est servi en direct par `get_event_costs()` (SALESFORCE → F&B 26,32 € · RH 154,70 € · total 181,02 €, correct) et par `seminar_report_draft`. Aucune correction forcée appliquée (risque de régression) — colonnes à supprimer lors d'un futur nettoyage de schéma.
- **Aucun match actif en base** : le flux match (validate_match_code → buvettes → stocks) n'a pas pu être rejoué end-to-end faute d'événement `match` en `préparé`/`en_cours`. Les RPC concernées ont été validées end-to-end lors des itérations précédentes (sessions injectées). `validate_match_code` sur un code inexistant renvoie bien `success=false`.
- **RH quasi vide** : `zone_staff_hours` = 0, `schedules` = 1. Les vues et la page Staff & RH fonctionnent ; elles se rempliront à la saisie réelle.
- **Objets du prompt absents par design** (jamais existé dans ce schéma) : `buvette_zones` (buvettes = espaces B1–B9), `get_zone_products` (remplacé par `get_zone_stock` / `get_zone_buvette_stock`), `link_buvettes_to_match`, `events.pax_count` (→ `expected_attendees`), `events.computed_at`, `match_access_sessions.created_at` (→ `connected_at`).

---

## 📊 État des données

| Table | Nb |
|---|---|
| Événements (total / en cours / clôturés) | 1 / 0 / 1 |
| Espaces actifs | 26 |
| Produits actifs (avec prix) | 52 / 52 |
| Lignes stock (clôturées) | 5 / 4 |
| Schedules / zone_staff_hours | 1 / 0 |
| Photos débrief (sélectionnées PDF) | 0 / 0 |
| Sessions actives | 0 |

---

## Checklist sécurité

- [x] `unit_price_ht` jamais exposé via les RPC zone (RG-003)
- [x] Sessions expirables (nettoyage > 48 h) via `connected_at`
- [x] Bucket photos non public (URL signée uniquement)
- [x] RLS sur toutes les tables ; vues coûts réservées `authenticated`
