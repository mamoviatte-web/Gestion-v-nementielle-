/**
 * BuvetteGroupsTab — organisation des 10 buvettes en 2 groupes (ROLE_STADE).
 * Visible uniquement sur les matchs. Gestion des membres, du responsable et
 * des codes d'accès par buvette.
 */

import { useMemo, useState } from 'react';
import { Beer, KeyRound, Settings2, X } from 'lucide-react';
import { Badge, Button, EmptyState, Input, Spinner } from '@/components/ui';
import {
  useBuvetteGroups,
  useAllBuvettes,
  useBuvetteGroupMutations,
  type BuvetteGroup,
} from '@/hooks/useBuvetteGroups';

export function BuvetteGroupsTab() {
  const groups = useBuvetteGroups();
  const [manage, setManage] = useState<BuvetteGroup | null>(null);

  if (groups.isLoading) return <Spinner label="Chargement des buvettes…" />;
  if (!groups.data || groups.data.length === 0) {
    return <EmptyState icon={Beer} title="Aucun groupe buvette" message="Les groupes Buvette 1 / Buvette 2 ne sont pas configurés." />;
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-pr-black-soft/60">
        Les 10 buvettes sont réparties en 2 groupes, chacun géré par un responsable. Déployées sur les matchs uniquement.
      </p>
      {groups.data.map((group) => (
        <GroupCard key={group.id} group={group} onManage={() => setManage(group)} />
      ))}
      {manage && <ManageGroupModal group={manage} onClose={() => setManage(null)} />}
    </div>
  );
}

function GroupCard({ group, onManage }: { group: BuvetteGroup; onManage: () => void }) {
  const { toggleMember, setResponsable, busy } = useBuvetteGroupMutations();
  const [editName, setEditName] = useState(false);
  const [name, setName] = useState(group.responsable_name ?? '');

  const activeCount = group.members.filter((m) => m.is_active).length;

  return (
    <div className="overflow-hidden rounded-xl border border-pr-stone bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-pr-stone p-4">
        <div className="flex items-center gap-3">
          <span className="h-3.5 w-3.5 shrink-0 rounded-full" style={{ background: group.color }} />
          <div>
            <p className="font-display font-black text-pr-black">
              {group.group_name}{' '}
              <span className="text-xs font-normal text-pr-black-soft/50">· {group.group_code}</span>
            </p>
            {editName ? (
              <div className="mt-1 flex items-center gap-1">
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nom responsable" className="h-7 text-xs" />
                <Button
                  size="sm"
                  loading={busy}
                  onClick={async () => {
                    await setResponsable({ groupId: group.id, name: name.trim() });
                    setEditName(false);
                  }}
                >
                  OK
                </Button>
              </div>
            ) : (
              <button className="text-xs text-pr-black-soft/60 underline decoration-dotted" onClick={() => setEditName(true)}>
                {group.responsable_name || 'Responsable non assigné'} — modifier
              </button>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone="neutral">{activeCount}/{group.members.length} actives</Badge>
          <Button variant="secondary" size="sm" onClick={onManage}>
            <Settings2 className="h-4 w-4" /> Gérer
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2">
        {group.members.map((m) => (
          <div
            key={m.id}
            className={`rounded-lg border p-3 ${m.is_active ? 'border-pr-stone bg-white' : 'border-pr-stone/50 bg-pr-stone/10 opacity-60'}`}
          >
            <div className="flex items-start justify-between gap-2">
              <span className="text-sm font-medium text-pr-black">{m.space?.space_name}</span>
              <button
                className="text-xs text-pr-black-soft/50 hover:text-pr-black"
                onClick={() => void toggleMember({ memberId: m.id, isActive: !m.is_active })}
              >
                {m.is_active ? 'Désactiver' : 'Activer'}
              </button>
            </div>
            <div className="mt-1 flex items-center gap-1 text-[11px] text-pr-olive-dark">
              <KeyRound className="h-3 w-3" /> {m.space?.access_code}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ManageGroupModal({ group, onClose }: { group: BuvetteGroup; onClose: () => void }) {
  const all = useAllBuvettes();
  const groups = useBuvetteGroups();
  const { setMembership, busy } = useBuvetteGroupMutations();

  const memberIds = useMemo(() => new Set(group.members.map((m) => m.space_id)), [group.members]);
  const otherGroupBySpace = useMemo(() => {
    const map = new Map<string, string>();
    for (const g of groups.data ?? []) {
      if (g.id === group.id) continue;
      for (const m of g.members) map.set(m.space_id, g.group_name);
    }
    return map;
  }, [groups.data, group.id]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-5 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-lg font-black text-pr-black">Gérer {group.group_name}</h2>
          <button onClick={onClose} aria-label="Fermer" className="text-pr-black-soft/40 hover:text-pr-black">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="space-y-2">
          {(all.data ?? []).map((b) => {
            const inGroup = memberIds.has(b.space_id);
            const other = otherGroupBySpace.get(b.space_id);
            return (
              <label key={b.space_id} className="flex items-center gap-3 rounded-lg border border-pr-stone p-2.5">
                <input
                  type="checkbox"
                  checked={inGroup}
                  disabled={busy}
                  onChange={(e) => void setMembership({ groupId: group.id, spaceId: b.space_id, member: e.target.checked })}
                />
                <span className="flex-1 text-sm text-pr-black">{b.space_name}</span>
                {!inGroup && other && <span className="text-[11px] text-amber-600">dans {other}</span>}
                <span className="text-[11px] text-pr-black-soft/40">{b.access_code}</span>
              </label>
            );
          })}
        </div>
        <Button fullWidth className="mt-4" onClick={onClose}>Terminé</Button>
      </div>
    </div>
  );
}
