/**
 * Cibles de dimensionnement RH par type d'événement et type d'espace (CDC §6).
 * Servent au calcul du verdict d'efficacité (sur/sous-staffing).
 */

import type { SpaceType } from './types';

export interface StaffTarget {
  agents_per_100pax: Record<SpaceType, number>;
  max_overtime_rate: number;
  target_efficiency: number;
}

export const STAFF_TARGETS: Record<string, StaffTarget> = {
  match: {
    agents_per_100pax: { VIP: 2.5, Bar: 2.0, Buvette: 1.8 },
    max_overtime_rate: 0.2,
    target_efficiency: 0.95,
  },
  séminaire: {
    agents_per_100pax: { VIP: 3.0, Bar: 2.5, Buvette: 2.0 },
    max_overtime_rate: 0.1,
    target_efficiency: 0.98,
  },
};

export type StaffVerdict = 'optimal' | 'overstaffed' | 'understaffed';

export interface EfficiencyResult {
  score: number;
  verdict: StaffVerdict;
  delta_pct: number;
  target: number;
}

/** Cible agents/100pax pour un (type d'événement, type d'espace), avec repli 2.0. */
export function getTarget(eventType: string, spaceType: SpaceType): number {
  return STAFF_TARGETS[eventType]?.agents_per_100pax[spaceType] ?? 2.0;
}

/** Verdict d'efficacité à partir du ratio observé agents/100pax. */
export function computeEfficiencyScore(
  actualAgentsPer100pax: number,
  eventType: string,
  spaceType: SpaceType,
): EfficiencyResult {
  const target = getTarget(eventType, spaceType);
  const delta_pct = target > 0 ? ((actualAgentsPer100pax - target) / target) * 100 : 0;
  return {
    score: Math.max(0, 1 - Math.abs(delta_pct) / 100),
    verdict: delta_pct > 15 ? 'overstaffed' : delta_pct < -15 ? 'understaffed' : 'optimal',
    delta_pct,
    target,
  };
}

export const VERDICT_META: Record<StaffVerdict, { label: string; tone: 'success' | 'warning' | 'danger'; icon: string }> = {
  optimal: { label: 'Dans la cible', tone: 'success', icon: '✅' },
  overstaffed: { label: 'Sur-staffé', tone: 'danger', icon: '❌' },
  understaffed: { label: 'Sous-staffé', tone: 'warning', icon: '⚠️' },
};
