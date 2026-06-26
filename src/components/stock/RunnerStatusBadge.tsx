import { Badge } from '@/components/ui';
import {
  RUNNER_STATUS_META,
  RUNNER_STATUS_FLOW,
} from '@/lib/labels';
import type { RunnerStatus } from '@/lib/types';

/** Statut suivant dans le cycle runner, ou null si terminal. */
export function nextRunnerStatus(status: RunnerStatus): RunnerStatus | null {
  const idx = RUNNER_STATUS_FLOW.indexOf(status);
  if (idx === -1 || idx >= RUNNER_STATUS_FLOW.length - 1) return null;
  return RUNNER_STATUS_FLOW[idx + 1];
}

interface RunnerStatusBadgeProps {
  status: RunnerStatus;
  /** Si fourni, le badge devient cliquable pour avancer au statut suivant. */
  onAdvance?: (next: RunnerStatus) => void;
  disabled?: boolean;
}

/** Badge de statut runner, cliquable pour avancer au statut suivant (admin). */
export function RunnerStatusBadge({
  status,
  onAdvance,
  disabled,
}: RunnerStatusBadgeProps) {
  const meta = RUNNER_STATUS_META[status];
  const next = nextRunnerStatus(status);

  if (!onAdvance || !next) {
    return <Badge tone={meta.tone}>{meta.label}</Badge>;
  }

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onAdvance(next)}
      title={`Avancer vers « ${RUNNER_STATUS_META[next].label} »`}
      className="cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
    >
      <Badge tone={meta.tone}>{meta.label} →</Badge>
    </button>
  );
}
