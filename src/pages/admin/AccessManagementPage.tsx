/**
 * AccessManagementPage (ROLE_STADE) — gestion des comptes équipe.
 *
 * Liste les comptes (public.users) et permet de créer un compte, réinitialiser
 * un mot de passe, activer/désactiver — via les RPC admin_* (is_stade()-gardées,
 * qui garantissent auth.users + tokens '' + identité + public.users, fini le SQL
 * manuel). Le mot de passe créé/réinitialisé est affiché une seule fois à recopier.
 */

import { useCallback, useEffect, useState } from 'react';
import { UserPlus, KeyRound, Power, Copy, RefreshCw, Check, X, ShieldCheck } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/context/ToastContext';
import { PageHeader } from '@/components/layout/PageHeader';
import { Alert, Button, Input, Select, Spinner } from '@/components/ui';

interface UserRow {
  name: string | null; email: string; role: string;
  is_active: boolean; last_login_at: string | null;
}
const ROLE_LABEL: Record<string, string> = { ROLE_STADE: 'Équipe Stade', ROLE_RESPONSABLE: 'Responsable' };

/** Mot de passe fort (Web Crypto), sans caractères ambigus. */
function generatePassword(len = 14): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%&*';
  const arr = new Uint32Array(len);
  crypto.getRandomValues(arr);
  return Array.from(arr, (n) => chars[n % chars.length]).join('');
}

