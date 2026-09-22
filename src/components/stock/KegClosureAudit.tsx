/**
 * KegClosureAudit — opérateur de contrôle des fûts à la clôture.
 * Dédié UNIQUEMENT aux fûts : appelle audit_keg_closure(event) et annonce les
 * défauts de cheminement (fûts partis non comptés, conso négative, gardés
 * hors règle) + l'alerte « ancrage périmé » (comptage physique requis).
 * Lecture seule. Réservé ROLE_STADE (garde base).
 */

import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Beer, AlertTriangle, CheckCircle2, RefreshCw, ClipboardCheck } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Badge, Card, SectionTitle, Spinner, StatTile } from '@/components/ui';

interface Defaut {
  code: string;
  gravite: 'bloquant' | 'alerte';
  product_name: string;
  space_name: string;
  detail: string;
  qty: number;
}
interface Audit {
  success: boolean;
  event_name: string;
  resume: { dispatche: number; vides_a_rentrer: number; pleins_retour_stockage: number; pleins_gardes: number; espaces: number; futs_espace_non_conserves?: number };
  dernier_comptage: string | null;
  ancrage_perime: boolean;
  nb_defauts: number;
  nb_bloquants: number;
  defauts: Defaut[];
}

export function KegClosureAudit({ eventId }: { eventId: string }) {
  const navigate = useNavigate();
  const [audit, setAudit] = useState<Audit | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.rpc('audit_keg_closure', { p_event_id: eventId });
    setAudit((data as Audit | null) ?? null);
    setLoading(false);
  }, [eventId]);
  useEffect(() => { void load(); }, [load]);

  if (loading) return <Card><Spinner label="Contrôle des fûts…" /></Card>;
  if (!audit?.success) return null;

  // Pas de cheminement fûts sur ce match → rien à contrôler.
  if (audit.resume.dispatche === 0 && audit.nb_defauts === 0 && !audit.ancrage_perime) return null;

  const r = audit.resume;
  const clean = audit.nb_defauts === 0;

  return (
    <Card accent={audit.nb_bloquants > 0 ? 'rust' : clean && !audit.ancrage_perime ? 'olive' : 'gold'}>
      <SectionTitle
        icon={Beer}
        right={
          <button onClick={() => void load()} className="inline-flex items-center gap-1 text-xs text-pr-black-soft/45 hover:text-pr-black-soft/70">
            <RefreshCw size={12} /> Recontrôler
          </button>
        }
      >
        Contrôle des fûts — clôture
      </SectionTitle>

      {/* Cheminement */}
      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatTile label="Dispatché" value={r.dispatche} sub={`${r.espaces} espace(s)`} />
        <StatTile label="Vides à rentrer" value={r.vides_a_rentrer} />
        <StatTile label="Pleins retournés" value={r.pleins_retour_stockage} sub="au stockage central" />
        <StatTile label="Pleins gardés" value={r.pleins_gardes} sub="cave EST sur place" />
      </div>

      {/* Invariant : aucun fût ne doit rester en inventaire des espaces non conservés */}
      {typeof r.futs_espace_non_conserves === 'number' && (
        <div
          className={`mb-3 flex items-center justify-between gap-2 rounded-xl border px-4 py-2.5 text-sm ${
            r.futs_espace_non_conserves === 0
              ? 'border-pr-olive/30 bg-pr-olive/10 text-pr-olive-dark'
              : 'border-pr-gold/40 bg-pr-gold/10 text-pr-black-soft/80'
          }`}
        >
          <span className="flex items-center gap-2 font-medium">
            {r.futs_espace_non_conserves === 0 ? (
              <CheckCircle2 size={15} />
            ) : (
              <AlertTriangle size={15} className="text-pr-gold" />
            )}
            Fûts restant en inventaire espace (hors cave EST) — doit être 0
          </span>
          <span className="font-display text-base font-black tabular-nums">{r.futs_espace_non_conserves}</span>
        </div>
      )}

      {/* Ancrage périmé → comptage physique requis */}
      {audit.ancrage_perime && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-pr-gold/40 bg-pr-gold/10 px-4 py-3 text-sm">
          <span className="flex items-center gap-2 font-medium text-pr-black-soft/80">
            <AlertTriangle size={16} className="text-pr-gold" />
            Dernier comptage fûts ({audit.dernier_comptage ?? '—'}) antérieur au match → le stock va dériver.
          </span>
          <button
            onClick={() => navigate('/admin/stock')}
            className="inline-flex items-center gap-1.5 rounded-lg bg-pr-black px-3 py-1.5 text-xs font-semibold text-white hover:bg-pr-black-soft"
          >
            <ClipboardCheck size={13} /> Faire le comptage physique
          </button>
        </div>
      )}

      {/* Défauts */}
      {clean ? (
        <p className="flex items-center gap-2 rounded-xl bg-pr-olive/10 px-4 py-3 text-sm font-medium text-pr-olive-dark">
          <CheckCircle2 size={16} /> Aucun défaut de cheminement fûts détecté.
        </p>
      ) : (
        <div className="space-y-1.5">
          <p className="text-xs font-semibold uppercase tracking-wider text-pr-black-soft/45">
            {audit.nb_defauts} défaut(s){audit.nb_bloquants > 0 ? ` · ${audit.nb_bloquants} bloquant(s)` : ''}
          </p>
          {audit.defauts.map((d, i) => (
            <div key={i} className="flex items-start justify-between gap-3 rounded-xl border border-pr-stone/70 bg-white px-3 py-2">
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-sm font-medium text-pr-black">
                  <Badge tone={d.gravite === 'bloquant' ? 'danger' : 'warning'}>{d.gravite}</Badge>
                  {d.product_name}
                  <span className="text-xs font-normal text-pr-black-soft/45">· {d.space_name}</span>
                </p>
                <p className="mt-0.5 text-xs text-pr-black-soft/60">{d.detail}</p>
              </div>
              <span className="shrink-0 font-display text-base font-black tabular-nums text-pr-black-soft/70">{d.qty}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
