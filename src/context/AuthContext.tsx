/**
 * AuthContext — Stade Maurice David (CDC V1.1)
 *
 * Gère la session Supabase, le rôle applicatif et le nom du responsable
 * saisi à la connexion (RG-001, stocké en sessionStorage).
 */

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from 'react';
import { supabase, getCurrentUser, type SupabaseUser } from '@/lib/supabase';

/** Clé de stockage du nom du responsable (RG-001). */
const RESPONSABLE_NAME_KEY = 'smd.responsable_name';

interface AuthContextValue {
  user: SupabaseUser | null;
  loading: boolean;
  error: string | null;
  /** Nom du responsable saisi pour la session courante (RG-001). */
  responsableName: string | null;
  /** Connexion email + mot de passe. */
  login: (email: string, password: string) => Promise<SupabaseUser | null>;
  /** Déconnexion. */
  logout: () => Promise<void>;
  /** Recharge l'utilisateur depuis la session Supabase. */
  refreshUser: () => Promise<void>;
  /** Mémorise le nom du responsable (RG-001). */
  setResponsableName: (name: string) => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SupabaseUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [responsableName, setResponsableNameState] = useState<string | null>(
    () => sessionStorage.getItem(RESPONSABLE_NAME_KEY),
  );

  const refreshUser = useCallback(async () => {
    const current = await getCurrentUser();
    setUser(current);
  }, []);

  const login = useCallback(
    async (email: string, password: string): Promise<SupabaseUser | null> => {
      setError(null);
      setLoading(true);
      try {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (signInError) {
          setError(signInError.message);
          return null;
        }
        const current = await getCurrentUser();
        setUser(current);
        return current;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Erreur de connexion');
        return null;
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const logout = useCallback(async () => {
    await supabase.auth.signOut();
    sessionStorage.removeItem(RESPONSABLE_NAME_KEY);
    setResponsableNameState(null);
    setUser(null);
  }, []);

  const setResponsableName = useCallback((name: string) => {
    sessionStorage.setItem(RESPONSABLE_NAME_KEY, name);
    setResponsableNameState(name);
  }, []);

  // Écoute les changements de session Supabase.
  useEffect(() => {
    let active = true;

    refreshUser().finally(() => {
      if (active) setLoading(false);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (!active) return;
        if (session) {
          void refreshUser();
        } else {
          setUser(null);
        }
      },
    );

    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, [refreshUser]);

  const value: AuthContextValue = {
    user,
    loading,
    error,
    responsableName,
    login,
    logout,
    refreshUser,
    setResponsableName,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** Hook d'accès au contexte d'authentification. */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth doit être utilisé dans un <AuthProvider>.');
  }
  return ctx;
}
