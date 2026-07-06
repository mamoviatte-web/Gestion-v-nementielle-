/**
 * useDashboardLive — centre de pilotage opérationnel (ROLE_STADE).
 *
 * Compose l'état « live » du stade à partir des tables existantes (PostgREST +
 * RLS), sans dépendre d'une fonction SQL dédiée : événements du jour, KPIs,
 * alertes stock/prestataires, statut des 16 espaces.
 *  - fetch au montage
 *  - rafraîchissement auto toutes les 90 s
 *  - Supabase Realtime (dégradé proprement si non activé) sur les tables clés
 *
 * NOTE : une fonction `get_dashboard_live()` (supabase/get_dashboard_live.sql)
 * peut être appliquée pour tout servir en un seul appel ; ce hook fonctionne
 * sans elle.
 */

import { useCallback, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export interface TodayEvent {
  event_id: string;
  event_name: string;
  event_type: string | null;
  status: string;
  event_date: string;
  start_time: string | null;
  pax: number | null;
  spaces_count: number;
  stocks_submitted: number;
}

export interface DashboardKpis {
  active_events: number;
  total_pax_today: number;
  critical_alerts: number;
  debriefs_pending: number;
}

export type StockSeverity = 'rupture' | 'critique' | 'avertissement';

export interface DashboardStockAlert {
  product_name: string;
  category: string;
  current_qty: number;
  min_stock: number;
  severity: StockSeverity;
  space_name: string | null;
}

export interface DashboardProviderAlert {
  company: string;
  space_id: string | null;
  planned_time: string | null;
  delay_min: number;
}

export interface DashboardSpaceStatus {
  space_id: string;
  space_name: string;
  space_type: string;
  has_event_today: boolean;
  operational: string | null;
  event_type: string | null;
  has_alert: boolean;
}

export interface DashboardData {
  today_events: TodayEvent[];
  kpis: DashboardKpis;
  stock_alerts: DashboardStockAlert[];
  provider_alerts: DashboardProviderAlert[];
  spaces_status: DashboardSpaceStatus[];
}

const OPEN_TODAY = ['en_cours', 'préparé'];

function todayISO(): string {
  return new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD, local
}

function toMinutes(t: string | null): number | null {
  if (!t) return null;
  const [h, m] = t.split(':');
  return Number(h) * 60 + Number(m);
}

/** Forme brute renvoyée par la RPC get_dashboard_live (agrégats nullables). */
interface RpcPayload {
  today_events: TodayEvent[] | null;
  kpis: DashboardKpis | null;
  stock_alerts: DashboardStockAlert[] | null;
  provider_alerts: DashboardProviderAlert[] | null;
  spaces_status: DashboardSpaceStatus[] | null;
}

const EMPTY_KPIS: DashboardKpis = {
  active_events: 0,
  total_pax_today: 0,
  critical_alerts: 0,
  debriefs_pending: 0,
};

/** Normalise le JSON de la RPC en DashboardData (arrays → [], nombres coercés). */
function normalizeRpc(p: RpcPayload): DashboardData {
  const k = p.kpis ?? EMPTY_KPIS;
  return {
    today_events: (p.today_events ?? []).map((e) => ({
      ...e,
      event_date: e.event_date ?? '',
      pax: e.pax == null ? null : Number(e.pax),
      spaces_count: Number(e.spaces_count),
      stocks_submitted: Number(e.stocks_submitted),
    })),
    kpis: {
      active_events: Number(k.active_events),
      total_pax_today: Number(k.total_pax_today),
      critical_alerts: Number(k.critical_alerts),
      debriefs_pending: Number(k.debriefs_pending),
    },
    stock_alerts: (p.stock_alerts ?? []).map((a) => ({
      ...a,
      current_qty: Number(a.current_qty),
      min_stock: Number(a.min_stock),
    })),
    provider_alerts: (p.provider_alerts ?? []).map((a) => ({
      ...a,
      delay_min: Number(a.delay_min),
    })),
    spaces_status: p.spaces_status ?? [],
  };
}

/**
 * Tente d'abord la fonction agrégée get_dashboard_live() (1 seul appel) ;
 * repli automatique sur la composition côté client si elle est absente/échoue.
 */
async function fetchDashboardData(): Promise<DashboardData> {
  try {
    const { data, error } = await supabase.rpc('get_dashboard_live');
    if (!error && data) return normalizeRpc(data as RpcPayload);
  } catch {
    /* fonction absente ou indisponible → repli client */
  }
  return composeClientSide();
}

async function composeClientSide(): Promise<DashboardData> {
  const today = todayISO();

  const [
    { data: events },
    { data: spaces },
    { data: products },
    { data: balances },
    { data: locations },
    { data: eventSpaces },
    { data: providers },
    { data: debriefs },
    { data: stockLines },
  ] = await Promise.all([
    supabase.from('events').select('event_id, event_name, event_type, status, event_date, start_time, expected_attendees'),
    supabase.from('spaces').select('space_id, space_name, space_type').eq('active', true),
    supabase.from('products').select('product_id, product_name, category, min_stock, stock_min, active').eq('active', true),
    supabase.from('stock_balances').select('product_id, location_id, current_quantity'),
    supabase.from('stock_locations').select('id, area_id, location_type'),
    supabase.from('event_spaces').select('event_id, space_id'),
    supabase.from('provider_presence').select('event_id, space_id, provider_company, planned_arrival_time, actual_arrival_time, status'),
    supabase.from('debriefs').select('event_id, space_id, submitted_at'),
    supabase.from('event_stock_lines').select('event_id, space_id, final_qty'),
  ]);

  type Ev = { event_id: string; event_name: string; event_type: string | null; status: string; event_date: string; start_time: string | null; expected_attendees: number | null };
  const allEvents = (events ?? []) as Ev[];
  const allSpaces = (spaces ?? []) as { space_id: string; space_name: string; space_type: string }[];
  const allProducts = (products ?? []) as { product_id: string; product_name: string; category: string; min_stock: number | null; stock_min: number | null }[];
  const allBalances = (balances ?? []) as { product_id: string; location_id: string; current_quantity: number }[];
  const allLocations = (locations ?? []) as { id: string; area_id: string | null; location_type: string }[];
  const locById = new Map(allLocations.map((l) => [l.id, l.area_id]));
  // ÉTAPE 8 : dépôts centraux (AUC + Stock EST) exclus des soldes opérationnels.
  const reserveLocIds = new Set(allLocations.filter((l) => l.location_type === 'reserve_centrale').map((l) => l.id));
  const operationalBalances = allBalances.filter((b) => !reserveLocIds.has(b.location_id));
  const allEventSpaces = (eventSpaces ?? []) as { event_id: string; space_id: string }[];
  const allProviders = (providers ?? []) as { event_id: string; space_id: string | null; provider_company: string; planned_arrival_time: string | null; actual_arrival_time: string | null; status: string }[];
  const allDebriefs = (debriefs ?? []) as { event_id: string; space_id: string; submitted_at: string | null }[];
  const allStockLines = (stockLines ?? []) as { event_id: string; space_id: string; final_qty: number | null }[];

  // ── Fenêtre « journée » : aujourd'hui + hier en_cours + 7 prochains jours à préparer ──
  const yesterday = new Date(Date.now() - 86_400_000).toLocaleDateString('en-CA');
  const in7 = new Date(Date.now() + 7 * 86_400_000).toLocaleDateString('en-CA');
  const windowEvents = allEvents.filter(
    (e) =>
      e.event_date === today ||
      (e.event_date === yesterday && e.status === 'en_cours') ||
      (e.event_date > today && e.event_date <= in7 && ['brouillon', 'préparé'].includes(e.status)),
  );

  const spacesCountByEvent = new Map<string, number>();
  for (const es of allEventSpaces) spacesCountByEvent.set(es.event_id, (spacesCountByEvent.get(es.event_id) ?? 0) + 1);
  const submittedByEvent = new Map<string, Set<string>>();
  for (const l of allStockLines) {
    if (l.final_qty != null) {
      const set = submittedByEvent.get(l.event_id) ?? new Set<string>();
      set.add(l.space_id);
      submittedByEvent.set(l.event_id, set);
    }
  }

  const today_events: TodayEvent[] = windowEvents
    .map((e) => ({
      event_id: e.event_id,
      event_name: e.event_name,
      event_type: e.event_type,
      status: e.status,
      event_date: e.event_date,
      start_time: e.start_time,
      pax: e.expected_attendees,
      spaces_count: spacesCountByEvent.get(e.event_id) ?? 0,
      stocks_submitted: submittedByEvent.get(e.event_id)?.size ?? 0,
    }))
    .sort((a, b) => (a.start_time ?? '').localeCompare(b.start_time ?? ''));

  // ── Stock : total par produit + alertes (soldes opérationnels uniquement) ──
  const totalByProduct = new Map<string, number>();
  for (const b of operationalBalances) totalByProduct.set(b.product_id, (totalByProduct.get(b.product_id) ?? 0) + Number(b.current_quantity));

  // Espace du solde le plus bas pour un produit (pour le libellé d'alerte)
  const lowestSpaceByProduct = new Map<string, string | null>();
  const spaceNameById = new Map(allSpaces.map((s) => [s.space_id, s.space_name]));
  const sortedBalances = [...operationalBalances].sort((a, b) => Number(a.current_quantity) - Number(b.current_quantity));
  for (const b of sortedBalances) {
    if (!lowestSpaceByProduct.has(b.product_id)) {
      const areaId = locById.get(b.location_id) ?? null;
      lowestSpaceByProduct.set(b.product_id, areaId ? spaceNameById.get(areaId) ?? null : null);
    }
  }

  const stock_alerts: DashboardStockAlert[] = allProducts
    .filter((p) => {
      const min = p.min_stock ?? 0;
      return min > 0 && (totalByProduct.get(p.product_id) ?? 0) < min;
    })
    .map((p) => {
      const qty = totalByProduct.get(p.product_id) ?? 0;
      const min = p.min_stock ?? 0;
      const severity: StockSeverity = qty === 0 ? 'rupture' : qty < min * 0.5 ? 'critique' : 'avertissement';
      return { product_name: p.product_name, category: p.category, current_qty: qty, min_stock: min, severity, space_name: lowestSpaceByProduct.get(p.product_id) ?? null };
    })
    .sort((a, b) => a.current_qty - b.current_qty)
    .slice(0, 8);

  // ── Prestataires en retard aujourd'hui ──
  const todayEventIds = new Set(allEvents.filter((e) => e.event_date === today).map((e) => e.event_id));
  const provider_alerts: DashboardProviderAlert[] = allProviders
    .filter((p) => p.status === 'en_retard' && todayEventIds.has(p.event_id))
    .map((p) => {
      const pa = toMinutes(p.planned_arrival_time);
      const aa = toMinutes(p.actual_arrival_time);
      return { company: p.provider_company, space_id: p.space_id, planned_time: p.planned_arrival_time, delay_min: pa != null && aa != null ? aa - pa : 0 };
    });

  // ── Statut des espaces ──
  const todayOpenEventIds = new Set(allEvents.filter((e) => e.event_date === today && OPEN_TODAY.includes(e.status)).map((e) => e.event_id));
  const eventById = new Map(allEvents.map((e) => [e.event_id, e]));
  const spacesWithEventToday = new Map<string, Ev>();
  for (const es of allEventSpaces) {
    if (todayOpenEventIds.has(es.event_id)) {
      const ev = eventById.get(es.event_id);
      if (ev) spacesWithEventToday.set(es.space_id, ev);
    }
  }
  // Espaces en alerte stock (un solde sous le min du produit)
  const productMinById = new Map(allProducts.map((p) => [p.product_id, p.min_stock ?? 0]));
  const alertSpaces = new Set<string>();
  for (const b of operationalBalances) {
    const min = productMinById.get(b.product_id);
    const areaId = locById.get(b.location_id);
    if (min != null && min > 0 && areaId && Number(b.current_quantity) < min) alertSpaces.add(areaId);
  }

  const spaces_status: DashboardSpaceStatus[] = allSpaces
    .map((s) => {
      const ev = spacesWithEventToday.get(s.space_id);
      return {
        space_id: s.space_id,
        space_name: s.space_name,
        space_type: s.space_type,
        has_event_today: !!ev,
        operational: null,
        event_type: ev?.status === 'en_cours' ? ev.event_type : null,
        has_alert: alertSpaces.has(s.space_id),
      };
    })
    .sort((a, b) => a.space_name.localeCompare(b.space_name));

  // ── KPIs ──
  const activeToday = allEvents.filter((e) => e.event_date === today && e.status === 'en_cours');
  const debriefKeys = new Set(allDebriefs.filter((d) => d.submitted_at).map((d) => `${d.event_id}:${d.space_id}`));
  const todayEventSpacePairs = allEventSpaces.filter((es) => todayEventIds.has(es.event_id));
  const debriefs_pending = todayEventSpacePairs.filter((es) => !debriefKeys.has(`${es.event_id}:${es.space_id}`)).length;

  const kpis: DashboardKpis = {
    active_events: activeToday.length,
    total_pax_today: activeToday.reduce((s, e) => s + (e.expected_attendees ?? 0), 0),
    critical_alerts: stock_alerts.length,
    debriefs_pending,
  };

  return { today_events, kpis, stock_alerts, provider_alerts, spaces_status };
}

export function useDashboardLive() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchDashboard = useCallback(async () => {
    try {
      const result = await fetchDashboardData();
      setData(result);
    } finally {
      setLoading(false);
    }
  }, []);

  // Montage
  useEffect(() => {
    void fetchDashboard();
  }, [fetchDashboard]);

  // Rafraîchissement auto toutes les 90 s
  useEffect(() => {
    const interval = setInterval(() => void fetchDashboard(), 90_000);
    return () => clearInterval(interval);
  }, [fetchDashboard]);

  // Realtime (dégradé proprement si la publication n'est pas activée)
  useEffect(() => {
    const channel = supabase
      .channel('dashboard-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'event_stock_lines' }, () => void fetchDashboard())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'stock_balances' }, () => void fetchDashboard())
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'events' }, () => void fetchDashboard())
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [fetchDashboard]);

  return { data, loading, refresh: fetchDashboard };
}

