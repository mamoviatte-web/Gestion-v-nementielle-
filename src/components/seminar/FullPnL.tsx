/**
 * FullPnL — compte de résultat d'un événement (ROLE_STADE) :
 * CA − (F&B + RH + charges externes) = gain net, marge, coût/pax.
 */

interface PnLProps {
  caHT: number;
  fbCostHT: number;
  rhCostHT: number;
  externalCostHT: number;
  pax: number;
}

function euro(v: number): string {
  return `${v >= 0 ? '' : '− '}${Math.abs(v).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} € HT`;
}

function Row({ label, value, sub, bold, color }: { label: string; value: number; sub?: string; bold?: boolean; color?: string }) {
  return (
    <div className="flex items-center justify-between border-b border-stone-100 py-2.5 last:border-0">
      <div>
        <p className={`text-sm ${bold ? 'font-bold text-stone-900' : 'text-stone-600'}`}>{label}</p>
        {sub && <p className="text-xs text-stone-400">{sub}</p>}
      </div>
      <span className={`font-bold tabular-nums ${bold ? 'text-lg' : 'text-sm'} ${color ?? 'text-stone-800'}`}>{euro(value)}</span>
    </div>
  );
}

export function FullPnL({ caHT, fbCostHT, rhCostHT, externalCostHT, pax }: PnLProps) {
  const totalCharges = fbCostHT + rhCostHT + externalCostHT;
  const gainNet = caHT - totalCharges;
  const marge = caHT > 0 ? (gainNet / caHT) * 100 : 0;
  const costPerPax = pax > 0 ? totalCharges / pax : 0;

  return (
    <div className="overflow-hidden rounded-2xl border border-stone-200 bg-white">
      <div className="bg-stone-900 px-5 py-3 text-white">
        <p className="text-xs font-bold uppercase tracking-widest opacity-60">Compte de résultat événement</p>
      </div>

      <div className="px-5 py-1">
        <Row label="Chiffre d'affaires HT" value={caHT} color="text-green-700" bold />

        <div className="py-2">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-stone-400">Charges</p>
          <div className="border-l-2 border-stone-200 pl-3">
            <Row label="Coût F&B consommé" value={-fbCostHT} sub="Consommations boissons & matériel" color="text-red-600" />
            <Row label="Charges RH" value={-rhCostHT} sub="Heures régisseur et staff" color="text-red-600" />
            <Row label="Charges externes" value={-externalCostHT} sub="Traiteur, sécurité, technique…" color="text-red-600" />
          </div>
        </div>

        <div className="my-1 border-t-2 border-stone-900" />
        <Row label="Coût total" value={-totalCharges} color="text-red-700" bold />
        <Row label="Gain net HT" value={gainNet} color={gainNet >= 0 ? 'text-green-700' : 'text-red-700'} bold />
      </div>

      <div className="grid grid-cols-3 divide-x divide-stone-200 border-t border-stone-200">
        <div className="py-3 text-center">
          <p className="text-xs text-stone-400">Marge</p>
          <p className={`text-lg font-bold ${marge >= 50 ? 'text-green-600' : marge >= 20 ? 'text-amber-600' : 'text-red-600'}`}>
            {marge.toFixed(1)} %
          </p>
        </div>
        <div className="py-3 text-center">
          <p className="text-xs text-stone-400">Coût / pax</p>
          <p className="text-lg font-bold text-stone-800">{costPerPax.toFixed(2)} €</p>
        </div>
        <div className="py-3 text-center">
          <p className="text-xs text-stone-400">PAX</p>
          <p className="text-lg font-bold text-stone-800">{pax}</p>
        </div>
      </div>
    </div>
  );
}
