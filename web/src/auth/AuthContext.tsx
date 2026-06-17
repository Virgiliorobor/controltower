// Auth context: resolves the current session via GET /api/v1/me (httpOnly cookie carries it — no token in JS).
// Exposes the PublicUser + role + login/logout. Role drives the chrome (D0-7 / DC-8): VIEWER sees no authoring
// affordances at all (omitted, not disabled). The three role flags below are what every view reads.

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { authApi } from '../lib/endpoints';
import { ApiRequestError } from '../lib/api';
import type { PublicUser, UserRole } from '../lib/types';

interface AuthValue {
  user: PublicUser | null;
  role: UserRole | null;
  loading: boolean;
  isEditor: boolean; // editor OR admin → can author
  isAdmin: boolean;
  login: (email: string, password: string) => Promise<PublicUser>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const { user: me } = await authApi.me();
      setUser(me);
    } catch (error) {
      // 401 → not authenticated; anything else → also treat as logged out (the login screen will show).
      if (!(error instanceof ApiRequestError)) {
        // network error — surface as logged out so the app does not hang on a spinner forever.
      }
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(async (email: string, password: string) => {
    const { user: u } = await authApi.login(email, password);
    setUser(u);
    return u;
  }, []);

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } finally {
      setUser(null);
    }
  }, []);

  const value = useMemo<AuthValue>(
    () => ({
      user,
      role: user?.role ?? null,
      loading,
      isEditor: user?.role === 'editor' || user?.role === 'admin',
      isAdmin: user?.role === 'admin',
      login,
      logout,
      refresh,
    }),
    [user, loading, login, logout, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