/**
 * Version légère pour la sidebar / le bandeau d'alerte : nombre de produits
 * sous le seuil minimum + nombre d'événements en cours aujourd'hui.
 */
export function useCriticalStatus() {
  return useQuery({
    queryKey: ['criticalStatus'],
    staleTime: 60_000,
    refetchInterval: 90_000,
    queryFn: async (): Promise<{ criticalAlerts: number; activeEvents: number }> => {
      const today = todayISO();
      const [{ data: products }, { data: balances }, { data: locations }, { data: events }] = await Promise.all([
        supabase.from('products').select('product_id, min_stock').eq('active', true),
        supabase.from('stock_balances').select('product_id, location_id, current_quantity'),
        supabase.from('stock_locations').select('id, location_type'),
        supabase.from('events').select('event_id, event_date, status'),
      ]);
      // ÉTAPE 8 : exclure les dépôts centraux (AUC + Stock EST) du total opérationnel.
      const reserveIds = new Set(
        ((locations ?? []) as { id: string; location_type: string }[])
          .filter((l) => l.location_type === 'reserve_centrale')
          .map((l) => l.id),
      );
      const total = new Map<string, number>();
      for (const b of (balances ?? []) as { product_id: string; location_id: string; current_quantity: number }[]) {
        if (reserveIds.has(b.location_id)) continue;
        total.set(b.product_id, (total.get(b.product_id) ?? 0) + Number(b.current_quantity));
      }
      const criticalAlerts = ((products ?? []) as { product_id: string; min_stock: number | null }[]).filter(
        (p) => (p.min_stock ?? 0) > 0 && (total.get(p.product_id) ?? 0) < (p.min_stock ?? 0),
      ).length;
      const activeEvents = ((events ?? []) as { event_date: string; status: string }[]).filter(
        (e) => e.event_date === today && e.status === 'en_cours',
      ).length;
      return { criticalAlerts, activeEvents };
    },
  });
}
