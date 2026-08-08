/**
 * ExcelRHImporter — import du planning prestataire RH, 100 % côté client.
 * Excel (SheetJS) → détection des blocs par feuille → resolve_space (restauration)
 * ou pôle (hors resto) → revue/édition → insertion via rh_import_agents_by_token.
 * Plus AUCUN appel Edge Function (cause de « Failed to send a request… »).
 */

import { useCallback, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
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

const POLES: Record<string, string> = {
  CASHLESSMEN: 'Cashless',
  'SECU MASCOTTE': 'Sécurité/Mascotte',
  'SCAN ACCUEIL': 'Accueil/Scanettes',
  AUTRES: 'Autres',
};
const HEADER_TOKENS = ['poste', 'nom', 'arriv', 'départ', 'depart', 'temps', 'signature'];
const ROLE_ENUM = [
  'Serveur', 'Chef de rang', 'Barman', 'Agent de sécurité', 'Runner', 'Hôte / Hôtesse', 'Responsable espace', 'Autre',
] as const;

const nettoie = (v: unknown): string => String(v ?? '').replace(/[✅]/g, '').replace(/#REF!/g, '').trim();
const estLigneEntete = (cells: string[]): boolean => {
  const t = cells.map((c) => c.toLowerCase()).join(' ');
  return HEADER_TOKENS.filter((k) => t.includes(k)).length >= 3;
};
const toMin = (h: string): number | null => {
  const m = String(h).match(/(\d{1,2})[:hH.](\d{2})/);
  return m ? +m[1] * 60 + +m[2] : null;
};
/** HH:MM valide depuis un libellé OU un nombre Excel (fraction de jour). Sinon ''. */
const toTime = (raw: unknown): string => {
  if (raw == null) return '';
  const str = String(raw).trim();
  if (str === '') return '';
  // Excel : les heures sont souvent des fractions de jour (0.375 = 09:00).
  const asNum = Number(str.replace(',', '.'));
  if (Number.isFinite(asNum) && asNum > 0 && asNum < 1) {
    const tot = Math.round(asNum * 24 * 60);
    const h = Math.floor(tot / 60) % 24, m = tot % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
  // « 9h30 », « 09:00 », « 9.30 » (fraction déjà traitée au-dessus).
  const m = str.match(/(\d{1,2})\s*[:hH.]\s*(\d{1,2})/);
  if (m) {
    let hh = parseInt(m[1], 10);
    let mm = parseInt(m[2], 10);
    if (mm > 59) mm = 0; // minute invalide → 0 (jamais « 00:89 »)
    if (hh > 23) hh = hh % 24;
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  }
  // « 9 » / « 9h » (heure seule).
  const hOnly = str.match(/^(\d{1,2})\s*[hH]?$/);
  if (hOnly) return `${String(Math.min(23, parseInt(hOnly[1], 10))).padStart(2, '0')}:00`;
  return '';
};
/** Heures travaillées : TEMPS (durée) prioritaire, sinon départ − arrivée (sur HH:MM propres). */
const heuresCalc = (startHHMM: string, endHHMM: string, temps: string): number => {
  const tn = Number(String(temps).replace(',', '.'));
  if (Number.isFinite(tn) && tn > 0 && tn < 1) return +(tn * 24).toFixed(2); // durée = fraction de jour
  const td = String(temps).match(/^(\d{1,2})[:hH](\d{2})$/);
  if (td) { const h = +td[1] + +td[2] / 60; if (h > 0 && h < 24) return +h.toFixed(2); }
  const a = toMin(startHHMM), d = toMin(endHHMM);
  if (a == null || d == null) return 0;
  let diff = d - a;
  if (diff < 0) diff += 24 * 60;
  return +(diff / 60).toFixed(2);
};
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
  agents: { poste: string; nomPrenom: string; arr: string; dep: string; temps: string }[];
}

/** Une ligne agent porte un NOM en colonne B ; une ligne titre a la colonne B vide. */
const aDuNom = (cells: string[]): boolean => !!cells[1] && /[a-zA-ZÀ-ÿ]/.test(cells[1]);
const nonVide = (cells: string[]): boolean => cells.join(' ').trim().length > 0;

/**
 * Détection ancrée sur les EN-TÊTES : structure [titre][en-tête][agents]* répétée.
 * Un en-tête ouvre un bloc dont le titre est le dernier libellé « en attente ».
 * (L'ancienne version absorbait les titres suivants comme des agents → restauration jamais rapprochée.)
 */
function parseFeuille(ws: XLSX.WorkSheet, sheetName: string): RawBloc[] {
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: false, defval: '' });
  const poleFeuille = POLES[sheetName.trim().toUpperCase()] ?? null;
  const blocs: RawBloc[] = [];
  let cur: RawBloc | null = null;
  let pendingTitle = '';
  for (const row of rows) {
    const cells = (row as unknown[]).map(nettoie);
    if (!nonVide(cells)) continue;
    const txt = cells.join(' ').trim();
    if (/merci d'envoyer/i.test(txt)) continue;
    if (estLigneEntete(cells)) {
      cur = { titre: pendingTitle || nettoie(cells[0]) || txt, pole: poleFeuille, agents: [] };
      blocs.push(cur);
      pendingTitle = '';
      continue;
    }
    if (cur && aDuNom(cells)) {
      cur.agents.push({
        poste: nettoie(cells[0]),
        nomPrenom: nettoie(cells[1]),
        arr: nettoie(cells[2]),
        dep: nettoie(cells[4] || cells[3]),
        temps: nettoie(cells[5]),
      });
      continue;
    }
    // Ligne sans nom = libellé d'espace → titre du prochain bloc.
    pendingTitle = nettoie(cells[0] || txt);
  }
  return blocs.filter((b) => b.agents.length > 0);
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
      if (!/\.(xlsx|xls|csv)$/i.test(file.name)) { setError('Format non supporté. Utilisez XLS, XLSX ou CSV.'); setStep('error'); return; }
      if (file.size > 10 * 1024 * 1024) { setError('Fichier trop lourd (max 10 Mo).'); setStep('error'); return; }
      setFileName(file.name);
      setStep('reading');
      try {
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: 'array', cellDates: false });
        // 1) Parser tous les blocs de toutes les feuilles.
        const blocs = wb.SheetNames.flatMap((name) => parseFeuille(wb.Sheets[name], name));
        if (blocs.length === 0) { setError('Aucun bloc agent détecté dans le fichier.'); setStep('error'); return; }
        // 2) Résoudre l'espace de chaque bloc restauration (pôles = hors resto).
        const review: ReviewAgent[] = [];
        for (const b of blocs) {
          let spaceId: string | null = null;
          let spaceName: string | null = null;
          let confidence = 1;
          let aConfirmer = false;
          if (!b.pole) {
            const { data } = await supabase.rpc('resolve_space', { p_label: b.titre });
            const r = data as { space_id?: string | null; space_name?: string | null; confidence?: number; a_confirmer?: boolean } | null;
            spaceId = r?.space_id ?? null;
            spaceName = r?.space_name ?? null;
            confidence = Number(r?.confidence ?? 0);
            aConfirmer = r?.a_confirmer === true || !spaceId || confidence < 0.6;
          }
          for (const a of b.agents) {
            const startC = toTime(a.arr);
            const endC = toTime(a.dep);
            review.push({
              key: crypto.randomUUID(),
              titre: b.titre,
              pole: b.pole,
              nom: (a.nomPrenom.split(/\s+/).filter(Boolean)[0] ?? a.nomPrenom ?? 'Agent').toUpperCase(),
              prenom: a.nomPrenom.split(/\s+/).filter(Boolean).slice(1).join(' ') || '-',
              poste: a.poste,
              role: mapRole(a.poste),
              space_id: spaceId,
              space_name: spaceName,
              start: startC,
              end: endC,
              hours: heuresCalc(startC, endC, a.temps),
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
          <input ref={inputRef} type="file" accept=".xlsx,.xls,.csv" onChange={(e) => e.target.files?.[0] && void handleFile(e.target.files[0])} className="hidden" />
          <Upload size={32} className="mx-auto mb-3 text-stone-300" />
          <p className="text-sm font-semibold text-stone-700">Déposez ou cliquez pour choisir</p>
          <p className="mt-1 text-xs text-stone-400">XLS · XLSX · CSV · Max 10 Mo</p>
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
