/**
 * supabase/scripts/check-connection.ts
 *
 * Vérifie la connexion Supabase (sans navigateur) et le contenu des
 * référentiels. Lit les clés depuis l'environnement — jamais en dur.
 *
 * ⚠ Les tables de référence sont protégées par RLS (lecture réservée aux
 *   rôles authentifiés). Fournir un compte ROLE_STADE pour obtenir les
 *   vrais comptages ; sans authentification, la RLS renvoie 0 ligne.
 *
 * Usage :
 *   SUPABASE_URL="https://xxxx.supabase.co" \
 *   SUPABASE_ANON_KEY="..." \
 *   STADE_EMAIL="mviatte@provencerugby.com" STADE_PASSWORD="StadeMD2026!" \
 *   npx tsx supabase/scripts/check-connection.ts
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('❌ Définir SUPABASE_URL et SUPABASE_ANON_KEY.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function checkConnection() {
  // Authentification ROLE_STADE (sinon la RLS masque les référentiels).
  if (process.env.STADE_EMAIL && process.env.STADE_PASSWORD) {
    const { error: authErr } = await supabase.auth.signInWithPassword({
      email: process.env.STADE_EMAIL,
      password: process.env.STADE_PASSWORD,
    });
    if (authErr) {
      console.error('❌ Authentification ROLE_STADE échouée :', authErr.message);
      process.exit(1);
    }
    console.log('✅ Authentifié en ROLE_STADE');
  } else {
    console.warn(
      'ℹ️  Pas de compte ROLE_STADE fourni — la RLS peut renvoyer 0 ligne.',
    );
  }

  // Test 1 — connexion + espaces
  const { data: spaces, error } = await supabase
    .from('spaces')
    .select('space_name, access_code')
    .order('space_name');

  if (error) {
    console.error('❌ Connexion Supabase échouée :', error.message);
    process.exit(1);
  }

  console.log('✅ Connexion Supabase OK');
  console.log(`✅ ${spaces.length} espaces trouvés (attendu : 16)`);
  if (spaces.length !== 16) {
    console.error("❌ Nombre d'espaces incorrect — relancer seed.sql");
  }

  // Test 2 — produits
  const { data: products, error: pErr } = await supabase
    .from('products')
    .select('product_name, unit_price_ht');

  if (pErr) {
    console.error('❌ Lecture des produits échouée :', pErr.message);
    process.exit(1);
  }

  console.log(`✅ ${products?.length ?? 0} produits trouvés (attendu : 25)`);
  const withoutPrice = (products ?? []).filter((p) => p.unit_price_ht == null);
  console.log(`ℹ️  ${withoutPrice.length} produits sans prix HT (Matériel — normal)`);
}

checkConnection().catch((e) => {
  console.error(e);
  process.exit(1);
});
