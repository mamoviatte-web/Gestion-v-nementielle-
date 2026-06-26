/**
 * Configuration du formulaire de débrief (7 sections — CDC).
 * Partagée entre la saisie (stepper Responsable) et la vue admin lecture seule.
 */

import type { Debrief } from './types';

export type DebriefFieldType = 'number' | 'textarea' | 'select' | 'checkbox';

/** Clés éditables du débrief (hors méta). */
export type DebriefFieldKey = Exclude<
  keyof Debrief,
  'debrief_id' | 'event_id' | 'space_id' | 'responsable' | 'submitted_at' | 'created_at'
>;

export interface DebriefField {
  key: DebriefFieldKey;
  label: string;
  type: DebriefFieldType;
  options?: { value: string; label: string }[];
}

export interface DebriefSection {
  title: string;
  fields: DebriefField[];
}

const OUI_NON = [
  { value: 'oui', label: 'Oui' },
  { value: 'non', label: 'Non' },
];
const OUI_NON_PARTIEL = [
  ...OUI_NON,
  { value: 'partiellement', label: 'Partiellement' },
];
const EFFICACITE = [
  { value: 'bonne', label: 'Bonne' },
  { value: 'moyenne', label: 'Moyenne' },
  { value: 'faible', label: 'Faible' },
];
const AMENAGEMENT = [
  { value: 'adapté', label: 'Adapté' },
  { value: 'à revoir', label: 'À revoir' },
];
const RETOURS = [
  { value: 'positifs', label: 'Positifs' },
  { value: 'mitigés', label: 'Mitigés' },
  { value: 'négatifs', label: 'Négatifs' },
];

export const DEBRIEF_SECTIONS: DebriefSection[] = [
  {
    title: '1.1 Effectif',
    fields: [
      { key: 'nb_personnes', label: 'Nombre de personnes', type: 'number' },
      { key: 'effectif_adapte', label: 'Effectif adapté ?', type: 'select', options: OUI_NON_PARTIEL },
      { key: 'effectif_comment', label: 'Commentaire effectif', type: 'textarea' },
      { key: 'efficacite', label: 'Efficacité', type: 'select', options: EFFICACITE },
      { key: 'efficacite_comment', label: 'Commentaire efficacité', type: 'textarea' },
      { key: 'suggestion_effectif', label: 'Suggestion effectif', type: 'textarea' },
    ],
  },
  {
    title: '1.2 Organisation',
    fields: [
      { key: 'amenagement', label: 'Aménagement', type: 'select', options: AMENAGEMENT },
      { key: 'amenagement_comment', label: 'Commentaire aménagement', type: 'textarea' },
      { key: 'problemes_espace', label: 'Problèmes d\'espace', type: 'textarea' },
    ],
  },
  {
    title: '1.3 Stocks',
    fields: [
      { key: 'stocks_suffisants', label: 'Stocks suffisants ?', type: 'select', options: OUI_NON },
      { key: 'stocks_comment', label: 'Commentaire stocks', type: 'textarea' },
      { key: 'suggestions_stocks', label: 'Suggestions stocks', type: 'textarea' },
      { key: 'besoins_materiel', label: 'Besoins en matériel', type: 'textarea' },
    ],
  },
  {
    title: '2.1 Communication interne',
    fields: [
      { key: 'consignes_claires', label: 'Consignes claires ?', type: 'select', options: OUI_NON },
      { key: 'consignes_comment', label: 'Commentaire consignes', type: 'textarea' },
      { key: 'problemes_coordination', label: 'Problèmes de coordination', type: 'textarea' },
    ],
  },
  {
    title: '2.2 Communication clients',
    fields: [
      { key: 'retours_clients', label: 'Retours clients', type: 'select', options: RETOURS },
      { key: 'retours_clients_detail', label: 'Détail retours clients', type: 'textarea' },
    ],
  },
  {
    title: '3. Propreté',
    fields: [
      { key: 'espace_etat_bon', label: 'État de l\'espace correct ?', type: 'select', options: OUI_NON },
      { key: 'espace_etat_comment', label: 'Commentaire état', type: 'textarea' },
      { key: 'problemes_dechets', label: 'Problèmes de déchets', type: 'textarea' },
      { key: 'suggestions_proprete', label: 'Suggestions propreté', type: 'textarea' },
    ],
  },
  {
    title: '5. Suggestions',
    fields: [
      { key: 'suggestions_generales', label: 'Suggestions générales', type: 'textarea' },
      { key: 'besoins_specifiques', label: 'Besoins spécifiques', type: 'textarea' },
      { key: 'signature', label: 'Je valide ce débrief (signature)', type: 'checkbox' },
    ],
  },
];

/** Valeurs du formulaire (chaînes/bool indexées par clé de champ). */
export type DebriefFormValues = Record<string, string | boolean>;

/** Valeurs initiales vides pour le formulaire. */
export function emptyDebriefValues(): DebriefFormValues {
  const values: DebriefFormValues = {};
  for (const section of DEBRIEF_SECTIONS) {
    for (const field of section.fields) {
      values[field.key] = field.type === 'checkbox' ? false : '';
    }
  }
  return values;
}

/** Convertit un débrief existant en valeurs de formulaire. */
export function debriefToValues(debrief: Debrief): DebriefFormValues {
  const values = emptyDebriefValues();
  for (const section of DEBRIEF_SECTIONS) {
    for (const field of section.fields) {
      const raw = debrief[field.key];
      if (field.type === 'checkbox') values[field.key] = Boolean(raw);
      else values[field.key] = raw === null || raw === undefined ? '' : String(raw);
    }
  }
  return values;
}
