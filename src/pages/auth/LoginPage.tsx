/**
 * Page de connexion — deux modes (CDC V1.1) :
 *   A. Équipe Stade (ROLE_STADE)        → email + mot de passe
 *   B. Responsable d'espace (RESPONSABLE) → code d'accès unique (ex: SN2026)
 *
 * Le code responsable sert à la fois d'identifiant et de mot de passe :
 *   email = {code}@stade.fr, password = {code}.
 */

import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, KeyRound, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { Button, Input, Alert } from '@/components/ui';

type Mode = 'stade' | 'responsable';

/**
 * Construit l'email/mot de passe à partir d'un code espace.
 * Email en minuscules (forme canonique GoTrue), mot de passe = code en
 * majuscules (ex: SN2026 → sn2026@stade.fr / SN2026).
 */
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
    const { email: respEmail, password: respPassword } =
      credentialsFromCode(code);
    const user = await login(respEmail, respPassword);
    setSubmitting(false);
    if (user) navigate('/provider/home', { replace: true });
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-provence px-4 py-12">
      <div className="w-full max-w-md">
        {/* En-tête */}
        <div className="mb-6 text-center text-white">
          <h1 className="text-2xl font-bold">Stade Maurice David</h1>
          <p className="mt-1 text-sm text-slate-300">
            Gestion événementielle — Provence Rugby
          </p>
        </div>

        <div className="rounded-2xl bg-white p-6 shadow-xl">
          {/* Sélecteur de mode */}
          <div className="mb-6 grid grid-cols-2 gap-2 rounded-lg bg-slate-100 p-1">
            <button
              type="button"
              onClick={() => setMode('stade')}
              className={`flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                mode === 'stade'
                  ? 'bg-white text-provence shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <ShieldCheck className="h-4 w-4" /> Équipe Stade
            </button>
            <button
              type="button"
              onClick={() => setMode('responsable')}
              className={`flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                mode === 'responsable'
                  ? 'bg-white text-provence shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
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

          {/* Mode A — Équipe Stade */}
          {mode === 'stade' ? (
            <form onSubmit={handleStadeSubmit} className="space-y-4">
              <Input
                label="Email"
                name="email"
                type="email"
                autoComplete="username"
                placeholder="admin@stade-mauricedavid.fr"
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
              <Button type="submit" fullWidth loading={submitting}>
                Connexion Équipe Stade
              </Button>
            </form>
          ) : (
            /* Mode B — Responsable d'espace */
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
              <Button
                type="submit"
                fullWidth
                loading={submitting}
                variant="danger"
              >
                <KeyRound className="h-4 w-4" /> Accès Responsable
              </Button>
            </form>
          )}

          {/* Codes de démonstration (développement uniquement) */}
          {import.meta.env.DEV && (
            <div className="mt-6 rounded-lg bg-slate-50 p-3 text-xs text-slate-500">
              <p className="font-semibold text-slate-600">
                Démo (dev uniquement)
              </p>
              <p className="mt-1">
                Stade : <code>admin@stade-mauricedavid.fr</code> /{' '}
                <code>admin2026</code>
              </p>
              <p>
                Responsable : code <code>SN2026</code>, <code>BV12026</code>…
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
