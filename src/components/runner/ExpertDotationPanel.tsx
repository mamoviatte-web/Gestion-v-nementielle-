/**
 * ExpertDotationPanel — analyse de consommation experte & « à monter » réaliste.
 * Répond aux 3 questions par gamme : combien consommé (projeté sur l'affluence),
 * combien déjà en espace, combien monter (= besoin − espace, borné à 0).
 * Met en évidence la surtransmission (fiche runner qui demande de monter alors
 * que l'espace couvre déjà la tendance) et applique la reco en un clic.
 */

import { useCallback, useEffect, useState } from 'react';
import { Brain, ArrowRight, Check, RefreshCw, TrendingDown } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/context/ToastContext';
import { Badge, Button, Card, SectionTitle, Spinner, StatTile } from '@/components/ui';

interface Gamme {
  gamme: string; conso_projetee: number; espace: number;
  a_monter_actuel: number; a_monter_expert: number; surtransmission: number;
}
interface Ligne {
  space_name: string; product_name: string; gamme: string;
  conso_dernier: number; conso_projetee: number; espace: number; besoin_expert: number;
  a_monter_actuel: number; a_monter_expert: number; surtransmission: number;
}
interface Analysis {
  success: boolean; event_name: string; expected_attendees: number;
  total_a_monter_actuel: number; total_a_monter_expert: number; total_surtransmission: number;
  gammes: Gamme[]; lignes: Ligne[];
}

export function ExpertDotationPanel({ eventId, onApplied }: { eventId: string; onApplied?: () => void }) {
  const { showToast } = useToast();
  const [data, setData] = useState<Analysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: d } = await supabase.rpc('expert_runner_analysis', { p_event_id: eventId });
    setData((d as Analysis | null) ?? null);
    setLoading(false);
  }, [eventId]);
  useEffect(() => { void load(); }, [load]);

  async function apply() {
    setApplying(true);
    const { data: r, error } = await supabase.rpc('apply_expert_dotation', { p_event_id: eventId });
    const res = r as { success?: boolean; error?: string; lignes_ajustees?: number } | null;
    setApplying(false);
    if (error || !res?.success) { showToast(`Échec : ${res?.error ?? error?.message ?? 'application impossible'}`, 'warning'); return; }
    showToast(`Dotation experte appliquée — ${res.lignes_ajustees ?? 0} ligne(s) ajustée(s).`, 'success');
    await load();
    onApplied?.();
  }

  if (loading) return <Card><Spinner label="Analyse de consommation…" /></Card>;
  if (!data?.success) return null;

  const surSup = data.gammes.reduce((s, g) => s + Math.max(0, g.surtransmission), 0); // sur-dotation à couper
  const sousSup = data.gammes.reduce((s, g) => s + Math.max(0, -g.surtransmission), 0); // sous-dotation à ajouter
  const topLignes = data.lignes.filter((l) => Math.abs(l.surtransmission) > 0).slice(0, 8);

  return (
    <Card accent={surSup > 0 ? 'gold' : 'olive'}>
      <SectionTitle
        icon={Brain}
        right={
          <button onClick={() => void load()} className="inline-flex items-center gap-1 text-xs text-pr-black-soft/45 hover:text-pr-black-soft/70">
            <RefreshCw size={12} /> Recalculer
          </button>
        }
      >
        Analyse conso & dotation experte
      </SectionTitle>

      <p className="mb-3 text-xs text-pr-black-soft/55">
        Besoin projeté sur l'affluence attendue ({data.expected_attendees.toLocaleString('fr-FR')} pax) à partir de la conso réelle des derniers matchs (pour 1000 spectateurs), <b>moins le stock déjà en espace</b>. Marge de sécurité 15 %.
      </p>

      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatTile label="À monter — actuel" value={data.total_a_monter_actuel} />
        <StatTile label="À monter — expert" value={data.total_a_monter_expert} tone="good" />
        <StatTile label="Sur-dotation coupée" value={surSup} tone="warn" sub="unités en trop" />
        <StatTile label="Sous-dotation ajoutée" value={sousSup} sub="unités manquantes" />
      </div>

      {/* Par gamme */}
      <div className="mb-3 overflow-x-auto rounded-xl border border-pr-stone">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-pr-stone bg-pr-cream text-left text-[11px] uppercase tracking-wider text-pr-black-soft/45">
              <th className="px-3 py-2">Gamme</th>
              <th className="px-3 py-2 text-right">Conso projetée</th>
              <th className="px-3 py-2 text-right">En espace</th>
              <th className="px-3 py-2 text-right">À monter actuel</th>
              <th className="px-3 py-2 text-right">À monter expert</th>
              <th className="px-3 py-2 text-right">Écart</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-pr-stone/50">
            {data.gammes.map((g) => (
              <tr key={g.gamme} className="text-pr-black-soft/80">
                <td className="px-3 py-2 font-medium text-pr-black">{g.gamme}</td>
                <td className="px-3 py-2 text-right tabular-nums">{g.conso_projetee}</td>
                <td className="px-3 py-2 text-right tabular-nums">{g.espace}</td>
                <td className="px-3 py-2 text-right tabular-nums">{g.a_monter_actuel}</td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums text-pr-black">{g.a_monter_expert}</td>
                <td className={`px-3 py-2 text-right font-semibold tabular-nums ${g.surtransmission > 0 ? 'text-pr-rust' : g.surtransmission < 0 ? 'text-pr-olive' : 'text-pr-black-soft/40'}`}>
                  {g.surtransmission > 0 ? `−${g.surtransmission}` : g.surtransmission < 0 ? `+${-g.surtransmission}` : '0'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Top lignes en surtransmission */}
      {topLignes.length > 0 && (
        <div className="mb-3 space-y-1.5">
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-pr-black-soft/45">
            <TrendingDown size={13} /> Principaux écarts par ligne
          </p>
          {topLignes.map((l, i) => (
            <div key={i} className="flex items-center justify-between gap-3 rounded-xl border border-pr-stone/70 bg-white px-3 py-2 text-sm">
              <div className="min-w-0">
                <span className="font-medium text-pr-black">{l.product_name}</span>
                <span className="ml-2 text-xs text-pr-black-soft/45">{l.space_name} · {l.gamme}</span>
                <span className="ml-2 text-xs text-pr-black-soft/45">conso ~{l.conso_projetee} · espace {l.espace}</span>
              </div>
              <div className="flex shrink-0 items-center gap-2 tabular-nums">
                <span className="text-pr-black-soft/45 line-through">{l.a_monter_actuel}</span>
                <ArrowRight size={13} className="text-pr-black-soft/40" />
                <Badge tone={l.a_monter_expert < l.a_monter_actuel ? 'success' : 'warning'}>{l.a_monter_expert}</Badge>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        <Button loading={applying} onClick={() => void apply()}>
          <Check size={15} /> Appliquer la dotation experte
        </Button>
      </div>
    </Card>
  );
}
