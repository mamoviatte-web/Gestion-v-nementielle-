/**
 * ExcelRHImporter — import du planning prestataire RH, 100 % côté client.
 * Excel (exceljs) / CSV → détection des blocs par feuille → resolve_space
 * (restauration) ou pôle (hors resto) → revue/édition → insertion via
 * rh_import_agents_by_token. Plus AUCUN appel Edge Function.
 * Formats acceptés : .xlsx et .csv (le .xls binaire n'est plus supporté).
 */

import { useCallback, useRef, useState } from 'react';
import { readSheetsFromFile, type AoaSheetIn } from '@/lib/xlsxAoa';
import { Upload, Sparkles, Loader, AlertTriangle } from 'lucide-react';
import { supabase } from '@/lib/supabase';

export interface ImporterSpace {
  space_id: string;
  space_name: string;
  service_type?: string;
}

interface ReviewAgent {
  key: string;
  titre: string;
  pole: string | null;
  nom: string;
  prenom: string;
  poste: string;
  role: string;
  space_id: string | null;
  space_name: string | null;
  start: string;
  end: string;
  hours: number;
  rate: number;
  confidence: number;
  a_confirmer: boolean;
}

const ROLE_ENUM = [
  'Serveur', 'Chef de rang', 'Barman', 'Agent de sécurité', 'Runner', 'Hôte / Hôtesse', 'Responsable espace', 'Autre',
] as const;
/** Mots-clés pôle hors resto (détectés sur le titre du bandeau OU le nom de feuille). */
const POLE_KW: [RegExp, string][] = [
  [/cashless/i, 'Cashless'],
  [/s[ée]cu|securit|mascotte/i, 'Sécurité/Mascotte'],
  [/accueil|scan/i, 'Accueil/Scanettes'],
  [/autre/i, 'Autres'],
];

