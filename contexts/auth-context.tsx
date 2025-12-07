import React, { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import * as AppleAuthentication from 'expo-apple-authentication';
import { Platform } from 'react-native';
import {
  signInWithApple as supabaseSignInWithApple,
  signInWithEmail as supabaseSignInWithEmail,
  signUpWithEmail as supabaseSignUpWithEmail,
  resetPassword as supabaseResetPassword,
  signOut as supabaseSignOut,
  getSession,
  onAuthStateChange,
  Session,
  User,
} from '@/lib/supabase';

type AuthState = {
  user: User | null;
  session: Session | null;
  isLoading: boolean;
  isAppleAuthAvailable: boolean;
};

type AuthContextType = AuthState & {
  signInWithApple: () => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signUpWithEmail: (email: string, password: string) => Promise<{ needsEmailConfirmation: boolean }>;
  resetPassword: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

type AuthProviderProps = {
  children: ReactNode;
};

export function AuthProvider({ children }: AuthProviderProps) {
  const [state, setState] = useState<AuthState>({
    user: null,
    session: null,
    isLoading: true,
    isAppleAuthAvailable: false,
  });

  // Check Apple Auth availability
  useEffect(() => {
    const checkAppleAuth = async () => {
      if (Platform.OS === 'ios') {
        const isAvailable = await AppleAuthentication.isAvailableAsync();
        setState((prev) => ({ ...prev, isAppleAuthAvailable: isAvailable }));
      } else {
        // Apple Sign-In is only available on iOS
        setState((prev) => ({ ...prev, isAppleAuthAvailable: false }));
      }
    };
    checkAppleAuth();
  }, []);

  // Initialize auth state and listen for changes
  useEffect(() => {
    // Get initial session
    const initializeAuth = async () => {
      try {
        const session = await getSession();
        setState((prev) => ({
          ...prev,
          session,
          user: session?.user ?? null,
          isLoading: false,
        }));
      } catch (error) {
        console.error('[auth] Failed to get initial session:', error);
        setState((prev) => ({ ...prev, isLoading: false }));
      }
    };

    initializeAuth();

    // Subscribe to auth state changes
    const { data: { subscription } } = onAuthStateChange((event, session) => {
      console.log('[auth] Auth state changed:', event);
      setState((prev) => ({
        ...prev,
        session,
        user: session?.user ?? null,
        isLoading: false,
      }));
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const signInWithApple = useCallback(async () => {
    if (Platform.OS !== 'ios') {
      throw new Error('Apple Sign-In is only available on iOS');
    }

    try {
      setState((prev) => ({ ...prev, isLoading: true }));

      // Request Apple Sign-In
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });

      if (!credential.identityToken) {
        throw new Error('No identity token received from Apple');
      }

      // Exchange the Apple ID token with Supabase
      const { user, session } = await supabaseSignInWithApple(credential.identityToken);

      setState((prev) => ({
        ...prev,
        user,
        session,
        isLoading: false,
      }));

      console.log('[auth] Apple Sign-In successful');
    } catch (error: unknown) {
      setState((prev) => ({ ...prev, isLoading: false }));
      
      // Handle user cancellation
      if (error instanceof Error && 'code' in error) {
        const appleError = error as { code: string };
        if (appleError.code === 'ERR_REQUEST_CANCELED') {
          console.log('[auth] User cancelled Apple Sign-In');
          return;
        }
      }
      
      console.error('[auth] Apple Sign-In failed:', error);
      throw error;
    }
  }, []);

  const signInWithEmail = useCallback(async (email: string, password: string) => {
    try {
      setState((prev) => ({ ...prev, isLoading: true }));
      
      const { user, session } = await supabaseSignInWithEmail(email, password);
      
      setState((prev) => ({
        ...prev,
        user,
        session,
        isLoading: false,
      }));
      
      console.log('[auth] Email Sign-In successful');
    } catch (error) {
      setState((prev) => ({ ...prev, isLoading: false }));
      console.error('[auth] Email Sign-In failed:', error);
      throw error;
    }
  }, []);

  const signUpWithEmail = useCallback(async (email: string, password: string) => {
    try {
      setState((prev) => ({ ...prev, isLoading: true }));
      
      const { user, session, needsEmailConfirmation } = await supabaseSignUpWithEmail(email, password);
      
      setState((prev) => ({
        ...prev,
        user: session ? user : null,
        session,
        isLoading: false,
      }));
      
      console.log('[auth] Email Sign-Up successful', { needsEmailConfirmation });
      return { needsEmailConfirmation };
    } catch (error) {
      setState((prev) => ({ ...prev, isLoading: false }));
      console.error('[auth] Email Sign-Up failed:', error);
      throw error;
    }
  }, []);

  const resetPassword = useCallback(async (email: string) => {
    try {
      setState((prev) => ({ ...prev, isLoading: true }));
      await supabaseResetPassword(email);
      setState((prev) => ({ ...prev, isLoading: false }));
      console.log('[auth] Password reset email sent');
    } catch (error) {
      setState((prev) => ({ ...prev, isLoading: false }));
      console.error('[auth] Password reset failed:', error);
      throw error;
    }
  }, []);

  const signOut = useCallback(async () => {
    try {
      setState((prev) => ({ ...prev, isLoading: true }));
      await supabaseSignOut();
      setState((prev) => ({
        ...prev,
        user: null,
        session: null,
        isLoading: false,
      }));
      console.log('[auth] Sign out successful');
    } catch (error) {
      setState((prev) => ({ ...prev, isLoading: false }));
      console.error('[auth] Sign out failed:', error);
      throw error;
    }
  }, []);

  const value: AuthContextType = {
    ...state,
    signInWithApple,
    signInWithEmail,
    signUpWithEmail,
    resetPassword,
    signOut,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
