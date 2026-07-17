/**
 * Page de connexion — deux modes (CDC V1.1) :
 *   A. Équipe Stade (ROLE_STADE)        → email + mot de passe
 *   B. Responsable d'espace (RESPONSABLE) → code d'accès unique (ex: SN2026)
 *
 * Identité de marque Provence Rugby : fond crème, rameau d'olivier, carte
 * blanche, bouton noir, accents olive.
 */

import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { KeyRound, ShieldCheck, Users } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';
import { Button, Input, Alert, Logo } from '@/components/ui';

type Mode = 'stade' | 'rh';

export default function LoginPage() {
  const navigate = useNavigate();
  const { login, error } = useAuth();

  const [mode, setMode] = useState<Mode>('stade');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Accès Responsable RH (code match + nom, session anonyme locale).
  const [rhCode, setRhCode] = useState('');
  const [rhNom, setRhNom] = useState('');
  const [rhError, setRhError] = useState('');
  const [rhLoading, setRhLoading] = useState(false);

  async function handleStadeSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    const user = await login(email.trim(), password);
    setSubmitting(false);
    if (user) navigate('/admin/dashboard', { replace: true });
  }

  async function handleRHSubmit(e: FormEvent) {
    e.preventDefault();
    if (!rhCode.trim() || !rhNom.trim()) return;
    setRhLoading(true);
    setRhError('');
    const { data, error: err } = await supabase.rpc('validate_rh_code', {
      p_code: rhCode.trim().toUpperCase(),
      p_rh_nom: rhNom.trim(),
    });
    setRhLoading(false);
    const res = data as { success?: boolean; session_token?: string; event_name?: string; rh_nom?: string; error?: string } | null;
    if (err || !res?.success || !res.session_token) {
      setRhError(res?.error ?? 'Code RH invalide ou match non actif');
      return;
    }
    localStorage.setItem('rh_session_token', res.session_token);
    localStorage.setItem('rh_event_name', res.event_name ?? '');
    localStorage.setItem('rh_nom', res.rh_nom ?? rhNom.trim());
    navigate('/rh/planning', { replace: true });
  }

  return (
    <div className="relative flex min-h-full items-center justify-center overflow-hidden bg-pr-cream px-4 py-12">
      {/* Filigrane discret du rameau */}
      <div className="pointer-events-none absolute -right-16 -top-10 opacity-[0.04]">
        <Logo variant="mark" size="lg" className="scale-[6]" />
      </div>

      <div className="relative w-full max-w-md animate-pr-fade">
        {/* Logo + titres */}
        <div className="mb-8 flex flex-col items-center">
          <Logo variant="full" size="lg" />
          <div className="mt-4 h-px w-16 bg-pr-olive" />
          <p className="mt-3 font-display text-sm font-bold uppercase tracking-[0.15em] text-pr-black">
            Stade Maurice David
          </p>
          <p className="text-sm text-pr-olive-dark">Gestion opérationnelle</p>
        </div>

        <div className="rounded-2xl border border-pr-stone bg-white p-6 shadow-[0_10px_40px_-15px_rgba(10,10,10,0.25)]">
          {/* Sélecteur de mode */}
          <div className="mb-6 grid grid-cols-2 gap-2 rounded-lg bg-pr-cream p-1">
            <button
              type="button"
              onClick={() => setMode('stade')}
              className={`flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                mode === 'stade'
                  ? 'bg-pr-black text-white shadow-sm'
                  : 'text-pr-black-soft hover:bg-pr-stone/50'
              }`}
            >
              <ShieldCheck className="h-4 w-4" /> Équipe Stade
            </button>
            <button
              type="button"
              onClick={() => setMode('rh')}
              className={`flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                mode === 'rh'
                  ? 'bg-pr-black text-white shadow-sm'
                  : 'text-pr-black-soft hover:bg-pr-stone/50'
              }`}
            >
              <Users className="h-4 w-4" /> Responsable RH
            </button>
          </div>

          {error && mode === 'stade' && (
            <Alert variant="error" className="mb-4">
              {error}
            </Alert>
          )}

          {mode === 'stade' ? (
            <form onSubmit={handleStadeSubmit} className="space-y-4">
              <Input
                label="Identifiant"
                name="email"
                type="email"
                autoComplete="username"
                placeholder="prenom@provencerugby.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
              <Input
                label="Mot de passe"
                name="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <Button
                type="submit"
                fullWidth
                loading={submitting}
                className="tracking-[0.12em]"
              >
                SE CONNECTER
              </Button>
            </form>
          ) : (
            <form onSubmit={handleRHSubmit} className="space-y-4">
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                <p className="text-sm font-semibold text-amber-800">👥 Espace Responsable RH</p>
                <p className="mt-0.5 text-xs text-amber-600">
                  Saisissez le code RH communiqué par l'équipe stade pour planifier le personnel d'un match.
                </p>
              </div>
              <Input
                label="Code d'accès RH"
                name="rh_code"
                type="text"
                autoComplete="off"
                placeholder="Ex : RH3A9F2C"
                value={rhCode}
                onChange={(e) => setRhCode(e.target.value.toUpperCase())}
                className="uppercase tracking-[0.2em]"
                required
              />
              <Input
                label="Votre nom"
                name="rh_nom"
                type="text"
                autoComplete="name"
                placeholder="Prénom Nom"
                value={rhNom}
                onChange={(e) => setRhNom(e.target.value)}
                required
              />
              {rhError && (
                <Alert variant="error">{rhError}</Alert>
              )}
              <Button type="submit" fullWidth loading={rhLoading} disabled={!rhCode.trim() || !rhNom.trim()} className="tracking-[0.12em]">
                <KeyRound className="h-4 w-4" /> ACCÉDER AU PLANNING RH
              </Button>
            </form>
          )}

          {import.meta.env.DEV && mode === 'stade' && (
            <div className="mt-6 rounded-lg bg-pr-cream p-3 text-xs text-pr-olive-dark">
              <p className="font-semibold text-pr-black-soft">Démo (dev uniquement)</p>
              <p className="mt-1">
                Stade : <code>mviatte@provencerugby.com</code> / <code>StadeMD2026!</code>
              </p>
            </div>
          )}
        </div>

        <p className="mt-6 text-center text-xs text-pr-olive-dark">
          Stade Maurice-David · Aix-en-Provence
        </p>
      </div>
    </div>
  );
}