const nettoie = (v: unknown): string =>
  String(v ?? '').replace(/[✅☑✔]/g, '').replace(/#REF!/g, '').replace(/#+/g, '').trim();
const estEntete = (cells: string[]): boolean => {
  const t = cells.map((c) => c.toLowerCase()).join(' ');
  return t.includes('poste') && t.includes('nom');
};
const premiereCelluleNonVide = (row: string[]): string => {
  for (const c of row) { const v = nettoie(c); if (v) return v; }
  return '';
};

/** Normalise une cellule d'heure (Date, nombre Excel = fraction/heures, ou texte) → 'HH:MM' ou null. */
function normHeure(v: unknown): string | null {
  if (v == null || v === '') return null;
  if (v instanceof Date) return `${String(v.getHours()).padStart(2, '0')}:${String(v.getMinutes()).padStart(2, '0')}`;
  if (typeof v === 'number') {
    let mins: number;
    if (v > 0 && v <= 1) mins = Math.round(v * 24 * 60);          // fraction de jour (0.708 = 17:00)
    else if (v > 1 && v <= 48) mins = Math.round(v * 60);         // heures décimales (17 = 17:00)
    else mins = Math.round((v % 1) * 24 * 60);                     // série datetime → partie décimale
    const h = Math.floor(mins / 60) % 24, m = ((mins % 60) + 60) % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
  const s = String(v).trim();
  const m = s.match(/(\d{1,2})\s*[:hH.]\s*(\d{2})/);
  if (m) { let mm = +m[2]; if (mm > 59) mm = 0; return `${String(+m[1] % 24).padStart(2, '0')}:${String(mm).padStart(2, '0')}`; }
  const m2 = s.match(/^(\d{1,2})[hH]$/);
  if (m2) return `${String(+m2[1] % 24).padStart(2, '0')}:00`;
  return null;
}

/** Noms de famille en MAJUSCULES (éventuellement composés) + prénom en casse mixte. */
function splitNom(sRaw: string): { nom: string; prenom: string } {
  const s = String(sRaw ?? '').replace(/[✅☑✔]/g, '').replace(/\s+/g, ' ').trim();
  const toks = s.split(' ').filter(Boolean);
  if (toks.length <= 1) return { nom: toks[0] || s || 'Agent', prenom: '-' };
  const estMaj = (t: string): boolean => t === t.toUpperCase() && /[A-ZÀ-Ý]/.test(t);
  let k = 0;
  while (k < toks.length && estMaj(toks[k])) k++;
  if (k === 0) k = 1;
  if (k === toks.length) k = toks.length - 1;
  return { nom: toks.slice(0, k).join(' '), prenom: toks.slice(k).join(' ') || '-' };
}

/** Durée (heures décimales) entre deux 'HH:MM', gère le passage minuit. */
function dureeH(arr: string, dep: string): number {
  const A = arr.match(/(\d{2}):(\d{2})/), D = dep.match(/(\d{2}):(\d{2})/);
  if (!A || !D) return 0;
  let x = +D[1] * 60 + +D[2] - (+A[1] * 60 + +A[2]);
  if (x < 0) x += 24 * 60;
  return +(x / 60).toFixed(2);
}

const mapRole = (poste: string): string => {
  const p = poste.toLowerCase();
  if (/respo/.test(p)) return 'Responsable espace';
  if (/chef.*rang/.test(p)) return 'Chef de rang';
  if (/barman|\bbar\b/.test(p)) return 'Barman';
  if (/s[ée]cu|securit|mascotte/.test(p)) return 'Agent de sécurité';
  if (/runner/.test(p)) return 'Runner';
  if (/h[oô]te|hotesse|accueil|scan/.test(p)) return 'Hôte / Hôtesse';
  if (/serveur|\bserv\b/.test(p)) return 'Serveur';
  return 'Autre';
};
const taux = (poste: string): number => (/respo/i.test(poste) ? 12 : 16.5);

interface RawBloc {
  titre: string;
  pole: string | null;
  agents: { poste: string; nomPrenom: string; arr: string; dep: string }[];
}

/**
 * Détection ancrée sur la ligne d'EN-TÊTES : le titre du bloc = 1re cellule non vide de la
 * ligne juste au-dessus (le « bandeau noir » fusionné, dont la valeur est en colonne B ;
 * colonne A = logo, vide). Gère 1 ou plusieurs blocs par feuille.
 */
function parseFeuille(sheet: AoaSheetIn): RawBloc[] {
  const rowsFmt = sheet.fmt;
  const rowsRaw = sheet.raw;
  const txt = rowsFmt.map((r) => (r as unknown[]).map(nettoie));
  const sheetPole = POLE_KW.find(([re]) => re.test(sheet.name))?.[1] ?? null;
  const cell = (arr: unknown[] | undefined, i: number): unknown => (arr ? arr[i] : undefined);
  const blocs: RawBloc[] = [];
  for (let i = 0; i < txt.length; i++) {
    if (!estEntete(txt[i])) continue;
    let titre = i >= 1 ? premiereCelluleNonVide(txt[i - 1]) : '';
    if (!titre && i >= 2) titre = premiereCelluleNonVide(txt[i - 2]);
    const agents: RawBloc['agents'] = [];
    for (let j = i + 1; j < txt.length; j++) {
      if (estEntete(txt[j])) break;
      const c = txt[j];
      const poste = c[0] ?? '', nomPrenom = c[1] ?? '';
      if (!nomPrenom && !poste) { if (agents.length) break; else continue; }
      if (/merci d'envoyer/i.test(c.join(' '))) continue;
      if (!nomPrenom) continue;
      const arr = normHeure(cell(rowsFmt[j] as unknown[], 2)) ?? normHeure(cell(rowsRaw[j] as unknown[], 2));
      const dep =
        normHeure(cell(rowsFmt[j] as unknown[], 4)) ?? normHeure(cell(rowsRaw[j] as unknown[], 4)) ??  // départ réel (E)
        normHeure(cell(rowsFmt[j] as unknown[], 3)) ?? normHeure(cell(rowsRaw[j] as unknown[], 3));    // départ théorique (D)
      agents.push({ poste, nomPrenom, arr: arr ?? '', dep: dep ?? '' });
    }
    if (titre && agents.length) blocs.push({ titre, pole: sheetPole, agents });
  }
  return blocs;
}

export function ExcelRHImporter({
  token, spaces, onDone, onClose,
}: {
  token: string;
  spaces: ImporterSpace[];
  onDone: (inserted: number) => void;
  onClose: () => void;
}) {
  const [step, setStep] = useState<'upload' | 'reading' | 'review' | 'error'>('upload');
  const [agents, setAgents] = useState<ReviewAgent[]>([]);
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    async (file: File) => {
      if (!/\.(xlsx|csv)$/i.test(file.name)) {
        setError(
          /\.xls$/i.test(file.name)
            ? "Le format .xls (ancien Excel) n'est plus supporté. Ré-enregistrez le fichier en .xlsx ou .csv."
            : 'Format non supporté. Utilisez XLSX ou CSV.',
        );
        setStep('error');
        return;
      }
      if (file.size > 10 * 1024 * 1024) { setError('Fichier trop lourd (max 10 Mo).'); setStep('error'); return; }
      setFileName(file.name);
      setStep('reading');
      try {
        // 1) Lire toutes les feuilles puis parser tous les blocs.
        const sheets = await readSheetsFromFile(file);
        const blocs = sheets.flatMap((s) => parseFeuille(s));
        if (blocs.length === 0) { setError('Aucun bloc agent détecté dans le fichier.'); setStep('error'); return; }
        // 2) Résoudre l'espace de chaque bloc restauration (pôles = hors resto, par mot-clé du titre).
        const review: ReviewAgent[] = [];
        for (const b of blocs) {
          const pole = b.pole ?? POLE_KW.find(([re]) => re.test(b.titre))?.[1] ?? null;
          let spaceId: string | null = null;
          let spaceName: string | null = null;
          let confidence = 1;
          let aConfirmer = false;
          if (!pole) {
            const { data } = await supabase.rpc('resolve_space', { p_label: b.titre });
            const r = data as { space_id?: string | null; space_name?: string | null; confidence?: number; a_confirmer?: boolean } | null;
            spaceId = r?.space_id ?? null;
            spaceName = r?.space_name ?? null;
            confidence = Number(r?.confidence ?? 0);
            aConfirmer = r?.a_confirmer === true || !spaceId || confidence < 0.6;
          }
          for (const a of b.agents) {
            const { nom, prenom } = splitNom(a.nomPrenom);
            review.push({
              key: crypto.randomUUID(),
              titre: b.titre,
              pole,
              nom,
              prenom,
              poste: a.poste,
              role: mapRole(a.poste),
              space_id: spaceId,
              space_name: spaceName,
              start: a.arr,
              end: a.dep,
              hours: dureeH(a.arr, a.dep),
              rate: taux(a.poste),
              confidence,
              a_confirmer: aConfirmer,
            });
          }
        }
        setAgents(review);
        setStep('review');
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Erreur lors de la lecture.');
        setStep('error');
      }
    },
    [],
  );

  const update = (key: string, patch: Partial<ReviewAgent>) =>
    setAgents((prev) => prev.map((a) => (a.key === key ? { ...a, ...patch } : a)));

  // Choix d'espace sur un bloc « à confirmer » → applique à tous les agents du bloc + mémorise l'alias.
  async function pickSpace(titre: string, spaceId: string) {
    const sp = spaces.find((s) => s.space_id === spaceId);
    setAgents((prev) =>
      prev.map((a) => (a.titre === titre ? { ...a, space_id: spaceId || null, space_name: sp?.space_name ?? null, a_confirmer: false } : a)),
    );
    if (spaceId) await supabase.rpc('learn_space_alias', { p_label: titre, p_space_id: spaceId });
  }

  const valides = agents.filter((a) => a.nom && (a.pole || a.space_id));
  const nbAuto = agents.filter((a) => !a.pole && a.space_id && !a.a_confirmer).length;
  const nbPole = agents.filter((a) => a.pole).length;
  const nbConfirm = agents.filter((a) => !a.pole && a.a_confirmer).length;

  async function confirmer() {
    setSaving(true);
    try {
      const rows = valides.map((a) => ({
        space_id: a.pole ? null : a.space_id,
        nom: a.nom,
        prenom: a.prenom,
        role: a.role,
        start: a.start || '00:00',
        end: a.end || null,
        hours: a.hours || null,
        rate: a.rate || null,
        note: a.pole ? `Pôle: ${a.pole}` : null,
      }));
      const { data, error: err } = await supabase.rpc('rh_import_agents_by_token', { p_token: token, p_agents: rows });
      const res = data as { success?: boolean; inserted?: number; error?: string } | null;
      if (err || !res?.success) { setError(res?.error ?? err?.message ?? 'Échec de l\'enregistrement.'); setStep('error'); return; }
      onDone(res.inserted ?? rows.length);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur lors de l\'enregistrement.');
      setStep('error');
    } finally {
      setSaving(false);
    }
  }

  if (step === 'upload')
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2"><Sparkles size={16} className="text-amber-500" /><p className="text-sm font-semibold text-stone-800">Importer le planning Excel prestataire</p></div>
        <p className="text-xs text-stone-500">Déposez le fichier d'émargement. Chaque feuille/bloc est réparti par espace (restauration) ou par pôle (hors resto).</p>
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) void handleFile(f); }}
          onClick={() => inputRef.current?.click()}
          className={`cursor-pointer rounded-2xl border-2 border-dashed p-8 text-center transition-all ${dragOver ? 'border-amber-400 bg-amber-50' : 'border-stone-200 hover:border-amber-300 hover:bg-stone-50'}`}
        >
          <input ref={inputRef} type="file" accept=".xlsx,.csv" onChange={(e) => e.target.files?.[0] && void handleFile(e.target.files[0])} className="hidden" />
          <Upload size={32} className="mx-auto mb-3 text-stone-300" />
          <p className="text-sm font-semibold text-stone-700">Déposez ou cliquez pour choisir</p>
          <p className="mt-1 text-xs text-stone-400">XLSX · CSV · Max 10 Mo</p>
        </div>
        <button onClick={onClose} className="w-full py-2 text-sm text-stone-400 hover:text-stone-600">Saisir manuellement</button>
      </div>
    );

  if (step === 'reading')
    return (
      <div className="space-y-4 py-8 text-center">
        <div className="relative mx-auto h-14 w-14">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-amber-200 bg-amber-50"><Sparkles size={24} className="animate-pulse text-amber-500" /></div>
          <div className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-stone-900"><Loader size={10} className="animate-spin text-white" /></div>
        </div>
        <div><p className="font-bold text-stone-900">Lecture du planning…</p><p className="mt-1 text-xs text-stone-400">{fileName}</p></div>
        <div className="space-y-1 text-xs text-stone-400"><p>✓ Lecture des feuilles Excel</p><p>✓ Détection des blocs & agents</p><p>✓ Rattachement des espaces</p></div>
      </div>
    );

  if (step === 'review')
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-bold text-stone-800">{agents.length} agents détectés</p>
          <button onClick={() => { setStep('upload'); setAgents([]); }} className="text-xs text-stone-400 hover:text-stone-700">↩ Réimporter</button>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="rounded-full bg-green-100 px-2.5 py-1 text-xs font-semibold text-green-700">✅ {nbAuto} auto-rattachés</span>
          {nbPole > 0 && <span className="rounded-full bg-blue-100 px-2.5 py-1 text-xs font-semibold text-blue-700">🏷 {nbPole} hors resto</span>}
          {nbConfirm > 0 && <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-700">⚠️ {nbConfirm} à confirmer</span>}
        </div>
        <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
          {agents.map((a) => (
            <div key={a.key} className={`rounded-xl border p-3 ${a.pole ? 'border-blue-200 bg-blue-50' : a.space_id && !a.a_confirmer ? 'border-green-200 bg-green-50' : 'border-amber-200 bg-amber-50'}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-stone-800">{a.prenom} {a.nom}</p>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] text-stone-500">
                    <span>{a.role}</span>
                    {a.start && <span>⏰ {a.start}→{a.end || '—'}</span>}
                    <span>· {a.hours.toFixed(1)} h · {a.rate} €/h</span>
                    <span className="italic text-stone-400">({a.titre})</span>
                  </div>
                  {a.pole ? (
                    <p className="mt-2 rounded-lg bg-white px-2 py-1.5 text-xs font-medium text-blue-700">🏷 Pôle : {a.pole} (hors restauration)</p>
                  ) : (
                    <select
                      value={a.space_id ?? ''}
                      onChange={(e) => void pickSpace(a.titre, e.target.value)}
                      className={`mt-2 w-full rounded-lg border px-2 py-1.5 text-xs ${a.space_id && !a.a_confirmer ? 'border-stone-200 bg-white' : 'border-amber-300 bg-white'}`}
                    >
                      <option value="">{`⚠️ « ${a.titre} » — choisir l'espace`}</option>
                      {spaces.map((s) => <option key={s.space_id} value={s.space_id}>{s.space_name}</option>)}
                    </select>
                  )}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <button onClick={() => setAgents((prev) => prev.filter((x) => x.key !== a.key))} className="px-1 text-[10px] text-stone-300 hover:text-red-500">✕</button>
                  <select
                    value={a.role}
                    onChange={(e) => update(a.key, { role: e.target.value })}
                    className="rounded border border-stone-200 bg-white px-1 py-0.5 text-[10px]"
                  >
                    {ROLE_ENUM.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 rounded-xl border border-stone-200 py-2.5 text-sm text-stone-600">Annuler</button>
          <button
            onClick={() => void confirmer()}
            disabled={valides.length === 0 || saving}
            className="flex-1 rounded-xl bg-stone-900 py-2.5 text-sm font-bold text-white disabled:opacity-40"
          >
            {saving ? 'Enregistrement…' : `Confirmer l'import (${valides.length}) →`}
          </button>
        </div>
      </div>
    );

  return (
    <div className="space-y-4 py-6 text-center">
      <AlertTriangle size={32} className="mx-auto text-red-400" />
      <p className="font-bold text-stone-900">Lecture impossible</p>
      <p className="mx-auto max-w-xs text-xs text-stone-500">{error}</p>
      <div className="flex justify-center gap-3">
        <button onClick={() => { setStep('upload'); setError(''); }} className="rounded-xl border border-stone-200 px-4 py-2 text-sm text-stone-600">Réessayer</button>
        <button onClick={onClose} className="rounded-xl bg-stone-900 px-4 py-2 text-sm font-semibold text-white">Saisir manuellement</button>
      </div>
    </div>
  );
}
