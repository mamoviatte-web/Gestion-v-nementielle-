-- Sécurité (défense en profondeur) : les fonctions d'administration des comptes
-- (création d'utilisateur avec rôle arbitraire, réinitialisation de mot de passe,
-- activation) sont déjà gardées par is_stade() dans leur corps, mais restaient
-- exécutables par anon. On retire ce droit ; seules les sessions authentifiées
-- ROLE_STADE (via le garde) peuvent les appeler.

REVOKE EXECUTE ON FUNCTION admin_create_user(text, text, text, text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION admin_reset_password(text, text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION admin_set_user_active(text, boolean) FROM anon, public;
