/**
 * Hooks création d'événement + pièces jointes (feuilles de route, photos).
 * Le bucket Storage `event-files` et la table event_attachments doivent être
 * provisionnés (supabase/event_attachments.sql).
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import type {
  AttachmentType,
  EventAttachment,
  EventCreationDraft,
} from '@/lib/types';

const BUCKET = 'event-files';

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80);
}

/** URL signée temporaire pour télécharger un objet privé. */
export async function getSignedUrl(path: string, expiresIn = 3600): Promise<string | null> {
  const { data } = await supabase.storage.from(BUCKET).createSignedUrl(path, expiresIn);
  return data?.signedUrl ?? null;
}

/** Liste des pièces jointes d'un événement (option : filtrer par espace/type). */
export function useAttachments(
  eventId: string | undefined,
  opts?: { spaceId?: string | null; type?: AttachmentType },
) {
  return useQuery({
    queryKey: ['attachments', eventId, opts?.spaceId ?? 'all', opts?.type ?? 'all'],
    enabled: !!eventId,
    queryFn: async (): Promise<EventAttachment[]> => {
      let q = supabase.from('event_attachments').select('*').eq('event_id', eventId);
      if (opts?.spaceId !== undefined) q = q.eq('space_id', opts.spaceId as string);
      if (opts?.type) q = q.eq('attachment_type', opts.type);
      const { data, error } = await q.order('uploaded_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as EventAttachment[];
    },
  });
}

export function useEventCreation() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const userName = user?.name ?? 'Stade';

  function invalidate(eventId?: string) {
    void queryClient.invalidateQueries({ queryKey: ['events'] });
    if (eventId) {
      void queryClient.invalidateQueries({ queryKey: ['attachments', eventId] });
      void queryClient.invalidateQueries({ queryKey: ['eventSpaces', eventId] });
    }
  }

  /** 1. Crée l'événement (+ event_spaces selon le type). */
  const createMutation = useMutation({
    mutationFn: async (draft: EventCreationDraft): Promise<{ event_id: string }> => {
      // Match : valeurs par défaut calculées côté moteur (saisie minimale).
      let startTime: string | null = draft.start_time || null;
      let attendees: number | null = draft.expected_attendees || null;
      if (draft.event_type === 'match') {
        if (!startTime) startTime = '19:00';
        if (!attendees) {
          const { data: past } = await supabase
            .from('events')
            .select('expected_attendees')
            .eq('event_type', 'match')
            .not('expected_attendees', 'is', null)
            .order('event_date', { ascending: false })
            .limit(3);
          const vals = (past ?? [])
            .map((r) => r.expected_attendees as number)
            .filter((n) => !!n);
          attendees = vals.length
            ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length)
            : 8000;
        }
      }

      const { data: ev, error } = await supabase
        .from('events')
        .insert({
          event_name: draft.event_name.trim(),
          event_type: draft.event_type,
          event_date: draft.event_date,
          start_time: startTime,
          expected_attendees: attendees,
          status: 'préparé',
        })
        .select('event_id')
        .single();
      if (error) throw error;
      const eventId = ev.event_id as string;

      let spaceIds: string[];
      if (draft.event_type === 'match') {
        // Match = tous les espaces actifs s'activent automatiquement.
        const { data: spaces, error: sErr } = await supabase
          .from('spaces')
          .select('space_id')
          .eq('active', true);
        if (sErr) throw sErr;
        spaceIds = (spaces ?? []).map((s) => s.space_id);
        // Mais on respecte d'éventuelles désélections du wizard si fournies.
        if (draft.selected_space_ids.length > 0) {
          spaceIds = spaceIds.filter((id) => draft.selected_space_ids.includes(id));
        }
      } else {
        spaceIds = draft.selected_space_ids;
      }

      if (spaceIds.length > 0) {
        const { error: esErr } = await supabase
          .from('event_spaces')
          .insert(spaceIds.map((space_id) => ({ event_id: eventId, space_id })));
        if (esErr) throw esErr;
      }
      return { event_id: eventId };
    },
    onSuccess: (res) => invalidate(res.event_id),
  });

  /** 2. Upload d'une feuille de route séminaire pour un espace. */
  const feuilleMutation = useMutation({
    mutationFn: async (vars: {
      eventId: string;
      spaceId: string | null;
      file: File;
      comment?: string;
    }) => {
      const folder = vars.spaceId ? `${vars.eventId}/${vars.spaceId}` : `${vars.eventId}/global`;
      const path = `${folder}/feuille-route-${Date.now()}-${sanitizeName(vars.file.name)}`;
      const up = await supabase.storage
        .from(BUCKET)
        .upload(path, vars.file, { upsert: true, contentType: vars.file.type });
      if (up.error) throw up.error;
      const { error } = await supabase.from('event_attachments').insert({
        event_id: vars.eventId,
        space_id: vars.spaceId,
        attachment_type: 'feuille_route_seminaire',
        file_name: vars.file.name,
        file_url: path,
        file_size_kb: Math.round(vars.file.size / 1024),
        mime_type: vars.file.type,
        uploaded_by: userName,
        comment: vars.comment ?? null,
      });
      if (error) throw error;
    },
    onSuccess: (_d, vars) => invalidate(vars.eventId),
  });

  /** 4. Upload d'une photo de débrief (ROLE_RESPONSABLE). */
  const photoMutation = useMutation({
    mutationFn: async (vars: {
      eventId: string;
      spaceId: string;
      file: File;
      respName: string;
    }) => {
      const path = `${vars.eventId}/${vars.spaceId}/debrief-photos/${Date.now()}-${sanitizeName(vars.file.name)}`;
      const upload = await supabase.storage
        .from(BUCKET)
        .upload(path, vars.file, { upsert: true, contentType: vars.file.type });
      if (upload.error) throw upload.error;
      const { error } = await supabase.from('event_attachments').insert({
        event_id: vars.eventId,
        space_id: vars.spaceId,
        attachment_type: 'rapport_photo_debrief',
        file_name: vars.file.name,
        file_url: path,
        file_size_kb: Math.round(vars.file.size / 1024),
        mime_type: vars.file.type,
        uploaded_by: vars.respName,
      });
      if (error) throw error;
      await supabase
        .from('debriefs')
        .update({ has_photo_report: true })
        .eq('event_id', vars.eventId)
        .eq('space_id', vars.spaceId);
    },
    onSuccess: (_d, vars) => invalidate(vars.eventId),
  });

  /** 5. Suppression d'une pièce jointe (admin). */
  const deleteMutation = useMutation({
    mutationFn: async (vars: { id: string; path: string; eventId: string }) => {
      await supabase.storage.from(BUCKET).remove([vars.path]);
      const { error } = await supabase.from('event_attachments').delete().eq('id', vars.id);
      if (error) throw error;
    },
    onSuccess: (_d, vars) => invalidate(vars.eventId),
  });

  return {
    createEvent: (draft: EventCreationDraft) => createMutation.mutateAsync(draft),
    uploadFeuilleRoute: (eventId: string, spaceId: string | null, file: File, comment?: string) =>
      feuilleMutation.mutateAsync({ eventId, spaceId, file, comment }),
    uploadDebriefPhoto: (eventId: string, spaceId: string, file: File, respName: string) =>
      photoMutation.mutateAsync({ eventId, spaceId, file, respName }),
    deleteAttachment: (id: string, path: string, eventId: string) =>
      deleteMutation.mutateAsync({ id, path, eventId }),
    creating: createMutation.isPending,
    uploading: feuilleMutation.isPending || photoMutation.isPending,
    deleting: deleteMutation.isPending,
  };
}
