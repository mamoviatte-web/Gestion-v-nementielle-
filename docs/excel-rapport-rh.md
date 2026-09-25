# Expertise — rédaction du tableau Excel RH (paie mensuelle)

Référence de conception des classeurs RH (générés par `src/lib/payrollExport.ts`) :
`Recap_paie_{mois}.xlsx` (paie DAF mensuelle) **et** `RH_heures_{debut}_{fin}.xlsx`
(RH Analytique sur une plage : Synthèse « qui payer » + circuit · Par événement ·
Par mois). Les deux partagent les mêmes règles. Objectif : un document **propre,
homogène et lisible**, qui donne le **détail de chaque mission et de chaque jour
de chaque personne**, tout en gardant une synthèse financière par personne.

## 1. Trois feuilles, trois lectures (même donnée, réconciliée)

| Feuille | Grain | Sert à |
|---|---|---|
| **Paie {mois}** | 1 ligne / personne | Le DAF lit « À verser » et exécute les virements. |
| **Détail {mois}** | 1 ligne / **créneau** (personne × jour × mission) | Justifier chaque heure : jour, événement, tâche, horaire, coût. Bloc par personne. |
| **Par événement {mois}** | 1 ligne / créneau, **groupé par événement** | Voir, événement par événement, qui a travaillé, quand, sur quelle mission. |

Règle d'or : **la somme du détail d'une personne = son « À verser »** (feuille
Paie), et la somme des sous-totaux d'événement = le total général. Aucun
double-compte : les totaux se calculent par **formule vivante** (SUM/SUMIF), pas
en dur → recalcul automatique si on édite une cellule.

## 2. Chaque mission et chaque jour = une ligne

- Une ligne par **créneau** = (personne, jour réellement presté, mission/poste,
  espace, horaire arrivée→départ, heures, coût). Une personne qui fait 2 missions
  le même jour (ex. montage + service) = **2 lignes**.
- Le **jour** porte la date réelle (montage la veille inclus), pas seulement la
  date de l'événement. Format `mer. 24/09` (jour de semaine + JJ/MM).
- Chaque bloc personne rappelle en tête : **nb d'événements · nb de jours
  travaillés · nb de créneaux** + sous-total heures/coût.

## 3. Habillage homogène (les mêmes règles sur toutes les feuilles)

- **En-tête** : bandeau titre + sous-titre + légende (lignes 1–3), ligne d'en-tête
  de colonnes sur fond **navy**, texte blanc gras, figée (`frozen`).
- **Couleurs porteuses de sens, jamais décoratives** :
  - Circuit de paie : **ROUGE = franchise (à facturer)** · **VERT = contrat (paie)**.
  - Type d'événement : **BLEU = Match · VIOLET = Séminaire · AMBRE = Opérationnel**.
  - Le texte reste en encre neutre ; seule l'identité (nom, type) porte la couleur.
- **Sous-en-têtes** (personne / événement) sur fond gris clair `LIGHT`, filet de
  couleur du type en haut du bloc.
- **Lignes de détail** : filet bas très léger (`hair`) pour aérer sans charger.
- **Nombres** : heures `0.0`, montants `#,##0 €`, alignés à droite, `tabular`.
- **Colonnes** : largeurs fixes cohérentes d'une feuille à l'autre ; libellés
  identiques (Jour, Personne, Poste/tâche, Espace, Horaire, Heures, Coût HT).
- **Liens** : le nom d'événement est cliquable (ouvre la fiche dans l'appli).

## 4. Impression / PDF

`applyPrintLayout` : paysage, ajusté à 1 page de large (aucune colonne ne
déborde), centré, en-tête (lignes 1–5) répété en haut de chaque page, pied
« page X / N ». La liste coule sur autant de pages que nécessaire, toujours nette.

## 5. Check-list avant livraison

1. Les 3 feuilles présentes et réconciliées (détail = synthèse = par événement).
2. Chaque mission et chaque jour d'une personne apparaissent en ligne distincte.
3. Totaux en **formule** (jamais figés) ; sous-totaux par personne, par événement,
   par catégorie, par circuit.
4. Couleurs = sens (circuit, type), pas de décor ; en-têtes navy figés.
5. Impression paysage 1 page de large vérifiée.
