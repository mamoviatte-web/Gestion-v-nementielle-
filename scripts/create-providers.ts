/**
 * scripts/create-providers.ts
 *
 * Crée (idempotemment) les 16 comptes d'authentification Responsable dans
 * Supabase Auth, un par espace :
 *   email    = {code}@stade.fr        (ex: SN2026@stade.fr)
 *   password = {code}                 (ex: SN2026)
 *   metadata = { role, space_id, name }
 *
 * ⚠ Utilise la SERVICE_ROLE key (jamais la clé anon, jamais commitée).
 *   Renseigner les variables d'environnement puis exécuter :
 *
 *     SUPABASE_URL="https://xxxx.supabase.co" \
 *     SUPABASE_SERVICE_ROLE_KEY="..." \
 *     npx tsx scripts/create-providers.ts
 *
 * Ce script NE DOIT PAS être commité avec une clé en dur.
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(
    'Variables manquantes : définir SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY.',
  );
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

interface SpaceRow {
  space_id: string;
  access_code: string;
  space_name: string;
}

async function main() {
  const { data: spaces, error } = await admin
    .from('spaces')
    .select('space_id, access_code, space_name')
    .order('access_code', { ascending: true });

  if (error) {
    console.error('Lecture des espaces impossible :', error.message);
    process.exit(1);
  }

  let created = 0;
  let skipped = 0;

  for (const space of (spaces ?? []) as SpaceRow[]) {
    const email = `${space.access_code}@stade.fr`;
    const password = space.access_code;

    const { error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        role: 'ROLE_RESPONSABLE',
        space_id: space.space_id,
        space_code: space.access_code,
        name: space.space_name,
      },
    });

    if (createError) {
      // Compte déjà existant → on ignore.
      if (/already|registered|exists/i.test(createError.message)) {
        skipped += 1;
        console.log(`• ${email} — déjà présent, ignoré.`);
      } else {
        console.error(`✗ ${email} — ${createError.message}`);
      }
    } else {
      created += 1;
      console.log(`✓ ${email} — créé.`);
    }
  }

  console.log(`\nTerminé : ${created} créé(s), ${skipped} ignoré(s).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
