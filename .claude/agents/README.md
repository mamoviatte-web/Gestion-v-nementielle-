# Charte des agents IA — stade Maurice David · Provence Rugby

Ce dossier définit les **agents experts du domaine** et leurs **frontières**, pour
que chacun fasse un travail **précis** et que **personne n'effectue le travail d'un
autre**. Deux principes :

1. **Séparation des pouvoirs** — celui qui **corrige** (opérateur) ne se note pas ;
   celui qui **note** (contrôleur) ne corrige pas. C'est ce qui rend le système fiable.
2. **Une seule source de vérité** — les chiffres réels saisis par les responsables
   après événement, et les vues/comptages physiques. Jamais d'estimation arbitraire.

---

## 1. Les agents et leur périmètre EXCLUSIF

| Agent | Rôle | Possède (exclusif) | Ne touche jamais | Écrit en base ? |
|-------|------|--------------------|------------------|-----------------|
| **`regie-stock`** | **Opérateur** Stock & Dotations | Stocks restants espaces · dotations runner · facteurs de conso espace×produit · **gammes & assortiment** (complétude + complétion) · mouvements & soustractions à la clôture · correction des anomalies (post-mortem, « zéro erreur ») | Audit/score, RH/paie/forfaits, exports habillés, UI | **Oui**, après validation humaine |
| **`audit-qualite`** | **Contrôleur** Audit & Qualité | Audit d'intégrité · score & classement des anomalies · détection de sources non canoniques · **signalement** à regie-stock · **re-vérification** après correction | Dotations, réconciliation, toute écriture | **Non** — lecture seule |

Agents génériques (hors domaine métier, pour le dev/infra) : `general-purpose`,
`Explore`, `Plan`, `claude-code-guide`. Ils ne pilotent pas les stocks ni l'audit.

**Mémo anti-chevauchement** : *si c'est corriger/construire/appliquer → regie-stock ;
si c'est mesurer/noter/signaler → audit-qualite.* En cas de doute sur la frontière,
l'agent le dit et demande, il ne déborde pas.

---

## 2. Le travail COMMUN — la boucle qualité par événement (leur force)

Les deux agents ne travaillent pas en parallèle isolé : ils forment une **boucle
DO ↔ CHECK** autour de chaque événement clôturé. C'est là qu'ils deviennent une force.

```
   ┌─────────────────────────── Événement clôturé ───────────────────────────┐
   │                                                                          │
   │  1. regie-stock (DO)     → réconciliation clôture : retours fûts/buvettes,│
   │                            soustraction dépôt (séminaire), anti-sur-      │
   │                            comptage dispatch, maintien stocks espaces,    │
   │                            mise à jour des tendances de conso.            │
   │                                                                          │
   │  2. audit-qualite (CHECK)→ audit indépendant : score, soldes négatifs,   │
   │                            finals manquants, ancrages fûts périmés,       │
   │                            écarts, sources non canoniques, assortiment.   │
   │                            → SIGNALE à regie-stock (hiérarchisé).         │
   │                                                                          │
   │  3. regie-stock (FIX)    → corrige les anomalies signalées (validation    │
   │                            humaine), apprend (post-mortem → skill).       │
   │                                                                          │
   │  4. audit-qualite (VERIFY)→ revérifie : l'anomalie est-elle levée ?       │
   │                            Sinon, re-signale. Boucle jusqu'à convergence. │
   │                                                                          │
   │  5. regie-stock (NEXT)   → prépare les dotations du prochain événement    │
   │                            avec des données désormais saines.             │
   └──────────────────────── Objectif commun : erreur 0 ──────────────────────┘
```

**Cadence** : audit quotidien automatique (AuditPilot 05:00) + un passage de la boucle
à **chaque clôture**. Le trigger `trg_zz_reconcile_on_close` et le log
`event_closure_reconciliation_log` matérialisent l'étape 1 ; l'onglet « Qualité des
données » matérialise les étapes 2 et 4.

**Objectif commun chiffré** : faire tendre vers 0 l'écart net d'inventaire dépôt et le
nombre d'anomalies critiques, événement après événement — la mémoire des défauts
(taxonomies & post-mortem) s'enrichit dans les skills à chaque tour.

---

## 3. Règles de handoff (qui passe quoi à qui)

- **audit-qualite → regie-stock** : un **signalement** = { signature, localisation
  (event/space/product), impact chiffré, action attendue, sévérité }. Jamais une
  correction appliquée.
- **regie-stock → audit-qualite** : un **« corrigé, à revérifier »** après action.
- **l'un ou l'autre → humain** (`AskUserQuestion`) : toute ambiguïté métier, tout
  écart qui toucherait un chiffre financier ou une donnée de production réelle.
- **Jamais** : audit-qualite qui écrit ; regie-stock qui s'auto-audit et se déclare
  « clean » sans passage du contrôleur.

---

## 4. Invocation

- Travail sur les **stocks, dotations, gammes, clôtures, corrections** → `regie-stock`.
- Besoin d'un **état de santé / audit / vérification indépendante** → `audit-qualite`.
- Les deux se relaient dans la boucle ci-dessus ; un humain valide toute écriture.
