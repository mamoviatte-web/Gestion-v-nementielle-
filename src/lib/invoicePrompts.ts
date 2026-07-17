/**
 * invoicePrompts — contexte produits pour la lecture de factures par IA.
 * ⚠ La source de vérité du prompt d'extraction est la fonction edge
 * `supabase/functions/read-invoice/index.ts` (exécutée côté serveur avec la
 * clé Anthropic). Ce fichier documente le contexte métier partagé.
 */

export const INVOICE_PRODUCT_CONTEXT = `
Produits typiques du stade (Stade Maurice-David, Provence Rugby) :
- Bières : Fût BUD, Fût LEFFE, bières bouteille/canette
- Champagnes : MUMM Cordon Rouge, MUMM Blanc de Blanc
- Vins : Rosé Miraval, Rosé Pey Blanc, Rosé Réal
- Softs : Pepsi, Cristaline, San Pellegrino, Perrier, Schweppes, jus de fruits
- Spiritueux : Ricard, Lillet Blanc, Lillet Rosé, GET 27, Whisky Jameson
- Sirops : grenadine, menthe, pêche, citron

Unités : fut (fût pression), btl (bouteille), crt (carton), u (unité), kg, L.
`.trim();
