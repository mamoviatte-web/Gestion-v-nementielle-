/**
 * BillingChip — pastille de facturation d'un agent : « 16,5 €/h » (horaire) ou
 * « Forfait 120 € » (badge violet #7C3AED).
 */

export function BillingChip({ mode, taux, forfait }: { mode?: string; taux: number; forfait?: number | null }) {
  if (mode === 'forfait') {
    return (
      <span className="rounded-md bg-[#7C3AED]/10 px-1.5 py-0.5 text-[10px] font-bold text-[#7C3AED]">
        Forfait {Math.round(forfait ?? 0)} €
      </span>
    );
  }
  return (
    <span className="rounded-md bg-stone-100 px-1.5 py-0.5 text-[10px] font-semibold text-stone-500">
      {taux.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} €/h
    </span>
  );
}
