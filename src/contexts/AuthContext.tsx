import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { getSupabaseClient, getSupabaseCredentials } from '../lib/supabase';

export interface AuthProfile {
  id: string;
  full_name: string;
  role: string;
  is_active: boolean;
}

type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated' | 'configuration_error';

interface AuthResult {
  ok: boolean;
  errorFa?: string;
}

interface AuthContextValue {
  status: AuthStatus;
  profile: AuthProfile | null;
  signIn: (username: string, password: string) => Promise<AuthResult>;
  signOut: () => Promise<void>;
  bootstrapAdmin: (input: {
    username: string;
    password: string;
    fullName: string;
    bootstrapCode: string;
  }) => Promise<AuthResult>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function usernameToEmail(username: string): string {
  return `${username.trim().toLowerCase()}@farzam.local`;
}

export function getRoleLabel(role: string): string {
  switch (role) {
    case 'ADMIN':
      return 'مدیر سامانه';
    case 'SENIOR_ACCOUNTANT':
      return 'مدیر مالی ارشد';
    case 'ACCOUNTANT':
      return 'حسابدار';
    case 'AUDITOR':
      return 'ناظر';
    case 'AI_AGENT':
      return 'عامل هوشمند';
    default:
      return 'کاربر سازمانی';
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [profile, setProfile] = useState<AuthProfile | null>(null);

  useEffect(() => {
    const client = getSupabaseClient();
    if (!client) {
      setStatus('configuration_error');
      return;
    }

    let mounted = true;
    const { data: authListener } = client.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT' && mounted) {
        setProfile(null);
        setStatus('unauthenticated');
      }
    });

    const restoreSession = async () => {
      try {
        const { data, error } = await client.auth.getSession();
        if (!mounted) return;
        if (error || !data.session) {
          setProfile(null);
          setStatus('unauthenticated');
          return;
        }

        const { data: userProfile, error: profileError } = await client
          .from('user_profiles')
          .select('id,full_name,role,is_active')
          .eq('id', data.session.user.id)
          .maybeSingle();

        if (!mounted) return;
        if (profileError || !userProfile || userProfile.is_active !== true) {
          await client.auth.signOut();
          if (mounted) {
            setProfile(null);
            setStatus('unauthenticated');
          }
          return;
        }

        setProfile(userProfile as AuthProfile);
        setStatus('authenticated');
      } catch {
        if (mounted) {
          setProfile(null);
          setStatus('unauthenticated');
        }
      }
    };

    void restoreSession();

    return () => {
      mounted = false;
      authListener.subscription.unsubscribe();
    };
  }, []);

  const signIn = useCallback(async (username: string, password: string): Promise<AuthResult> => {
    const client = getSupabaseClient();
    if (!client) return { ok: false, errorFa: 'اتصال سامانه تنظیم نشده است.' };

    setStatus('loading');
    try {
      const normalizedUsername = username.trim().toLowerCase();
      const { data, error } = await client.auth.signInWithPassword({
        email: usernameToEmail(normalizedUsername),
        password,
      });

      if (error || !data.user) {
        setStatus('unauthenticated');
        return { ok: false, errorFa: 'نام کاربری یا رمز عبور صحیح نیست.' };
      }

      const { data: userProfile, error: profileError } = await client
        .from('user_profiles')
        .select('id,full_name,role,is_active')
        .eq('id', data.user.id)
        .maybeSingle();

      if (profileError || !userProfile || userProfile.is_active !== true) {
        await client.auth.signOut();
        setProfile(null);
        setStatus('unauthenticated');
        return { ok: false, errorFa: 'این حساب هنوز توسط مدیر سامانه فعال نشده است.' };
      }

      setProfile(userProfile as AuthProfile);
      setStatus('authenticated');
      return { ok: true };
    } catch {
      setStatus('unauthenticated');
      return { ok: false, errorFa: 'ارتباط با سرویس ورود برقرار نشد. دوباره تلاش کنید.' };
    }
  }, []);

  const signOut = useCallback(async () => {
    const client = getSupabaseClient();
    if (client) await client.auth.signOut();
    setProfile(null);
    setStatus('unauthenticated');
  }, []);

  const bootstrapAdmin = useCallback(async (input: {
    username: string;
    password: string;
    fullName: string;
    bootstrapCode: string;
  }): Promise<AuthResult> => {
    const credentials = getSupabaseCredentials();
    if (!credentials.url || !credentials.anonKey) {
      return { ok: false, errorFa: 'اتصال Supabase تنظیم نشده است.' };
    }

    try {
      const baseUrl = credentials.url.endsWith('/') ? credentials.url.slice(0, -1) : credentials.url;
      const response = await fetch(`${baseUrl}/functions/v1/bootstrap-admin`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: credentials.anonKey,
          Authorization: `Bearer ${credentials.anonKey}`,
        },
        body: JSON.stringify({
          username: input.username.trim().toLowerCase(),
          password: input.password,
          full_name: input.fullName.trim(),
          bootstrap_code: input.bootstrapCode.trim(),
        }),
      });

      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        return {
          ok: false,
          errorFa: typeof result.error === 'string' ? result.error : 'راه‌اندازی مدیر اولیه انجام نشد.',
        };
      }
      return { ok: true };
    } catch {
      return { ok: false, errorFa: 'ارتباط با سرویس راه‌اندازی برقرار نشد.' };
    }
  }, []);

  const value = useMemo(
    () => ({ status, profile, signIn, signOut, bootstrapAdmin }),
    [status, profile, signIn, signOut, bootstrapAdmin]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
