// cleanup-event-storage — supprime les fichiers Storage d'un événement effacé.
// Les LIGNES debrief_photos sont déjà purgées par le CASCADE ; cette fonction
// nettoie les BLOBS restants (bucket debrief-photos + logo client event-assets).
//
// Déploiement : supabase functions deploy cleanup-event-storage --no-verify-jwt

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

Deno.serve(async (req: Request) => {
  const { event_id, storage_paths } = await req.json();

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let deleted = 0;
  let error: string | undefined;

  if (Array.isArray(storage_paths) && storage_paths.length > 0) {
    const { data, error: e } = await supabase.storage
      .from("debrief-photos")
      .remove(storage_paths);
    deleted = data?.length ?? 0;
    error = e?.message;
  }

  // Nettoyage du dossier logos du client (best-effort).
  if (event_id) {
    const { data: logos } = await supabase.storage
      .from("event-assets")
      .list(`logos/${event_id}`);
    if (logos && logos.length > 0) {
      await supabase.storage
        .from("event-assets")
        .remove(logos.map((f) => `logos/${event_id}/${f.name}`));
    }
  }

  return new Response(
    JSON.stringify({ success: !error, deleted, error }),
    { headers: { "Content-Type": "application/json" } },
  );
});