export default function AccessManagementPage() {
  const { showToast } = useToast();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [reveal, setReveal] = useState<{ email: string; password: string } | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase.from('users')
      .select('name, email, role, is_active, last_login_at').order('role').order('email');
    setUsers((data as UserRow[] | null) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function copy(text: string) {
    try { await navigator.clipboard.writeText(text); showToast('Copié.', 'success'); }
    catch { showToast('Copie impossible — sélectionnez le texte manuellement.', 'warning'); }
  }

  async function createUser(form: { name: string; email: string; role: string; password: string }) {
    setBusy(true);
    const { data, error } = await supabase.rpc('admin_create_user', {
      p_email: form.email.trim(), p_password: form.password, p_role: form.role, p_name: form.name.trim() || null,
    });
    setBusy(false);
    const res = data as { success?: boolean; error?: string } | null;
    if (error || !res?.success) { showToast(`Échec : ${res?.error ?? error?.message ?? 'erreur'}`, 'warning'); return; }
    showToast('Compte créé.', 'success');
    setReveal({ email: form.email.trim(), password: form.password });
    setShowCreate(false);
    await load();
  }

  async function resetPassword(email: string) {
    const pwd = generatePassword();
    if (!window.confirm(`Réinitialiser le mot de passe de ${email} ?`)) return;
    setBusy(true);
    const { data, error } = await supabase.rpc('admin_reset_password', { p_email: email, p_password: pwd });
    setBusy(false);
    const res = data as { success?: boolean; error?: string } | null;
    if (error || !res?.success) { showToast(`Échec : ${res?.error ?? error?.message ?? 'erreur'}`, 'warning'); return; }
    showToast('Mot de passe réinitialisé.', 'success');
    setReveal({ email, password: pwd });
  }

  async function toggleActive(u: UserRow) {
    setBusy(true);
    const { data, error } = await supabase.rpc('admin_set_user_active', { p_email: u.email, p_active: !u.is_active });
    setBusy(false);
    const res = data as { success?: boolean; error?: string } | null;
    if (error || !res?.success) { showToast(`Échec : ${res?.error ?? error?.message ?? 'erreur'}`, 'warning'); return; }
    showToast(u.is_active ? 'Compte désactivé.' : 'Compte activé.', 'success');
    await load();
  }

  if (loading) return <Spinner />;

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Gestion des accès"
        description="Comptes équipe (création, réinitialisation, activation). Ne créez jamais un compte à la main en SQL."
        action={<Button onClick={() => { setShowCreate((v) => !v); setReveal(null); }}><UserPlus size={16} /> Nouveau compte</Button>}
      />

      {/* Mot de passe révélé une seule fois */}
      {reveal && (
        <div className="mb-6 rounded-2xl border border-amber-300 bg-amber-50 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-bold text-amber-800">Mot de passe pour {reveal.email}</p>
              <p className="mt-1 text-xs text-amber-700">À recopier maintenant — il ne sera plus affiché.</p>
              <code className="mt-2 inline-block rounded-lg bg-white px-3 py-1.5 font-mono text-sm text-stone-900">{reveal.password}</code>
            </div>
            <div className="flex items-center gap-1">
              <button onClick={() => void copy(reveal.password)} className="inline-flex items-center gap-1 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-bold text-white hover:bg-amber-600"><Copy size={13} /> Copier</button>
              <button onClick={() => setReveal(null)} className="rounded-lg p-1.5 text-amber-600 hover:bg-amber-100"><X size={16} /></button>
            </div>
          </div>
        </div>
      )}

      {showCreate && <CreateForm busy={busy} onCancel={() => setShowCreate(false)} onSubmit={createUser} />}

      <div className="overflow-x-auto rounded-2xl border border-stone-100">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-stone-100 bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-400">
              <th className="px-4 py-2">Compte</th>
              <th className="px-3 py-2">Rôle</th>
              <th className="px-3 py-2">Dernière connexion</th>
              <th className="px-3 py-2">Statut</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-50">
            {users.map((u) => (
              <tr key={u.email} className={u.is_active ? 'text-stone-800' : 'text-stone-400'}>
                <td className="px-4 py-2">
                  <p className="font-medium">{u.name || '—'}</p>
                  <p className="text-xs text-stone-400">{u.email}</p>
                </td>
                <td className="px-3 py-2">
                  <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold ${u.role === 'ROLE_STADE' ? 'bg-stone-900 text-white' : 'bg-blue-100 text-blue-700'}`}>
                    {ROLE_LABEL[u.role] ?? u.role}
                  </span>
                </td>
                <td className="px-3 py-2 text-xs text-stone-400">
                  {u.last_login_at ? new Date(u.last_login_at).toLocaleString('fr-FR') : 'Jamais'}
                </td>
                <td className="px-3 py-2">
                  {u.is_active
                    ? <span className="inline-flex items-center gap-1 text-xs text-emerald-600"><ShieldCheck size={13} /> Actif</span>
                    : <span className="text-xs text-stone-400">Désactivé</span>}
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center justify-end gap-1">
                    <button title="Réinitialiser le mot de passe" disabled={busy} onClick={() => void resetPassword(u.email)}
                      className="rounded-lg p-1.5 text-stone-400 hover:bg-stone-100 hover:text-stone-700 disabled:opacity-40"><KeyRound size={15} /></button>
                    <button title={u.is_active ? 'Désactiver' : 'Activer'} disabled={busy} onClick={() => void toggleActive(u)}
                      className={`rounded-lg p-1.5 disabled:opacity-40 ${u.is_active ? 'text-stone-400 hover:bg-rose-50 hover:text-rose-600' : 'text-emerald-500 hover:bg-emerald-50'}`}><Power size={15} /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CreateForm({
  busy, onCancel, onSubmit,
}: {
  busy: boolean;
  onCancel: () => void;
  onSubmit: (f: { name: string; email: string; role: string; password: string }) => void;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('ROLE_STADE');
  const [password, setPassword] = useState(generatePassword());

  const valid = /\S+@\S+\.\S+/.test(email) && password.length >= 8;

  return (
    <div className="mb-6 space-y-3 rounded-2xl border border-stone-200 bg-white p-5">
      <p className="text-sm font-bold text-stone-800">Créer un compte</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-semibold text-stone-500">Nom</label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Prénom Nom" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-stone-500">Email</label>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="prenom@provencerugby.com" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-stone-500">Rôle</label>
          <Select value={role} onChange={(e) => setRole(e.target.value)}
            options={[{ value: 'ROLE_STADE', label: 'Équipe Stade' }, { value: 'ROLE_RESPONSABLE', label: 'Responsable' }]} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-stone-500">Mot de passe (≥ 8)</label>
          <div className="flex items-center gap-1">
            <Input value={password} onChange={(e) => setPassword(e.target.value)} />
            <button onClick={() => setPassword(generatePassword())} title="Générer un mot de passe fort"
              className="shrink-0 rounded-lg border border-stone-200 p-2 text-stone-500 hover:bg-stone-50"><RefreshCw size={15} /></button>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button disabled={busy || !valid} onClick={() => onSubmit({ name, email, role, password })}>
          <Check size={15} /> Créer le compte
        </Button>
        <button onClick={onCancel} className="rounded-xl border border-stone-200 px-4 py-2 text-sm text-stone-600 hover:bg-stone-50">Annuler</button>
      </div>
      {!valid && <Alert variant="info">Email valide et mot de passe ≥ 8 caractères requis.</Alert>}
    </div>
  );
}
