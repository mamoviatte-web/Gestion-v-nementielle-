// read-rh-planning — proxy sécurisé : lit un planning RH prestataire (CSV extrait
// d'un Excel côté client) et renvoie les agents structurés via Claude.
// La clé Anthropic reste côté serveur (jamais dans le bundle).
//
// Accès : la responsable RH est ANONYME (session par token). La fonction est
// donc publique (--no-verify-jwt) MAIS validée : on vérifie le token RH via le
// RPC get_rh_session avant tout appel à Claude → pas de proxy Claude ouvert.
//
// Déploiement :
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
//   supabase functions deploy read-rh-planning --no-verify-jwt

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const MODEL = "claude-opus-4-8";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

async function validRhToken(token: string): Promise<boolean> {
  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !anon) return false;
  try {
    const r = await fetch(`${url}/rest/v1/rpc/get_rh_session`, {
      method: "POST",
      headers: { apikey: anon, Authorization: `Bearer ${anon}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_token: token }),
    });
    if (!r.ok) return false;
    const d = await r.json();
    return d?.success === true;
  } catch {
    return false;
  }
}

const PROMPT = (spaceList: string, csv: string) => `Tu es un assistant RH expert en lecture de planning de personnel pour un stade de rugby.

Analyse ce tableau CSV et extrais tous les agents avec leurs informations.

ESPACES DISPONIBLES DANS L'APPLICATION :
${spaceList}

FICHIER CSV À ANALYSER :
${csv.slice(0, 8000)}

Retourne UNIQUEMENT un JSON valide, sans texte autour :
{ "agents": [ { "prenom": "Marie", "nom": "DUPONT", "role": "Serveur", "space_code": "B1", "start_time": "14:00", "end_time": "23:00", "hourly_rate": 12.50, "raw_line": "ligne brute" } ] }

RÈGLES :
- NOM en MAJUSCULES, Prénom en initiale majuscule.
- space_code = le nom EXACT d'un espace de la liste (ou code buvette B1→B9). Si incertain, mets la valeur brute du fichier.
- Rôles standards : "Serveur", "Chef de rang", "Barman", "Agent de sécurité", "Runner", "Hôte / Hôtesse", "Responsable espace", "Autre".
- Heures au format HH:MM (24h).
- hourly_rate = taux horaire si présent, sinon null.
- Ignore en-têtes, totaux, notes. Première feuille uniquement.
- Réponds UNIQUEMENT avec le JSON.`;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ success: false, error: "Méthode non autorisée" }, 405);

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return json({ success: false, error: "ANTHROPIC_API_KEY non configurée." }, 500);

  let body: { csv?: string; token?: string; spaces?: { space_name?: string; service_type?: string }[] };
  try { body = await req.json(); } catch { return json({ success: false, error: "Corps invalide." }, 400); }

  const { csv, token } = body;
  if (!csv || !token) return json({ success: false, error: "csv et token requis." }, 400);
  if (!(await validRhToken(token))) return json({ success: false, error: "Session RH invalide." }, 403);

  const spaceList = (body.spaces ?? [])
    .filter((s) => s.space_name)
    .map((s) => `"${s.space_name}"${s.service_type ? ` (${s.service_type})` : ""}`)
    .join(", ");

  let resp: Response;
  try {
    resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2000,
        messages: [{ role: "user", content: PROMPT(spaceList, csv) }],
      }),
    });
  } catch (e) {
    return json({ success: false, error: `Appel Claude échoué : ${e instanceof Error ? e.message : "réseau"}` }, 502);
  }
  if (!resp.ok) return json({ success: false, error: `Claude API ${resp.status}`, detail: (await resp.text()).slice(0, 300) }, 502);

  const result = await resp.json();
  const text: string = (result.content ?? [])
    .filter((b: { type: string }) => b.type === "text")
    .map((b: { text: string }) => b.text)
    .join("");
  let parsed: { agents?: unknown };
  try {
    parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
  } catch {
    return json({ success: false, error: "Claude n'a pas renvoyé de JSON valide.", raw: text.slice(0, 300) }, 422);
  }
  return json({ success: true, agents: Array.isArray(parsed.agents) ? parsed.agents : [] });
});
