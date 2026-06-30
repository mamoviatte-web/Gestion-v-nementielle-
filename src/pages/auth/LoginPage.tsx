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
import { Building2, KeyRound, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { Button, Input, Alert, Logo } from '@/components/ui';

type Mode = 'stade' | 'responsable';

function credentialsFromCode(code: string): { email: string; password: string } {
  const normalized = code.trim().toUpperCase();
  return { email: `${normalized.toLowerCase()}@stade.fr`, password: normalized };
}

export default function LoginPage() {
  const navigate = useNavigate();
  const { login, error } = useAuth();

  const [mode, setMode] = useState<Mode>('stade');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleStadeSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    const user = await login(email.trim(), password);
    setSubmitting(false);
    if (user) navigate('/admin/dashboard', { replace: true });
  }

  async function handleResponsableSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    const { email: respEmail, password: respPassword } = credentialsFromCode(code);
    const user = await login(respEmail, respPassword);
    setSubmitting(false);
    if (user) navigate('/provider/home', { replace: true });
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
              onClick={() => setMode('responsable')}
              className={`flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                mode === 'responsable'
                  ? 'bg-pr-black text-white shadow-sm'
                  : 'text-pr-black-soft hover:bg-pr-stone/50'
              }`}
            >
              <Building2 className="h-4 w-4" /> Responsable
            </button>
          </div>

          {error && (
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
            <form onSubmit={handleResponsableSubmit} className="space-y-4">
              <Input
                label="Code d'accès espace"
                name="code"
                type="text"
                autoComplete="off"
                placeholder="Ex : SN2026"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                hint="Le code fourni par l'équipe Stade pour votre espace."
                className="uppercase"
                required
              />
              <Button type="submit" fullWidth loading={submitting} className="tracking-[0.12em]">
                <KeyRound className="h-4 w-4" /> ACCÈS RESPONSABLE
              </Button>
            </form>
          )}

          {import.meta.env.DEV && (
            <div className="mt-6 rounded-lg bg-pr-cream p-3 text-xs text-pr-olive-dark">
              <p className="font-semibold text-pr-black-soft">Démo (dev uniquement)</p>
              <p className="mt-1">
                Stade : <code>mviatte@provencerugby.com</code> / <code>StadeMD2026!</code>
              </p>
              <p>
                Responsable : code <code>SN2026</code>, <code>BV12026</code>…
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
