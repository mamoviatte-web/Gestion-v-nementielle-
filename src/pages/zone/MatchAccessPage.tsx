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
  display_name?: string | null;
  service_type: 'vip' | 'bar' | 'buvette' | 'bodega' | null;
  /** Famille prête pour les onglets, fournie par le serveur : « VIP & Bars » ou « Buvettes ». */
  family?: string | null;
  is_buvette?: boolean;
  /** Slot superviseur buvettes (Buvette 1/2) → mène au flux superviseur. */
  is_supervisor?: boolean;
  max_pax: number | null;
  group_name?: string | null;
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
/** Onglets = valeurs `family` renvoyées par le serveur (+ « all » = tous). */
type Filter = 'all' | 'VIP & Bars' | 'Buvettes';

/**
 * Famille d'un espace : on privilégie `family`/`is_buvette` du serveur ; à défaut
 * (cache ancien), repli sur `service_type` — jamais sur le nom (BLOC 3).
 */
function spaceFamily(s: SpaceOption): Filter {
  if (s.family === 'Buvettes' || s.family === 'VIP & Bars') return s.family;
  if (s.is_buvette || s.service_type === 'buvette') return 'Buvettes';
  return 'VIP & Bars';
}

export default function MatchAccessPage() {
  const { code: urlCode } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>('code');
  const [inputCode, setInputCode] = useState((urlCode ?? '').toUpperCase());
  const [eventData, setEventData] = useState<MatchEventData | null>(null);
  const [supervisors, setSupervisors] = useState<SpaceOption[]>([]);
  const [selectedSpace, setSpace] = useState<SpaceOption | null>(null);
  const [serviceFilter, setFilter] = useState<Filter>('all');
  const [staffName, setStaffName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (urlCode && urlCode.length >= 4) void validateCode(urlCode.toUpperCase());
  }, [urlCode]);

  async function validateCode(code: string) {
    setLoading(true);
    setError('');
    const { data, error: err } = await supabase.rpc('validate_match_code', { p_code: code });
    setLoading(false);
    const res = data as MatchEventData | null;
    if (!err && res?.success) {
      setEventData(res);
      // Étape 1 buvettes : les 2 slots superviseurs (Superviseur Buvette 1/2) —
      // la connexion se fait sur ce slot, PUIS le superviseur choisit ses buvettes.
      // La table `spaces` est en RLS (invisible à anon) → RPC SECURITY DEFINER.
      const { data: sup } = await supabase.rpc('get_buvette_supervisors');
      setSupervisors(
        ((sup as { space_id: string; space_name: string; display_name: string | null; service_type: SpaceOption['service_type'] }[] | null) ?? []).map((s) => ({
          ...s, family: 'Buvettes', is_buvette: true, is_supervisor: true, max_pax: null,
        })),
      );
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
      // Slot superviseur buvettes → tableau de bord des buvettes (étape 2 : choix
      // des buvettes gérées) ; sinon accueil de zone standard (VIP / bar).
      const isSup = selectedSpace?.is_supervisor || (selectedSpace?.nb_buvettes ?? 0) > 0;
      const dest = isSup ? `/zone/match/${token}/buvettes` : `/zone/match/${token}`;
      setTimeout(() => navigate(dest), 1200);
    } else {
      setError(res?.error ?? "Erreur lors de l'enregistrement");
    }
  }

  // Onglet « Buvettes » = les 2 superviseurs (étape 1) ; on ne liste plus les
  // buvettes physiques avant d'avoir choisi le superviseur (elles sont cochées
  // en étape 2 via get_zone_buvettes).
  const vipBars = (eventData?.spaces ?? []).filter((s) => spaceFamily(s) === 'VIP & Bars');
  const filteredSpaces =
    serviceFilter === 'Buvettes' ? supervisors : serviceFilter === 'VIP & Bars' ? vipBars : [...vipBars, ...supervisors];

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
                  { key: 'VIP & Bars', label: '⭐ VIP & Bars' },
                  { key: 'Buvettes', label: '🍺 Buvettes' },
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
                      <p className="font-medium text-pr-black">{space.display_name ?? space.space_name}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {space.is_supervisor ? (
                        <span className="rounded-full bg-indigo-100 px-2 text-xs text-indigo-700">Superviseur</span>
                      ) : spaceFamily(space) === 'Buvettes' ? (
                        <span className="rounded-full bg-sky-100 px-2 text-xs text-sky-700">Buvette</span>
                      ) : (
                        <span className="rounded-full bg-amber-100 px-2 text-xs text-amber-700">
                          {space.service_type === 'bar' ? 'Bar' : 'VIP'}
                        </span>
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
              <p className="mt-1 font-medium">{selectedSpace?.display_name ?? selectedSpace?.space_name}</p>
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
              {staffName.toUpperCase()} · {selectedSpace?.display_name ?? selectedSpace?.space_name}
            </p>
            <p className="mt-4 text-xs text-pr-black-soft/40">Redirection en cours…</p>
          </div>
        )}
      </div>
    </div>
  );
}
