/**
 * InvoiceRegistryView — registre des factures fournisseur (axe Dépôts).
 * Source : vue supplier_delivery_registry. Contrôle DAF : `ecart_facture_vs_lignes`
 * (montant facturé − Σ reçu×prix) surligné en rouge si ≠ 0. Filtres fournisseur /
 * mois / sans PDF / avec écart. Le PDF (bucket privé `invoices`) s'ouvre via une URL
 * signée à la demande.
 */

import { useMemo, useState } from 'react';
import { FileText, Paperclip, Search, AlertTriangle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Badge, Button, EmptyState, Spinner, Table, TBody, TD, TH, THead, TR } from '@/components/ui';
import { formatEuro } from '@/lib/calculations';
import { useInvoiceRegistry, type InvoiceRegistryRow } from '@/hooks/useDepots';

const num = (v: unknown): number | null => {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const frDate = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleDateString('fr-FR') : '—';
const ym = (iso: string | null): string => (iso ? iso.slice(0, 7) : '');

async function openPdf(path: string | null) {
  if (!path) return;
  const { data } = await supabase.storage.from('invoices').createSignedUrl(path, 120);
  if (data?.signedUrl) window.open(data.signedUrl, '_blank', 'noopener');
}

export function InvoiceRegistryView() {
  const { data, isLoading } = useInvoiceRegistry();
  const [supplier, setSupplier] = useState('');
  const [month, setMonth] = useState('');
  const [onlyGap, setOnlyGap] = useState(false);
  const [onlyNoPdf, setOnlyNoPdf] = useState(false);

  const rows = useMemo(() => data ?? [], [data]);

  const suppliers = useMemo(
    () => [...new Set(rows.map((r) => r.supplier_name).filter(Boolean))].sort(),
    [rows],
  );

  const filtered = useMemo(
    () =>
      rows.filter((r) => {
        if (supplier && r.supplier_name !== supplier) return false;
        if (month && ym(r.invoice_date) !== month && ym(r.delivery_date) !== month) return false;
        if (onlyGap && Math.abs(num(r.ecart_facture_vs_lignes) ?? 0) < 0.01) return false;
        if (onlyNoPdf && r.a_pdf) return false;
        return true;
      }),
    [rows, supplier, month, onlyGap, onlyNoPdf],
  );

  const nbGap = rows.filter((r) => Math.abs(num(r.ecart_facture_vs_lignes) ?? 0) >= 0.01).length;

  if (isLoading) return <Spinner label="Chargement du registre…" />;
  if (rows.length === 0)
    return <EmptyState icon={FileText} title="Aucune facture" message="Aucune livraison enregistrée pour l’instant." />;

  return (
    <div className="space-y-3">
      {/* Filtres */}
      <div className="flex flex-wrap items-end gap-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <select
            className="rounded-lg border-0 py-2 pl-8 pr-3 text-sm ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-provence"
            value={supplier}
            onChange={(e) => setSupplier(e.target.value)}
          >
            <option value="">Tous les fournisseurs</option>
            {suppliers.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <input
          type="month"
          className="rounded-lg border-0 px-3 py-2 text-sm ring-1 ring-inset ring-slate-300"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
        />
        <label className="flex items-center gap-1.5 text-sm text-pr-black-soft">
          <input type="checkbox" checked={onlyGap} onChange={(e) => setOnlyGap(e.target.checked)} /> Avec écart
          {nbGap > 0 && <Badge tone="danger">{nbGap}</Badge>}
        </label>
        <label className="flex items-center gap-1.5 text-sm text-pr-black-soft">
          <input type="checkbox" checked={onlyNoPdf} onChange={(e) => setOnlyNoPdf(e.target.checked)} /> Sans PDF
        </label>
        {(supplier || month || onlyGap || onlyNoPdf) && (
          <Button variant="ghost" size="sm" onClick={() => { setSupplier(''); setMonth(''); setOnlyGap(false); setOnlyNoPdf(false); }}>
            Réinitialiser
          </Button>
        )}
      </div>

      <div className="overflow-x-auto rounded-lg ring-1 ring-pr-stone/40">
        <Table>
          <THead>
            <TR>
              <TH className="text-left">Fournisseur</TH>
              <TH className="text-left">Date facture</TH>
              <TH className="text-left">N° facture</TH>
              <TH className="text-left">Dépôt</TH>
              <TH className="text-right">Total reçu</TH>
              <TH className="text-right">Total calculé HT</TH>
              <TH className="text-right">Montant facture HT</TH>
              <TH className="text-right">Écart</TH>
              <TH className="text-center">PDF</TH>
            </TR>
          </THead>
          <TBody>
            {filtered.map((r: InvoiceRegistryRow) => {
              const ecart = num(r.ecart_facture_vs_lignes);
              const hasGap = ecart != null && Math.abs(ecart) >= 0.01;
              return (
                <TR key={r.id} className={hasGap ? 'bg-red-50' : undefined}>
                  <TD className="font-medium text-pr-black">{r.supplier_name}</TD>
                  <TD>{frDate(r.invoice_date)}</TD>
                  <TD className="tabular-nums text-pr-black-soft">{r.invoice_ref ?? '—'}</TD>
                  <TD className="text-pr-black-soft">{r.depot ?? '—'}</TD>
                  <TD className="text-right tabular-nums">{r.total_recu}</TD>
                  <TD className="text-right tabular-nums">{num(r.total_calcule_ht) != null ? formatEuro(num(r.total_calcule_ht)!) : '—'}</TD>
                  <TD className="text-right tabular-nums">{num(r.invoice_amount_ht) != null ? formatEuro(num(r.invoice_amount_ht)!) : '—'}</TD>
                  <TD className="text-right tabular-nums">
                    {ecart == null ? (
                      <span className="text-pr-stone">—</span>
                    ) : hasGap ? (
                      <span className="inline-flex items-center gap-1 font-bold text-pr-rust">
                        <AlertTriangle className="h-3.5 w-3.5" />{formatEuro(ecart)}
                      </span>
                    ) : (
                      <Badge tone="success">OK</Badge>
                    )}
                  </TD>
                  <TD className="text-center">
                    {r.a_pdf ? (
                      <button
                        onClick={() => void openPdf(r.invoice_pdf_url)}
                        className="inline-flex items-center gap-1 text-sm font-medium text-pr-olive hover:underline"
                      >
                        <Paperclip className="h-3.5 w-3.5" /> Ouvrir
                      </button>
                    ) : (
                      <span className="text-xs text-pr-stone">—</span>
                    )}
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      </div>
      <p className="text-xs text-pr-stone">
        {filtered.length} facture{filtered.length > 1 ? 's' : ''} · écart = montant facturé − (reçu × prix). Rouge = à traiter (litige / erreur).
      </p>
    </div>
  );
}
