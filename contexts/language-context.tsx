import React, { ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { getLanguagePreferences, upsertLanguagePreferences, UserLanguagePreferences } from '@/lib/supabase';
import { availableLanguages, getSpeechLocale, translate } from '@/lib/i18n';
import { LanguageCode } from '@/types';
import { useAuth } from './auth-context';

type LanguageContextValue = {
  appLanguage: LanguageCode;
  agentLanguage: LanguageCode;
  setAppLanguage: (language: LanguageCode) => Promise<void>;
  setAgentLanguage: (language: LanguageCode) => Promise<void>;
  t: (key: string, params?: Record<string, string | number>, fallbackText?: string) => string;
  isLoading: boolean;
  isSaving: boolean;
  speechLocale: string;
  refreshPreferences: () => Promise<void>;
};

const LanguageContext = createContext<LanguageContextValue | undefined>(undefined);

const DEFAULT_LANGUAGE: LanguageCode = 'en';

type Props = { children: ReactNode };

export const LanguageProvider = ({ children }: Props) => {
  const { user } = useAuth();
  const [appLanguage, setAppLanguageState] = useState<LanguageCode>(DEFAULT_LANGUAGE);
  const [agentLanguage, setAgentLanguageState] = useState<LanguageCode>(DEFAULT_LANGUAGE);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const loadPreferences = useCallback(async () => {
    if (!user) {
      setAppLanguageState(DEFAULT_LANGUAGE);
      setAgentLanguageState(DEFAULT_LANGUAGE);
      return;
    }

    setIsLoading(true);
    try {
      const prefs = await getLanguagePreferences();
      setAppLanguageState(prefs.appLanguage);
      setAgentLanguageState(prefs.agentLanguage);
    } catch (err) {
      console.warn('[language] Failed to load preferences', err);
      setAppLanguageState(DEFAULT_LANGUAGE);
      setAgentLanguageState(DEFAULT_LANGUAGE);
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    loadPreferences();
  }, [loadPreferences]);

  const persistPreferences = useCallback(
    async (prefs: UserLanguagePreferences) => {
      if (!user) return;
      setIsSaving(true);
      try {
        await upsertLanguagePreferences(prefs);
      } catch (err) {
        console.warn('[language] Failed to save preferences', err);
      } finally {
        setIsSaving(false);
      }
    },
    [user]
  );

  const handleSetAppLanguage = useCallback(
    async (language: LanguageCode) => {
      setAppLanguageState(language);
      await persistPreferences({ appLanguage: language, agentLanguage });
    },
    [agentLanguage, persistPreferences]
  );

  const handleSetAgentLanguage = useCallback(
    async (language: LanguageCode) => {
      setAgentLanguageState(language);
      await persistPreferences({ appLanguage, agentLanguage: language });
    },
    [appLanguage, persistPreferences]
  );

  const t = useCallback(
    (key: string, params?: Record<string, string | number>, fallbackText?: string) =>
      translate(appLanguage, key, params, fallbackText),
    [appLanguage]
  );

  const speechLocale = useMemo(() => getSpeechLocale(agentLanguage), [agentLanguage]);

  const value: LanguageContextValue = {
    appLanguage,
    agentLanguage,
    setAppLanguage: handleSetAppLanguage,
    setAgentLanguage: handleSetAgentLanguage,
    t,
    isLoading,
    isSaving,
    speechLocale,
    refreshPreferences: loadPreferences,
  };

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
};

export const useLanguage = (): LanguageContextValue => {
  const ctx = useContext(LanguageContext);
  if (!ctx) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return ctx;
};

export { availableLanguages };

