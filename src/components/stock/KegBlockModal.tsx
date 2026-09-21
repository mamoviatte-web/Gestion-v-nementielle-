/**
 * KegBlockModal — avertissement fort (modale in-app) déclenché à la clôture
 * quand l'opérateur de contrôle des fûts détecte des défauts BLOQUANTS.
 * L'utilisateur corrige d'abord (Annuler) ou force la clôture (les défauts
 * restent tracés). Palette Provence, cohérent avec le reste de l'appli.
 */

import { AlertTriangle, X } from 'lucide-react';
import { Badge, Button } from '@/components/ui';

export interface KegDefaut {
  code: string;
  gravite: 'bloquant' | 'alerte';
  product_name: string;
  space_name: string;
  detail: string;
  qty: number;
}

export function KegBlockModal({
  eventName,
  defauts,
  ancragePerime,
  onCancel,
  onForce,
}: {
  eventName: string;
  defauts: KegDefaut[];
  ancragePerime?: boolean;
  onCancel: () => void;
  onForce: () => void;
}) {
  const bloquants = defauts.filter((d) => d.gravite === 'bloquant');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-pr-black/50 p-4" onClick={onCancel}>
      <div
        className="w-full max-w-lg overflow-hidden rounded-2xl border border-pr-stone bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* En-tête d'alerte */}
        <div className="flex items-start gap-3 border-b-4 border-pr-rust bg-pr-rust/10 px-5 py-4">
          <AlertTriangle className="mt-0.5 h-6 w-6 shrink-0 text-pr-rust" />
          <div className="flex-1">
            <h2 className="font-display text-lg font-black text-pr-black">Clôture bloquée — contrôle des fûts</h2>
            <p className="mt-0.5 text-sm text-pr-black-soft/60">
              « {eventName} » — {bloquants.length} défaut(s) bloquant(s)
            </p>
          </div>
          <button onClick={onCancel} className="rounded-lg p-1 text-pr-black-soft/40 hover:bg-pr-stone/40 hover:text-pr-black-soft/70">
            <X size={18} />
          </button>
        </div>

        {/* Corps : liste des défauts */}
        <div className="max-h-[46vh] space-y-2 overflow-y-auto px-5 py-4">
          <p className="text-sm text-pr-black-soft/70">
            Ces fûts sont partis vers un espace mais <b>ne sont pas comptés</b> : le stock fûts sera faux après clôture.
          </p>
          {bloquants.map((d, i) => (
            <div key={i} className="flex items-start justify-between gap-3 rounded-xl border border-pr-stone/70 bg-pr-cream/40 px-3 py-2">
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-sm font-medium text-pr-black">
                  <Badge tone="danger">bloquant</Badge>
                  {d.product_name}
                  <span className="text-xs font-normal text-pr-black-soft/45">· {d.space_name}</span>
                </p>
                <p className="mt-0.5 text-xs text-pr-black-soft/60">{d.detail}</p>
              </div>
              <span className="shrink-0 font-display text-base font-black tabular-nums text-pr-rust">{d.qty}</span>
            </div>
          ))}
          {ancragePerime && (
            <p className="flex items-center gap-2 rounded-xl border border-pr-gold/40 bg-pr-gold/10 px-3 py-2 text-xs font-medium text-pr-black-soft/80">
              <AlertTriangle size={14} className="text-pr-gold" /> Un comptage physique des fûts est aussi requis (le stock va dériver).
            </p>
          )}
        </div>

        {/* Pied : actions */}
        <div className="flex flex-col-reverse gap-2 border-t border-pr-stone bg-pr-cream/50 px-5 py-4 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onCancel}>Annuler et corriger d'abord</Button>
          <Button variant="danger" onClick={onForce}>Clôturer quand même</Button>
        </div>
      </div>
    </div>
  );
}
