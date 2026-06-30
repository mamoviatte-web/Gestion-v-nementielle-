/**
 * Helpers de filtrage / regroupement de la liste des événements.
 * Saison sportive = juillet → juin (convention rugby).
 */

import type { Event } from './types';

/** Clé de saison sportive d'une date ISO, ex. « 2025-2026 ». */
export function seasonKey(dateIso: string): string {
  const d = new Date(dateIso);
  const year = d.getFullYear();
  const month = d.getMonth(); // 0 = janvier
  // À partir de juillet (index 6), la saison N/N+1 démarre.
  return month >= 6 ? `${year}-${year + 1}` : `${year - 1}-${year}`;
}

/** Saisons disponibles dans la liste, triées de la plus récente à la plus ancienne. */
export function getAvailableSeasons(events: Event[]): string[] {
  const set = new Set(events.map((e) => seasonKey(e.event_date)));
  return [...set].sort((a, b) => b.localeCompare(a));
}

/** Filtre texte simple, insensible à la casse, sur le nom de l'événement. */
export function matchesSearch(event: Event, search: string): boolean {
  const q = search.trim().toLowerCase();
  if (!q) return true;
  return event.event_name.toLowerCase().includes(q);
}

/**
 * Regroupe des événements par mois (« JUIN 2026 »), du plus récent au plus
 * ancien. Renvoie un tableau de tuples [libellé, événements].
 */
export function groupByMonth(events: Event[]): [string, Event[]][] {
  const groups = new Map<string, { label: string; events: Event[] }>();
  for (const e of events) {
    const d = new Date(e.event_date);
    const key = `${d.getFullYear()}-${String(d.getMonth()).padStart(2, '0')}`;
    const label = d
      .toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
      .toUpperCase();
    if (!groups.has(key)) groups.set(key, { label, events: [] });
    groups.get(key)!.events.push(e);
  }
  return [...groups.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([, v]) => [v.label, v.events] as [string, Event[]]);
}
