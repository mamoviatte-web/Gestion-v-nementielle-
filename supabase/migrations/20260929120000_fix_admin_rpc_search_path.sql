-- =====================================================================
-- FIX — création / réinitialisation de compte cassées (Gestion des accès)
-- ---------------------------------------------------------------------
-- SYMPTÔME (UI) : « Échec : function is_stade() does not exist » au clic sur
--   « Créer le compte » (et en réinitialisation de mot de passe).
--
-- CAUSE : admin_create_user et admin_reset_password déclaraient
--   `SET search_path TO 'public, extensions'` — les DEUX schémas dans UNE seule
--   paire de guillemets. Postgres l'interprète comme un UNIQUE schéma nommé
--   littéralement « public, extensions » (inexistant). Résultat : `public`
--   n'est pas dans le search_path effectif → l'appel non qualifié `is_stade()`
--   (défini dans public) est introuvable → la RPC échoue dès la 1re ligne.
--   (admin_set_user_active était correct — `search_path=public` — d'où
--   l'activation/désactivation qui fonctionnait.)
--
-- CORRECTIF : reposer un search_path VALIDE (liste de deux schémas). ALTER
--   FUNCTION ne touche QUE la config, pas le corps → zéro risque de régression
--   fonctionnelle. `extensions` est conservé (crypt/gen_salt y vivent, même
--   si déjà qualifiés) ; `public` rétabli pour is_stade / gen_random_uuid /
--   public.users.
-- =====================================================================

alter function public.admin_create_user(p_email text, p_password text, p_role text, p_name text)
  set search_path to public, extensions;

alter function public.admin_reset_password(p_email text, p_password text)
  set search_path to public, extensions;

-- VÉRIFICATION :
--   select proname, proconfig from pg_proc
--    where proname in ('admin_create_user','admin_reset_password');
--   -- attendu : search_path=public, extensions   (deux schémas, plus de guillemets)
-- =====================================================================
