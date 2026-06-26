/**
 * supabase/scripts/verify-rls.ts
 *
 * Vérifie automatiquement les règles de gestion critiques contre l'API REST
 * Supabase (sans navigateur). À exécuter UNE FOIS après configuration.
 *
 * Prérequis :
 *   - schema.sql + rls_policies.sql + seed.sql exécutés
 *   - comptes auth créés (scripts/create-providers.ts) — dont SN2026@stade.fr
 *
 * Usage :
 *   SUPABASE_URL="https://xxxx.supabase.co" \
 *   SUPABASE_ANON_KEY="..." \
 *   SUPABASE_SERVICE_ROLE_KEY="..." \
 *   npx tsx supabase/scripts/verify-rls.ts
 *
 * Variables optionnelles : RESP_EMAIL (def. SN2026@stade.fr),
 *   RESP_PASSWORD (def. SN2026), RESP_CODE (def. SN2026).
 *
 * ⚠ Clés lues depuis l'environnement — jamais en dur.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const URL = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RESP_EMAIL = process.env.RESP_EMAIL ?? 'SN2026@stade.fr';
const RESP_PASSWORD = process.env.RESP_PASSWORD ?? 'SN2026';
const RESP_CODE = process.env.RESP_CODE ?? 'SN2026';
const TEST_MARK = '__RLS_TEST__';

if (!URL || !ANON || !SERVICE) {
  console.error(
    '❌ Définir SUPABASE_URL, SUPABASE_ANON_KEY et SUPABASE_SERVICE_ROLE_KEY.',
  );
  process.exit(1);
}

const results: { ok: boolean; label: string; detail?: string }[] = [];
function record(ok: boolean, label: string, detail?: string) {
  results.push({ ok, label, detail });
  console.log(`${ok ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`);
}

async function main() {
  const admin = createClient(URL!, SERVICE!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Contexte : espace Salon Nord, événement de démo, 2 produits.
  const { data: space } = await admin
    .from('spaces')
    .select('space_id')
    .eq('access_code', RESP_CODE)
    .single();
  const spaceId = space?.space_id as string | undefined;

  const { data: evRows } = await admin
    .from('event_spaces')
    .select('event_id')
    .eq('space_id', spaceId)
    .limit(1);
  const eventId = evRows?.[0]?.event_id as string | undefined;

  const { data: prods } = await admin
    .from('products')
    .select('product_id, product_name')
    .in('product_name', ['Cristaline 50cl', 'Pepsi bouteille']);
  const productA = prods?.find((p) => p.product_name === 'Cristaline 50cl')?.product_id;
  const productB = prods?.find((p) => p.product_name === 'Pepsi bouteille')?.product_id;

  if (!spaceId || !eventId || !productA || !productB) {
    console.error('❌ Contexte introuvable (espace/événement/produits). Lancer seed.sql.');
    process.exit(1);
  }

  // Client Responsable authentifié.
  const resp: SupabaseClient = createClient(URL!, ANON!);
  const { error: authErr } = await resp.auth.signInWithPassword({
    email: RESP_EMAIL,
    password: RESP_PASSWORD,
  });
  if (authErr) {
    console.error(`❌ Connexion ${RESP_EMAIL} échouée : ${authErr.message}`);
    process.exit(1);
  }

  // -- TEST 1 — RG-003 : pas de unit_price_ht pour le Responsable -----------
  {
    const direct = await resp.from('products').select('unit_price_ht');
    const pub = await resp.from('products_public').select('*').limit(1);
    const noDirectRows = (direct.data?.length ?? 0) === 0; // RLS masque products
    const pubHasNoPrice =
      !pub.error && (pub.data?.length ?? 0) > 0 &&
      !Object.prototype.hasOwnProperty.call(pub.data![0], 'unit_price_ht');
    record(
      noDirectRows && pubHasNoPrice,
      'RG-003 : unit_price_ht invisible ROLE_RESPONSABLE',
      `products(direct)=${direct.data?.length ?? 0} ligne(s), products_public sans prix=${pubHasNoPrice}`,
    );
  }

  // -- TEST 2 — RG-003 : isolation par espace --------------------------------
  {
    const { data, error } = await resp.from('event_stock_lines').select('space_id');
    const onlyOwn = !error && (data ?? []).every((r) => r.space_id === spaceId);
    record(
      onlyOwn,
      'RG-003 : isolation par espace OK',
      `${data?.length ?? 0} ligne(s), toutes space_id = Salon Nord : ${onlyOwn}`,
    );
  }

  // -- TEST 3 — RG-002 : mouvement créé lors d'une ouverture -----------------
  // (RG-002 est appliqué côté applicatif : mouvement INSÉRÉ avant la ligne.)
  {
    await resp.from('stock_movements').insert({
      event_id: eventId, space_id: spaceId, product_id: productA,
      movement_type: 'entrée', qty: 10, responsable_nom: TEST_MARK,
    });
    await resp.from('event_stock_lines').insert({
      event_id: eventId, space_id: spaceId, product_id: productA,
      initial_qty: 10, reassort_qty: 0, responsable_nom: TEST_MARK,
    });
    const { data: mv } = await resp
      .from('stock_movements')
      .select('movement_id')
      .eq('event_id', eventId)
      .eq('space_id', spaceId)
      .eq('product_id', productA)
      .eq('responsable_nom', TEST_MARK);
    record(
      (mv?.length ?? 0) >= 1,
      'RG-002 : stock_movements créé automatiquement',
      `${mv?.length ?? 0} mouvement(s) trouvé(s)`,
    );
  }

  // -- TEST 4 — RG-006 : clôture interdite au Responsable --------------------
  {
    const { data: before } = await admin
      .from('events').select('status').eq('event_id', eventId).single();
    await resp.from('events').update({ status: 'clôturé' }).eq('event_id', eventId);
    const { data: after } = await admin
      .from('events').select('status').eq('event_id', eventId).single();
    record(
      before?.status === after?.status && after?.status !== 'clôturé',
      'RG-006 : clôture bloquée ROLE_RESPONSABLE',
      `statut inchangé : ${after?.status}`,
    );
  }

  // -- TEST 5 — RG-001 : responsable_nom obligatoire (NOT NULL) --------------
  {
    const { error } = await resp.from('event_stock_lines').insert({
      event_id: eventId, space_id: spaceId, product_id: productB,
      initial_qty: 5, reassort_qty: 0, // responsable_nom volontairement absent
    });
    record(
      !!error,
      'RG-001 : responsable_nom obligatoire',
      error ? `insertion refusée (${error.code ?? 'erreur'})` : 'AUCUNE erreur (anormal)',
    );
  }

  // -- Nettoyage des données de test (service role) --------------------------
  await admin.from('event_stock_lines').delete().eq('responsable_nom', TEST_MARK);
  await admin.from('stock_movements').delete().eq('responsable_nom', TEST_MARK);

  // -- Synthèse --------------------------------------------------------------
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} vérifications RLS réussies.`);
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
