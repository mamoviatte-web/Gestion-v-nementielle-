import { useId } from 'react';
import {
  Area,
  Line,
  CartesianGrid,
  ComposedChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

/**
 * TrendChart — courbe de tendance homogène (palette Provence).
 * Une seule série « réelle » (olive, aire dégradée + trait), plus une série
 * de référence optionnelle (« prévu ») en pointillé neutre — jamais de
 * multi-séries chromatiques (identité de marque volontairement monochrome).
 * Axes discrets (stone), texte en encre atténuée, tooltip carte blanche.
 */
export interface TrendPoint {
  label: string;
  value: number;
  ref?: number | null;
}

const OLIVE = '#6B7548';
const STONE = '#E8E4DA';
const INK = '#1A1A1A';

/** Format compact pour les graduations d'axe (évite les libellés tronqués). */
function compact(v: number): string {
  const a = Math.abs(v);
  if (a >= 1000) return `${Math.round(v / 100) / 10}k`.replace('.', ',');
  return String(Math.round(v));
}

export function TrendChart({
  data,
  height = 200,
  format = (v) => String(v),
  yTickFormat = compact,
  valueLabel = 'Valeur',
  refLabel = 'Référence',
}: {
  data: TrendPoint[];
  height?: number;
  format?: (v: number) => string;
  yTickFormat?: (v: number) => string;
  valueLabel?: string;
  refLabel?: string;
}) {
  const gid = useId().replace(/:/g, '');
  const hasRef = data.some((d) => d.ref != null);

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center rounded-xl bg-pr-cream/50 text-sm text-pr-black-soft/40" style={{ height }}>
        Pas encore de données.
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
        <defs>
          <linearGradient id={`grad-${gid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={OLIVE} stopOpacity={0.22} />
            <stop offset="100%" stopColor={OLIVE} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke={STONE} strokeDasharray="0" />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 11, fill: INK, fillOpacity: 0.5 }}
          tickLine={false}
          axisLine={{ stroke: STONE }}
          interval="preserveStartEnd"
        />
        <YAxis
          width={40}
          tick={{ fontSize: 11, fill: INK, fillOpacity: 0.45 }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v) => yTickFormat(Number(v))}
        />
        <Tooltip
          cursor={{ stroke: STONE, strokeWidth: 1 }}
          contentStyle={{
            borderRadius: 12, border: `1px solid ${STONE}`, background: '#fff',
            boxShadow: '0 4px 16px rgba(0,0,0,0.06)', fontSize: 12, padding: '8px 10px',
          }}
          labelStyle={{ color: INK, fontWeight: 700, marginBottom: 2 }}
          formatter={(v, name) => [format(Number(v)), name === 'ref' ? refLabel : valueLabel]}
        />
        <Area
          type="monotone" dataKey="value" name={valueLabel}
          stroke={OLIVE} strokeWidth={2} fill={`url(#grad-${gid})`}
          dot={false} activeDot={{ r: 4, fill: OLIVE, stroke: '#fff', strokeWidth: 2 }}
        />
        {hasRef && (
          <Line
            type="monotone" dataKey="ref" name="ref"
            stroke={INK} strokeOpacity={0.35} strokeWidth={1.5} strokeDasharray="4 4"
            dot={false} activeDot={{ r: 3, fill: INK, fillOpacity: 0.5 }}
          />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  );
}
