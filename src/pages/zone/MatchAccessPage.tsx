/**
 * MatchAccessPage — accès public à un match par code unique.
 * Flux : saisie code → choix espace (VIP/Buvette) → saisie nom → redirection
 * vers le tableau de zone. Aucune authentification requise (RPC SECURITY DEFINER).
 * Route : /match/:code
 */

import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '@/lib/supabase';

interface SpaceOption {
  space_id: string;
  space_name: string;
  service_type: 'vip' | 'bar' | 'buvette' | 'bodega' | null;
  max_pax: number | null;
  group_name: string | null;
  nb_buvettes?: number;
  buvette_codes?: string[];
}
interface MatchEventData {
  success: boolean;
  event_id: string;
  event_name: string;
  event_date: string;
  start_time: string | null;
  status: string;
  spaces: SpaceOption[];
  error?: string;
}

type Step = 'code' | 'space' | 'name' | 'ready';
type Filter = 'all' | 'vip' | 'buvette';

export default function MatchAccessPage() {
  const { code: urlCode } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>('code');
  const [inputCode, setInputCode] = useState((urlCode ?? '').toUpperCase());
  const [eventData, setEventData] = useState<MatchEventData | null>(null);
  const [selectedSpace, setSpace] = useState<SpaceOption | null>(null);
  const [serviceFilter, setFilter] = useState<Filter>('all');
  const [staffName, setStaffName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (urlCode && urlCode.length >= 4) void validateCode(urlCode.toUpperCase());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlCode]);

  async function validateCode(code: string) {
    setLoading(true);
    setError('');
    const { data, error: err } = await supabase.rpc('validate_match_code', { p_code: code });
    setLoading(false);
    const res = data as MatchEventData | null;
    if (!err && res?.success) {
      setEventData(res);
      setStep('space');
    } else {
      setError(res?.error ?? 'Code invalide ou match non actif');
    }
  }

  async function confirmName() {
    if (staffName.trim().length < 3) {
      setError('Merci de saisir votre prénom et nom complets');
      return;
    }
    setLoading(true);
    setError('');
    const { data, error: err } = await supabase.rpc('register_zone_staff', {
      p_match_code: inputCode,
      p_space_id: selectedSpace!.space_id,
      p_staff_name: staffName,
    });
    setLoading(false);
    const res = data as { success: boolean; session_token?: string; error?: string } | null;
    if (!err && res?.success && res.session_token) {
      setStep('ready');
      const token = res.session_token;
      // Superviseur buvettes (nb_buvettes > 0) → tableau de bord des buvettes ;
      // sinon accueil de zone standard (VIP / bar).
      const dest = (selectedSpace?.nb_buvettes ?? 0) > 0 ? `/zone/match/${token}/buvettes` : `/zone/match/${token}`;
      setTimeout(() => navigate(dest), 1200);
    } else {
      setError(res?.error ?? "Erreur lors de l'enregistrement");
    }
  }

  const filteredSpaces = (eventData?.spaces ?? []).filter(
    (s) => serviceFilter === 'all' || s.service_type === serviceFilter,
  );

  return (
    <div className="flex min-h-screen items-center justify-center bg-pr-cream p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <p className="font-display text-2xl font-black text-pr-black">Provence Rugby</p>
          <p className="text-sm text-pr-black-soft/60">Stade Maurice-David</p>
        </div>

        {step === 'code' && (
          <div className="rounded-2xl border border-pr-stone bg-white p-6 shadow-sm">
            <h1 className="mb-2 text-center text-xl font-medium">Accès match</h1>
            <p className="mb-6 text-center text-sm text-pr-black-soft/50">
              Entrez le code communiqué par l'équipe stade
            </p>
            <input
              type="text"
              maxLength={6}
              value={inputCode}
              onChange={(e) => setInputCode(e.target.value.toUpperCase())}
              placeholder="ABC123"
              className="w-full rounded-xl border-2 border-pr-stone px-2 py-4 text-center font-mono text-3xl uppercase tracking-[0.4em] focus:border-pr-black focus:outline-none"
              autoFocus
            />
            {error && <p className="mt-2 text-center text-sm text-red-500">{error}</p>}
            <button
              onClick={() => void validateCode(inputCode)}
              disabled={inputCode.length < 4 || loading}
              className="mt-4 w-full rounded-xl bg-pr-black py-4 font-medium text-white disabled:opacity-40"
            >
              {loading ? 'Vérification…' : 'Accéder →'}
            </button>
          </div>
        )}

        {step === 'space' && eventData && (
          <div className="rounded-2xl border border-pr-stone bg-white p-6 shadow-sm">
            <div className="mb-5 text-center">
              <p className="text-xs uppercase tracking-wide text-pr-black-soft/40">{eventData.event_name}</p>
              <h2 className="mt-1 text-lg font-medium">Mon espace</h2>
            </div>
            <div className="mb-4 flex gap-2">
              {(
                [
                  { key: 'all', label: 'Tous' },
                  { key: 'vip', label: '⭐ VIP & Bars' },
                  { key: 'buvette', label: '🍺 Buvettes' },
                ] as { key: Filter; label: string }[]
              ).map((f) => (
                <button
                  key={f.key}
                  onClick={() => setFilter(f.key)}
                  className={`flex-1 rounded-lg py-2 text-sm transition-colors ${
                    serviceFilter === f.key ? 'bg-pr-black text-white' : 'bg-pr-stone/40 text-pr-black-soft'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <div className="max-h-72 space-y-2 overflow-y-auto">
              {filteredSpaces.map((space) => (
                <button
                  key={space.space_id}
                  onClick={() => setSpace(space)}
                  className={`w-full rounded-xl border-2 p-3 text-left transition-all ${
                    selectedSpace?.space_id === space.space_id
                      ? 'border-pr-black bg-pr-cream/50'
                      : 'border-pr-stone/50 hover:border-pr-stone'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-pr-black">{space.space_name}</p>
                      {(space.nb_buvettes ?? 0) > 0 ? (
                        <p className="mt-0.5 text-xs text-pr-black-soft/50">
                          🍺 {space.nb_buvettes} buvette{(space.nb_buvettes ?? 0) > 1 ? 's' : ''} à superviser
                        </p>
                      ) : (
                        space.group_name && <p className="mt-0.5 text-xs text-pr-black-soft/40">{space.group_name}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {space.service_type === 'vip' && (
                        <span className="rounded-full bg-amber-100 px-2 text-xs text-amber-700">VIP</span>
                      )}
                      {space.service_type === 'buvette' && (
                        <span className="rounded-full bg-sky-100 px-2 text-xs text-sky-700">Buvette</span>
                      )}
                      {selectedSpace?.space_id === space.space_id && <span className="text-pr-black">✓</span>}
                    </div>
                  </div>
                </button>
              ))}
            </div>
            <button
              onClick={() => selectedSpace && setStep('name')}
              disabled={!selectedSpace}
              className="mt-4 w-full rounded-xl bg-pr-black py-4 font-medium text-white disabled:opacity-40"
            >
              Confirmer mon espace →
            </button>
          </div>
        )}

        {step === 'name' && (
          <div className="rounded-2xl border border-pr-stone bg-white p-6 shadow-sm">
            <div className="mb-5 text-center">
              <p className="text-xs text-pr-black-soft/40">{eventData?.event_name}</p>
              <p className="mt-1 font-medium">{selectedSpace?.space_name}</p>
              <h2 className="mt-3 text-lg font-medium">Votre identité</h2>
              <p className="mt-1 text-sm text-pr-black-soft/50">Votre nom sera enregistré pour le suivi RH</p>
            </div>
            <input
              type="text"
              value={staffName}
              onChange={(e) => setStaffName(e.target.value)}
              placeholder="DUPONT Marie"
              className="w-full rounded-xl border-2 border-pr-stone px-3 py-4 text-center text-lg font-medium uppercase tracking-wide focus:border-pr-black focus:outline-none"
              autoFocus
            />
            <p className="mt-2 text-center text-xs text-pr-black-soft/40">Format : NOM Prénom</p>
            {error && <p className="mt-2 text-center text-sm text-red-500">{error}</p>}
            <button
              onClick={() => void confirmName()}
              disabled={staffName.trim().length < 3 || loading}
              className="mt-4 w-full rounded-xl bg-pr-black py-4 font-medium text-white disabled:opacity-40"
            >
              {loading ? 'Enregistrement…' : 'Accéder à mon espace →'}
            </button>
            <button onClick={() => setStep('space')} className="mt-2 w-full py-2 text-sm text-pr-black-soft/40">
              ← Changer d'espace
            </button>
          </div>
        )}

        {step === 'ready' && (
          <div className="rounded-2xl border border-pr-stone bg-white p-8 text-center shadow-sm">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100">
              <span className="text-3xl">✓</span>
            </div>
            <h2 className="mb-1 text-xl font-medium">Bienvenue !</h2>
            <p className="text-sm text-pr-black-soft/60">
              {staffName.toUpperCase()} · {selectedSpace?.space_name}
            </p>
            <p className="mt-4 text-xs text-pr-black-soft/40">Redirection en cours…</p>
          </div>
        )}
      </div>
    </div>
  );
}
