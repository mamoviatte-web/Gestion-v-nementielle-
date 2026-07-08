/**
 * IntegrityBadge — indicateur de liaison des charges d'un événement (ROLE_STADE).
 * Lit charges_integrity_check : vert si aucune ligne mal classée (stock / charges
 * externes / horaires), ambre sinon. Dégrade en silence si la vue est absente.
 */

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

type Status = 'loading' | 'ok' | 'warning' | 'hidden';

interface IntegrityRow {
  stock_category_mismatch: number;
  external_category_mismatch: number;
  schedule_category_mismatch: number;
  stock_lines_saisies: number;
  charges_externes: number;
  agents_planifies: number;
}

export function IntegrityBadge({ eventId }: { eventId: string }) {
  const [status, setStatus] = useState<Status>('loading');
  const [detail, setDetail] = useState('');

  useEffect(() => {
    let active = true;
    void supabase
      .from('charges_integrity_check')
      .select('stock_category_mismatch, external_category_mismatch, schedule_category_mismatch, stock_lines_saisies, charges_externes, agents_planifies')
      .eq('event_id', eventId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!active) return;
        if (error || !data) {
          setStatus('hidden');
          return;
        }
        const r = data as IntegrityRow;
        const mismatches = r.stock_category_mismatch + r.external_category_mismatch + r.schedule_category_mismatch;
        if (mismatches > 0) {
          setStatus('warning');
          setDetail(`${mismatches} ligne(s) avec catégorie incorrecte`);
        } else {
          setStatus('ok');
          setDetail(`${r.stock_lines_saisies} stock · ${r.agents_planifies} horaire(s) · ${r.charges_externes} charge(s) externe(s)`);
        }
      });
    return () => {
      active = false;
    };
  }, [eventId]);

  if (status === 'loading' || status === 'hidden') return null;

  const cfg =
    status === 'ok'
      ? { bg: 'bg-green-50 border-green-200 text-green-700', label: '✅ Charges liées et vérifiées' }
      : { bg: 'bg-amber-50 border-amber-200 text-amber-700', label: '⚠️ Liaison à vérifier' };

  return (
    <div className={`mb-4 flex flex-wrap items-center gap-2 rounded-xl border px-4 py-2.5 text-sm ${cfg.bg}`}>
      <span className="font-semibold">{cfg.label}</span>
      {detail && <span className="opacity-70">— {detail}</span>}
    </div>
  );
}
