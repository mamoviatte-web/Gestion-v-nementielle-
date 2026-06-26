import { DEBRIEF_SECTIONS } from '@/lib/debriefForm';
import type { Debrief } from '@/lib/types';

/** Affichage lecture seule d'un débrief soumis (provider recap + admin détail). */
export function DebriefReadonly({ debrief }: { debrief: Debrief }) {
  return (
    <div className="space-y-5">
      {DEBRIEF_SECTIONS.map((section) => (
        <section key={section.title}>
          <h3 className="mb-2 text-sm font-semibold text-provence">
            {section.title}
          </h3>
          <dl className="space-y-1.5 rounded-lg bg-white p-3 ring-1 ring-slate-200">
            {section.fields.map((field) => {
              const raw = debrief[field.key];
              let value: string;
              if (field.type === 'checkbox') value = raw ? 'Oui' : 'Non';
              else if (raw === null || raw === undefined || raw === '') value = '—';
              else value = String(raw);
              return (
                <div
                  key={field.key}
                  className="flex flex-col gap-0.5 sm:flex-row sm:justify-between sm:gap-4"
                >
                  <dt className="text-sm text-slate-500">{field.label}</dt>
                  <dd className="text-sm font-medium text-slate-900 sm:text-right">
                    {value}
                  </dd>
                </div>
              );
            })}
          </dl>
        </section>
      ))}
    </div>
  );
}
