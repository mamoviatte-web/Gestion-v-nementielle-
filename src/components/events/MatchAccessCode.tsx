/**
 * MatchAccessCode — section admin (matchs) : affiche le code d'accès unique,
 * boutons copier code/lien + QR, et la liste temps réel des responsables connectés.
 */

import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { QRCodeSVG } from 'qrcode.react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/context/ToastContext';

interface ConnectedSession {
  id: string;
  staff_name: string;
  space?: { space_name: string; service_type: string | null } | null;
}

function matchUrl(code: string): string {
  return `${window.location.origin}/match/${code}`;
}

export function MatchAccessCode({ eventId, code, eventName }: { eventId: string; code: string | null; eventName: string }) {
  const { showToast } = useToast();
  const qc = useQueryClient();
  const [showQR, setShowQR] = useState(false);
  const [generating, setGenerating] = useState(false);

  async function generateCode() {
    setGenerating(true);
    const newCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    const { data, error } = await supabase
      .from('events')
      .update({ match_access_code: newCode })
      .eq('event_id', eventId)
      .select('match_access_code')
      .single();
    setGenerating(false);
    if (error) {
      showToast(
        /match_access_code|column/i.test(error.message)
          ? 'Colonne absente — applique supabase/match_access.sql.'
          : error.message,
        'warning',
      );
      return;
    }
    void qc.invalidateQueries({ queryKey: ['event', eventId] });
    void qc.invalidateQueries({ queryKey: ['events'] });
    showToast(`Code généré : ${(data as { match_access_code: string }).match_access_code}`, 'success');
  }

  if (!code) {
    return (
      <div className="mb-6 flex items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4">
        <span className="text-amber-500">⚠️</span>
        <p className="flex-1 text-sm text-amber-800">Code d'accès non encore généré pour ce match.</p>
        <button
          onClick={() => void generateCode()}
          disabled={generating}
          className="flex-shrink-0 rounded-xl bg-pr-black px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          {generating ? 'Génération…' : 'Générer le code'}
        </button>
      </div>
    );
  }

  const copy = (text: string, label: string) => {
    void navigator.clipboard?.writeText(text).then(() => showToast(`${label} copié.`, 'success'));
  };

  return (
    <div className="mb-6 rounded-2xl border border-pr-stone bg-pr-cream/40 p-5">
      <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
        <div>
          <h3 className="mb-1 font-medium text-pr-black">Code d'accès match</h3>
          <p className="text-xs text-pr-black-soft/50">
            Partagez ce code à tous vos responsables de zone. Ils choisissent leur espace en arrivant.
          </p>
        </div>
        <div className="text-center">
          <div className="rounded-xl border-2 border-pr-black bg-white px-6 py-3 font-mono text-4xl font-bold tracking-[0.25em] text-pr-black">
            {code}
          </div>
          <div className="mt-3 flex justify-center gap-2">
            <button onClick={() => copy(code, 'Code')} className="rounded-lg border border-pr-stone px-3 py-1.5 text-xs">
              📋 Copier le code
            </button>
            <button onClick={() => copy(matchUrl(code), 'Lien')} className="rounded-lg border border-pr-stone px-3 py-1.5 text-xs">
              🔗 Copier le lien
            </button>
            <button onClick={() => setShowQR(true)} className="rounded-lg bg-pr-black px-3 py-1.5 text-xs text-white">
              📱 QR Code
            </button>
          </div>
        </div>
      </div>

      <ConnectedStaffList eventId={eventId} />

      {showQR && <QRCodeModal code={code} eventName={eventName} onClose={() => setShowQR(false)} />}
    </div>
  );
}

function ConnectedStaffList({ eventId }: { eventId: string }) {
  const [sessions, setSessions] = useState<ConnectedSession[]>([]);

  useEffect(() => {
    let active = true;
    void supabase
      .from('match_access_sessions')
      .select('id, staff_name, space:spaces(space_name, service_type)')
      .eq('event_id', eventId)
      .eq('is_active', true)
      .then(({ data }) => {
        if (active) setSessions((data ?? []) as unknown as ConnectedSession[]);
      });

    const channel = supabase
      .channel(`sessions-${eventId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'match_access_sessions', filter: `event_id=eq.${eventId}` },
        (payload) => {
          const row = payload.new as { id: string; staff_name: string };
          setSessions((prev) => (prev.some((s) => s.id === row.id) ? prev : [...prev, { id: row.id, staff_name: row.staff_name }]));
        },
      )
      .subscribe();

    return () => {
      active = false;
      void supabase.removeChannel(channel);
    };
  }, [eventId]);

  if (sessions.length === 0) {
    return <p className="mt-4 text-center text-xs text-pr-black-soft/40">Aucun responsable connecté pour l'instant</p>;
  }

  return (
    <div className="mt-4 border-t border-pr-stone/60 pt-4">
      <p className="mb-2 text-xs uppercase tracking-wide text-pr-black-soft/40">
        {sessions.length} responsable{sessions.length > 1 ? 's' : ''} connecté{sessions.length > 1 ? 's' : ''}
      </p>
      <div className="flex flex-wrap gap-2">
        {sessions.map((s) => (
          <div key={s.id} className="flex items-center gap-2 rounded-full border border-pr-stone bg-white px-3 py-1.5 text-sm">
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
            <span className="font-medium">{s.staff_name}</span>
            {s.space?.space_name && (
              <>
                <span className="text-pr-black-soft/40">·</span>
                <span className="text-pr-black-soft/60">{s.space.space_name}</span>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function QRCodeModal({ code, eventName, onClose }: { code: string; eventName: string; onClose: () => void }) {
  const url = matchUrl(code);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-xs rounded-2xl bg-white p-8 text-center" onClick={(e) => e.stopPropagation()}>
        <p className="mb-1 text-sm text-pr-black-soft/40">Accès match</p>
        <h3 className="mb-4 text-lg font-medium">{eventName}</h3>
        <div className="flex justify-center">
          <QRCodeSVG value={url} size={220} level="H" marginSize={4} />
        </div>
        <div className="mt-4 font-mono text-2xl font-bold tracking-[0.25em] text-pr-black">{code}</div>
        <p className="mt-2 break-all text-xs text-pr-black-soft/40">{url}</p>
        <div className="mt-4 flex gap-2">
          <button onClick={() => window.print()} className="flex-1 rounded-xl border border-pr-stone py-2.5 text-sm">
            🖨️ Imprimer
          </button>
          <button onClick={onClose} className="flex-1 rounded-xl bg-pr-black py-2.5 text-sm text-white">
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
}
