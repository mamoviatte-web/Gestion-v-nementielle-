// read-invoice — proxy sécurisé de lecture de facture/BL par Claude.
// Le frontend NE DOIT JAMAIS appeler l'API Anthropic directement (clé exposée
// dans le bundle + CORS + pas d'auth). Cette fonction détient la clé côté
// serveur (secret) et n'est appelable que par un utilisateur authentifié.
//
// Déploiement :
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
//   supabase functions deploy read-invoice
//
// Modèle : claude-opus-4-8 (le plus capable — meilleure lecture de scans/BL
// manuscrits). Basculer sur claude-sonnet-5 ou claude-haiku-4-5 pour réduire
// le coût si le volume l'exige.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const MODEL = "claude-opus-4-8";
const ANTHROPIC_VERSION = "2023-06-01";
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

const EXTRACTION_PROMPT = (today: string) => `Tu es un expert en lecture de factures et bons de livraison pour un stade de rugby (Stade Maurice-David, Aix-en-Provence) : boissons et produits F&B.

Produits typiques : Fût BUD/LEFFE, bières bouteille/canette, MUMM Cordon Rouge/Blanc de Blanc, Champagnes, Rosé Miraval/Pey Blanc/Réal, Pepsi, Cristaline, San Pellegrino, Perrier, Schweppes, jus de fruits, sirops (grenadine/menthe/pêche/citron), Ricard, Lillet Blanc/Rosé, GET 27, Whisky Jameson.

Analyse ce document et renvoie UNIQUEMENT du JSON valide (aucun texte avant/après) :
{
  "supplier": "Nom du fournisseur ou distributeur",
  "delivery_date": "YYYY-MM-DD (date du document)",
  "invoice_number": "numéro de facture ou BL, ou null",
  "products": [
    { "raw_name": "Nom EXACT du produit tel qu'écrit", "qty": 24, "unit": "btl", "price_ht": 2.50 }
  ],
  "total_ht": 540.00
}

Format fréquent — facture d'accise (ex. « MONTANER PIETRINI », Document Commercial
Simplifié d'Accompagnement). Les colonnes typiques sont, de gauche à droite :
CODE | QUANTITE (2 sous-colonnes : « cas/fut » puis « Col/Pack ») | DESIGNATION |
CONT.UNITE | DEGRE | Tarif PU HT | REMISE | TVA | PU NET HT | ACCISE | MONT. HT DS INCLUS | CONSIGNATION | POIDS.

Règles de lecture des LIGNES :
- qty = la 1re sous-colonne de QUANTITE (« cas/fut ») = NOMBRE d'unités physiques
  reçues (nombre de fûts, de cartons/colis). N'utilise JAMAIS la colonne des litres
  ni « Col/Pack » comme quantité. Ex. « 56  1680  FUT BUD 30 L » → qty = 56 fûts.
- Fûts : « FUT 20L/30L <MARQUE> » → unit = "fut", qty = nombre de fûts.
- price_ht = prix unitaire HT par unité reçue = (MONT. HT DS INCLUS) ÷ qty
  (montant HT de la ligne, accise comprise, divisé par la quantité). N'utilise pas
  « PU NET HT » seul pour les fûts : il est exprimé PAR LITRE, pas par fût.
- EXCLURE totalement (ce ne sont pas des produits) toute ligne de :
  consignation, déconsignation, « VIDE-PALETTE », « VIDE-GAZ », « REPRISE DE VIDE »,
  « EMBALLAGE », « SURCOUT », « FRAIS », « RUPTURE », ou tout montant NÉGATIF (avoir/reprise).
- Ignore les répétitions liées au « DUPLICATA » et aux pages : chaque produit une seule fois.

Règles générales :
- Information absente → null.
- Bières : distingue fût (barrique) / bouteille / canette.
- Unités : btl (bouteille), fut (fût), crt (carton), u (unité), kg, L.
- Prix TOUJOURS en € HT (hors TVA).
- total_ht = TOTAL NET À PAYER HT si présent, sinon la somme des montants HT des produits.
- Date illisible → utilise ${today}.
- raw_name = nom EXACT sur le document.
- Réponds UNIQUEMENT avec le JSON.`;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ success: false, error: "Méthode non autorisée" }, 405);

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return json({ success: false, error: "ANTHROPIC_API_KEY non configurée côté serveur." }, 500);

  let payload: { media_type?: string; data?: string; today?: string };
  try {
    payload = await req.json();
  } catch {
    return json({ success: false, error: "Corps de requête invalide." }, 400);
  }

  const { media_type, data } = payload;
  const today = payload.today ?? new Date().toISOString().slice(0, 10);
  if (!media_type || !data) return json({ success: false, error: "Fichier manquant." }, 400);

  const isImage = IMAGE_TYPES.includes(media_type);
  const isPdf = media_type === "application/pdf";
  if (!isImage && !isPdf) {
    return json({ success: false, error: "Format non supporté (JPG, PNG, WEBP, GIF ou PDF)." }, 400);
  }

  const source = { type: "base64", media_type, data };
  const docBlock = isImage
    ? { type: "image", source }
    : { type: "document", source };

  let anthropicResp: Response;
  try {
    anthropicResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2000,
        messages: [
          {
            role: "user",
            content: [docBlock, { type: "text", text: EXTRACTION_PROMPT(today) }],
          },
        ],
      }),
    });
  } catch (e) {
    return json({ success: false, error: `Appel Claude échoué : ${e instanceof Error ? e.message : "réseau"}` }, 502);
  }

  if (!anthropicResp.ok) {
    const detail = await anthropicResp.text();
    return json({ success: false, error: `Claude API ${anthropicResp.status}`, detail: detail.slice(0, 300) }, 502);
  }

  const result = await anthropicResp.json();
  const text: string = (result.content ?? [])
    .filter((b: { type: string }) => b.type === "text")
    .map((b: { text: string }) => b.text)
    .join("");

  let parsed: unknown;
  try {
    const clean = text.replace(/```json|```/g, "").trim();
    parsed = JSON.parse(clean);
  } catch {
    return json({ success: false, error: "Claude n'a pas renvoyé de JSON valide.", raw: text.slice(0, 300) }, 422);
  }

  return json({ success: true, invoice: parsed });
});
