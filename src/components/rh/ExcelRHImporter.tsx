/**
 * ExcelRHImporter — import du planning prestataire RH.
 * Excel → CSV (SheetJS, côté client) → fonction edge read-rh-planning (Claude,
 * clé côté serveur) → répartition des agents par espace (matching client) →
 * revue/édition → upsert. ⚠ Aucun appel direct à l'API Anthropic depuis le
 * navigateur (clé jamais exposée).
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
export interface ExtractedAgent {
  nom: string;
  prenom: string;
  role: string;
  space_code: string;
  space_id: string | null;
  space_name: string | null;
  start_time: string;
  end_time: string;
  hourly_rate: number | null;
  confidence: 'high' | 'medium' | 'low';
}
interface RawAgent {
  nom?: string; prenom?: string; role?: string; space_code?: string;
  start_time?: string; end_time?: string; hourly_rate?: number | string | null;
}

const norm = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? parseFloat(v) : (v as number);
  return Number.isFinite(n) ? n : null;
};

export function ExcelRHImporter({
  token, spaces, onImported, onClose,
}: {
  token: string;
  spaces: ImporterSpace[];
  onImported: (agents: ExtractedAgent[]) => void;
  onClose: () => void;
}) {
  const [step, setStep] = useState<'upload' | 'reading' | 'review' | 'error'>('upload');
  const [agents, setAgents] = useState<ExtractedAgent[]>([]);
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const matchSpace = useCallback(
    (rawName: string): { id: string | null; name: string | null; conf: ExtractedAgent['confidence'] } => {
      if (!rawName) return { id: null, name: null, conf: 'low' };
      const bMatch = rawName.trim().match(/^B\s*(\d+)$/i);
      if (bMatch) {
        const n = parseInt(bMatch[1], 10);
        const found = spaces.find((s) => s.space_name === `B${n}` || norm(s.space_name).includes(`buvette ${n}`));
        if (found) return { id: found.space_id, name: found.space_name, conf: 'high' };
      }
      const rawWords = norm(rawName).split(' ').filter((w) => w.length > 2);
      let best: ImporterSpace | null = null;
      let bestScore = 0;
      for (const sp of spaces) {
        const spWords = norm(sp.space_name).split(' ').filter((w) => w.length > 2);
        const common = rawWords.filter((w) => spWords.some((sw) => sw.includes(w) || w.includes(sw)));
        const score = rawWords.length > 0 ? common.length / rawWords.length : 0;
        if (score > bestScore) { bestScore = score; best = sp; }
      }
      if (!best || bestScore < 0.3) return { id: null, name: null, conf: 'low' };
      return { id: best.space_id, name: best.space_name, conf: bestScore >= 0.8 ? 'high' : bestScore >= 0.5 ? 'medium' : 'low' };
    },
    [spaces],
  );

  const handleFile = useCallback(
    async (file: File) => {
      if (!/\.(xlsx|xls|csv)$/i.test(file.name)) { setError('Format non supporté. Utilisez XLS, XLSX ou CSV.'); setStep('error'); return; }
      if (file.size > 10 * 1024 * 1024) { setError('Fichier trop lourd (max 10 Mo).'); setStep('error'); return; }
      setFileName(file.name);
      setStep('reading');
      try {
        const buffer = await file.arrayBuffer();
        const wb = XLSX.read(buffer, { type: 'array' });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });

        const { data, error: fnError } = await supabase.functions.invoke('read-rh-planning', {
          body: { csv, token, spaces: spaces.map((s) => ({ space_name: s.space_name, service_type: s.service_type })) },
        });
        const res = data as { success?: boolean; error?: string; agents?: RawAgent[] } | null;
        if (fnError || !res?.success) { setError(res?.error ?? fnError?.message ?? 'Lecture impossible.'); setStep('error'); return; }

        const matched: ExtractedAgent[] = (res.agents ?? []).map((a) => {
          const m = matchSpace(a.space_code ?? '');
          return {
            nom: (a.nom ?? '').toUpperCase().trim(),
            prenom: (a.prenom ?? '').trim(),
            role: a.role ?? 'Autre',
            space_code: a.space_code ?? '',
            space_id: m.id,
            space_name: m.name,
            start_time: a.start_time ?? '',
            end_time: a.end_time ?? '',
            hourly_rate: num(a.hourly_rate),
            confidence: m.conf,
          };
        });
        setAgents(matched);
        setStep('review');
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Erreur lors de la lecture.');
        setStep('error');
      }
    },
    [matchSpace, spaces, token],
  );

  const nbHigh = agents.filter((a) => a.confidence === 'high' && a.space_id).length;
  const nbMedium = agents.filter((a) => a.confidence === 'medium' && a.space_id).length;
  const nbLow = agents.filter((a) => !a.space_id).length;

  const update = (i: number, patch: Partial<ExtractedAgent>) =>
    setAgents((prev) => prev.map((a, j) => (j === i ? { ...a, ...patch } : a)));

  if (step === 'upload')
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2"><Sparkles size={16} className="text-amber-500" /><p className="text-sm font-semibold text-stone-800">Import Excel prestataire RH</p></div>
        <p className="text-xs text-stone-500">Déposez le fichier du prestataire. Claude lit le planning et répartit chaque agent dans son espace.</p>
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
        <div><p className="font-bold text-stone-900">Claude analyse le planning…</p><p className="mt-1 text-xs text-stone-400">{fileName}</p></div>
        <div className="space-y-1 text-xs text-stone-400"><p>✓ Lecture du fichier Excel</p><p>✓ Extraction noms, prénoms, horaires</p><p>✓ Répartition par espace</p></div>
      </div>
    );

  if (step === 'review')
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-bold text-stone-800">{agents.length} agents extraits</p>
          <button onClick={() => { setStep('upload'); setAgents([]); }} className="text-xs text-stone-400 hover:text-stone-700">↩ Réimporter</button>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="rounded-full bg-green-100 px-2.5 py-1 text-xs font-semibold text-green-700">✅ {nbHigh} reconnus</span>
          {nbMedium > 0 && <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-700">⚠️ {nbMedium} à vérifier</span>}
          {nbLow > 0 && <span className="rounded-full bg-red-100 px-2.5 py-1 text-xs font-semibold text-red-700">❌ {nbLow} non assignés</span>}
        </div>
        <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
          {agents.map((a, i) => (
            <div key={i} className={`rounded-xl border p-3 ${a.space_id ? (a.confidence === 'high' ? 'border-green-200 bg-green-50' : 'border-amber-200 bg-amber-50') : 'border-red-200 bg-red-50'}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-stone-800">{a.prenom} {a.nom}</p>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                    <span className="text-[10px] text-stone-500">{a.role}</span>
                    {a.start_time && <span className="text-[10px] text-stone-500">⏰ {a.start_time}→{a.end_time || '—'}</span>}
                  </div>
                  <select
                    value={a.space_id ?? ''}
                    onChange={(e) => {
                      const sp = spaces.find((s) => s.space_id === e.target.value);
                      update(i, { space_id: e.target.value || null, space_name: sp?.space_name ?? null, confidence: e.target.value ? 'high' : 'low' });
                    }}
                    className={`mt-2 w-full rounded-lg border px-2 py-1.5 text-xs ${a.space_id ? 'border-stone-200 bg-white' : 'border-red-300 bg-white'}`}
                  >
                    <option value="">{a.space_code ? `❌ « ${a.space_code} » — choisir l'espace` : "-- Choisir l'espace --"}</option>
                    {spaces.map((s) => <option key={s.space_id} value={s.space_id}>{s.space_name}</option>)}
                  </select>
                </div>
                <button onClick={() => setAgents((prev) => prev.filter((_, j) => j !== i))} className="shrink-0 px-1 text-[10px] text-stone-300 hover:text-red-500">✕</button>
              </div>
            </div>
          ))}
        </div>
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 rounded-xl border border-stone-200 py-2.5 text-sm text-stone-600">Annuler</button>
          <button
            onClick={() => onImported(agents.filter((a) => a.space_id && a.nom && a.prenom))}
            disabled={agents.filter((a) => a.space_id && a.nom && a.prenom).length === 0}
            className="flex-1 rounded-xl bg-stone-900 py-2.5 text-sm font-bold text-white disabled:opacity-40"
          >
            Importer {agents.filter((a) => a.space_id && a.nom && a.prenom).length} agents →
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
