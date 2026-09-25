/**
 * MatchZonePetitMateriel — « Besoins petits matériels » côté responsable de zone
 * (flux token). Le responsable saisit, par item du référentiel, la quantité dont
 * son espace a besoin pour le prochain match. RG-001 : nom requis.
 * Route : /zone/match/:sessionToken/materiel
 *
 * DORMANT : la tuile d'accès n'apparaît que si `PETIT_MATERIEL_ENABLED` est vrai ;
 * un accès direct à l'URL avec le drapeau à false affiche un simple écran neutre.
 */

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useMatchSession } from '@/hooks/useMatchSession';
import { MatchZoneHeader } from '@/components/zone/MatchZoneHeader';
import { validateStaffName } from '@/lib/staffName';
import { PETIT_MATERIEL_ENABLED } from '@/lib/featureFlags';

interface Item { item_id: string; code: string; label: string; qty: number }
const NOM_KEY = 'zone_responsable_nom';

export default function MatchZonePetitMateriel() {
  const { token, session, loading } = useMatchSession();
  const [nom, setNom] = useState('');
  const [items, setItems] = useState<Item[]>([]);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [ready, setReady] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState('');

  useEffect(() => {
    try { const s = localStorage.getItem(NOM_KEY); if (s) setNom(s); } catch { /* stockage indispo */ }
  }, []);

  useEffect(() => {
    if (!token || !session?.success || !PETIT_MATERIEL_ENABLED) return;
    void supabase.rpc('get_zone_petit_materiel', { p_token: token }).then(({ data, error }) => {
      const r = data as { success?: boolean; items?: Item[] } | null;
      if (error || !r?.success) { setReady(false); return; }
      const rows = r.items ?? [];
      setItems(rows);
      setQty(Object.fromEntries(rows.map((x) => [x.item_id, x.qty])));
      setReady(true);
    });
  }, [token, session]);

  const total = useMemo(() => Object.values(qty).reduce((s, v) => s + (v || 0), 0), [qty]);
  const nomCheck = validateStaffName(nom);
  const nomValid = nomCheck.ok;

  async function save() {
    if (!nomValid || !token) return;
    setSaving(true);
    try { localStorage.setItem(NOM_KEY, nom); } catch { /* stockage indispo */ }
    const lines = items.map((it) => ({ item_id: it.item_id, qty: qty[it.item_id] ?? 0 }));
    const { data, error } = await supabase.rpc('save_zone_petit_materiel', { p_token: token, p_responsable: nom, p_lines: lines });
    setSaving(false);
    const r = data as { success?: boolean } | null;
    if (!error && r?.success) setSavedAt(new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }));
  }

  if (loading) return <div className="flex min-h-screen items-center justify-center bg-pr-cream text-pr-black-soft/50">Chargement…</div>;
  if (!session?.success) return <div className="p-8 text-center text-pr-black-soft/50">Session expirée.</div>;
  if (!PETIT_MATERIEL_ENABLED)
    return (
      <div className="min-h-screen bg-pr-cream">
        <MatchZoneHeader session={session} back />
        <div className="mx-auto max-w-lg p-6 text-center text-sm text-pr-black-soft/50">Fonctionnalité indisponible.</div>
      </div>
    );

  return (
    <div className="min-h-screen bg-pr-cream pb-28">
      <MatchZoneHeader session={session} back />
      <div className="mx-auto max-w-lg space-y-3 p-4">
        <div className="rounded-xl border border-pr-stone bg-white p-4">
          <p className="font-display text-lg font-black text-pr-black">Besoins petits matériels</p>
          <p className="mt-0.5 text-sm text-pr-black-soft/50">Quantité nécessaire pour le prochain match — {total} pièce(s).</p>
        </div>

        <div className="rounded-xl border border-pr-stone bg-white p-4">
          <label className="mb-2 block text-sm font-medium text-pr-black-soft/80">Votre nom *</label>
          <input
            value={nom}
            onChange={(e) => setNom(e.target.value.toUpperCase())}
            placeholder="NOM Prénom"
            className="min-h-[48px] w-full rounded-lg border border-pr-stone px-3 py-3 text-base focus:ring-2 focus:ring-amber-400"
          />
          {nom.trim().length > 0 && !nomValid && <p className="mt-2 text-xs font-medium text-pr-rust">⚠️ {nomCheck.reason}</p>}
        </div>

        {ready === false && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">Chargement indisponible — réessayez plus tard.</div>
        )}

        {ready && (
          <div className="rounded-xl border border-pr-stone bg-white p-2">
            {items.map((it) => (
              <label key={it.item_id} className="flex items-center justify-between gap-3 border-b border-pr-stone/60 px-2 py-2.5 last:border-0">
                <span className="min-w-0 flex-1 text-sm text-pr-black-soft/80">{it.label}</span>
                <input
                  type="number"
                  min={0}
                  inputMode="numeric"
                  value={qty[it.item_id] || ''}
                  placeholder="0"
                  onChange={(e) => setQty((p) => ({ ...p, [it.item_id]: e.target.value === '' ? 0 : Math.max(0, parseInt(e.target.value) || 0) }))}
                  className="h-11 w-20 shrink-0 rounded-lg border-2 border-pr-stone bg-white text-center text-lg font-bold tabular-nums focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400"
                />
              </label>
            ))}
          </div>
        )}
      </div>

      <div className="fixed inset-x-0 bottom-0 border-t border-pr-stone bg-white/95 p-4 backdrop-blur">
        <div className="mx-auto flex max-w-lg items-center justify-between gap-3">
          <span className="min-w-0 flex-1 text-sm">
            {!nomValid ? (
              <span className="text-amber-700">✍️ Entrez votre nom pour enregistrer (RG-001).</span>
            ) : savedAt ? (
              <span className="font-medium text-green-700">✓ Enregistré · {savedAt}</span>
            ) : (
              <span className="text-pr-black-soft/45">Saisissez vos besoins puis enregistrez.</span>
            )}
          </span>
          <button
            onClick={() => void save()}
            disabled={!nomValid || saving}
            className="min-h-[48px] shrink-0 rounded-xl bg-pr-black px-5 py-2 text-sm font-semibold text-white disabled:opacity-40"
          >
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      </div>
    </div>
  );
}
