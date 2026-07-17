/**
 * DeleteEventButton — suppression totale d'un événement (RPC delete_event_complete)
 * avec confirmation, rapport post-suppression et nettoyage Storage best-effort.
 * Réservé à l'équipe stade (la RPC revérifie is_stade() côté serveur).
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Trash2, AlertTriangle } from 'lucide-react';
import { supabase } from '@/lib/supabase';

interface DeleteReport {
  success: boolean;
  error?: string;
  deleted?: { event_name?: string };
  purged?: { stock_lines?: number; agents_rh?: number; photos?: number; storage_paths?: string[] };
}

async function cleanupStorage(eventId: string, paths: string[]) {
  // 1) Edge function (nettoyage complet via service role) — best-effort.
  try {
    await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/cleanup-event-storage`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ event_id: eventId, storage_paths: paths }),
    });
  } catch {
    // 2) Repli client (si la stratégie de bucket autorise l'admin authentifié).
    if (paths.length > 0) {
      try { await supabase.storage.from('debrief-photos').remove(paths); } catch { /* ignore */ }
    }
  }
}

export function DeleteEventButton({ event }: { event: { event_id: string; event_name: string; event_type: string | null } }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<DeleteReport | null>(null);

  async function handleDelete() {
    setLoading(true);
    const { data, error } = await supabase.rpc('delete_event_complete', {
      p_event_id: event.event_id,
      p_confirm: 'CONFIRMER',
      p_deleted_by: 'admin',
    });
    const res = (data as DeleteReport | null) ?? null;
    if (error || !res?.success) {
      setLoading(false);
      alert(`Erreur : ${res?.error ?? error?.message ?? 'inconnue'}`);
      return;
    }
    setReport(res);
    setLoading(false);
    const paths = res.purged?.storage_paths ?? [];
    void cleanupStorage(event.event_id, paths);
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-xl border border-red-200 px-3 py-2 text-sm font-medium text-red-600 transition-colors hover:bg-red-50"
      >
        <Trash2 size={14} /> Supprimer
      </button>

      {open && !report && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md space-y-5 rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-100">
                <AlertTriangle size={20} className="text-red-600" />
              </div>
              <div>
                <p className="font-black text-stone-900">Supprimer cet événement ?</p>
                <p className="text-sm text-stone-500">{event.event_name}</p>
              </div>
            </div>
            <div className="space-y-2 rounded-xl border border-red-200 bg-red-50 p-4">
              <p className="text-sm font-semibold text-red-800">⚠️ Cette action est irréversible</p>
              <ul className="space-y-1 text-xs text-red-700">
                <li>• Tous les stocks saisis seront supprimés</li>
                <li>• Toutes les données RH seront supprimées</li>
                <li>• Toutes les photos seront supprimées</li>
                <li>• Les coefficients de consommation seront recalculés</li>
                <li>• L'événement sera retiré du planning hebdomadaire</li>
              </ul>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setOpen(false)} className="flex-1 rounded-xl border border-stone-200 py-3 text-sm font-medium text-stone-600 hover:bg-stone-50">
                Annuler
              </button>
              <button onClick={() => void handleDelete()} disabled={loading} className="flex-1 rounded-xl bg-red-600 py-3 text-sm font-bold text-white transition-colors hover:bg-red-700 disabled:opacity-40">
                {loading ? '⏳ Suppression…' : '🗑 Supprimer définitivement'}
              </button>
            </div>
          </div>
        </div>
      )}

      {report && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md space-y-5 rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-green-100"><span className="text-xl">✅</span></div>
              <div>
                <p className="font-black text-stone-900">Suppression effectuée</p>
                <p className="text-xs text-stone-400">{report.deleted?.event_name}</p>
              </div>
            </div>
            <div className="divide-y divide-stone-100 rounded-xl bg-stone-50">
              {[
                { label: 'Lignes de stock supprimées', value: report.purged?.stock_lines ?? 0 },
                { label: 'Données RH supprimées', value: report.purged?.agents_rh ?? 0 },
                { label: 'Photos supprimées', value: report.purged?.photos ?? 0 },
              ].map((row) => (
                <div key={row.label} className="flex items-center justify-between px-4 py-2.5">
                  <span className="text-sm text-stone-600">{row.label}</span>
                  <span className="font-bold text-stone-800">{row.value}</span>
                </div>
              ))}
              <div className="px-4 py-2.5"><span className="text-sm text-green-700">✅ Coefficients &amp; analyses recalculés</span></div>
            </div>
            <button
              onClick={() => { setOpen(false); setReport(null); navigate('/admin/events'); }}
              className="w-full rounded-xl bg-stone-900 py-3 text-sm font-bold text-white"
            >
              Retour aux événements
            </button>
          </div>
        </div>
      )}
    </>
  );
}
