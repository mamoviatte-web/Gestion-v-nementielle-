/**
 * ReserveProcurementPanel — prévisionnel d'achat réserve pour un match.
 * Relie l'échelle de conso au niveau réserve : à commander = Σ à_monter (fiche
 * runner, conso projetée − reste) − stock réserve. Donne à l'acheteur la liste
 * exacte à commander avant le match, avec le coût HT. ROLE_STADE (coûts).
 */

import { useCallback, useEffect, useState } from 'react';
import { ShoppingCart, RefreshCw } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Card, SectionTitle, Spinner, StatTile } from '@/components/ui';

interface Ligne {
  product_name: string; category: string;
  a_monter: number; en_reserve: number; a_commander: number; pu_ht: number; cout_ht: number;
}
interface Forecast {
  success: boolean; event_name: string;
  total_a_commander: number; total_cout_ht: number; nb_produits_a_commander: number;
  lignes: Ligne[];
}

const eur = (v: number) => `${v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} € HT`;

export function ReserveProcurementPanel({ eventId }: { eventId: string }) {
  const [data, setData] = useState<Forecast | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: d } = await supabase.rpc('reserve_procurement_forecast', { p_event_id: eventId });
    setData((d as Forecast | null) ?? null);
    setLoading(false);
  }, [eventId]);
  useEffect(() => { void load(); }, [load]);

  if (loading) return <Card><Spinner label="Prévisionnel d'achat…" /></Card>;
  if (!data?.success || data.lignes.length === 0) return null;

  return (
    <Card accent="rust">
      <SectionTitle
        icon={ShoppingCart}
        right={
          <button onClick={() => void load()} className="inline-flex items-center gap-1 text-xs text-pr-black-soft/45 hover:text-pr-black-soft/70">
            <RefreshCw size={12} /> Recalculer
          </button>
        }
      >
        Prévisionnel d'achat réserve
      </SectionTitle>

      <p className="mb-3 text-xs text-pr-black-soft/55">
        Ce que la réserve ne couvre pas pour ce match : <b>à commander = ce qui doit monter (conso projetée − reste) − stock réserve</b>. Piloté par l'échelle de consommation.
      </p>

      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        <StatTile label="Produits à commander" value={data.nb_produits_a_commander} tone="warn" />
        <StatTile label="Unités à commander" value={data.total_a_commander} />
        <StatTile label="Coût estimé" value={eur(data.total_cout_ht)} tone="crit" />
      </div>

      <div className="overflow-x-auto rounded-xl border border-pr-stone">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-pr-stone bg-pr-cream text-left text-[11px] uppercase tracking-wider text-pr-black-soft/45">
              <th className="px-3 py-2">Produit</th>
              <th className="px-3 py-2 text-right">À monter</th>
              <th className="px-3 py-2 text-right">Réserve</th>
              <th className="px-3 py-2 text-right">À commander</th>
              <th className="px-3 py-2 text-right">Coût HT</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-pr-stone/50">
            {data.lignes.map((l, i) => (
              <tr key={i} className="text-pr-black-soft/80">
                <td className="px-3 py-2">
                  <span className="font-medium text-pr-black">{l.product_name}</span>
                  <span className="ml-2 text-xs text-pr-black-soft/40">{l.category}</span>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{l.a_monter}</td>
                <td className="px-3 py-2 text-right tabular-nums text-pr-black-soft/50">{l.en_reserve}</td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums text-pr-rust">{l.a_commander}</td>
                <td className="px-3 py-2 text-right tabular-nums">{l.cout_ht > 0 ? eur(l.cout_ht) : '—'}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-pr-stone bg-pr-cream/60 font-semibold text-pr-black">
              <td className="px-3 py-2" colSpan={3}>Total</td>
              <td className="px-3 py-2 text-right tabular-nums text-pr-rust">{data.total_a_commander}</td>
              <td className="px-3 py-2 text-right tabular-nums">{eur(data.total_cout_ht)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </Card>
  );
}
