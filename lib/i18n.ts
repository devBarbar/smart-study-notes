import { LanguageCode } from '@/types';
import de from './translations/de';
import en from './translations/en';

const translations: Record<LanguageCode, Record<string, string>> = {
  en,
  de,
};

export const availableLanguages: { code: LanguageCode; label: string; locale: string }[] = [
  { code: 'en', label: 'English', locale: 'en-US' },
  { code: 'de', label: 'Deutsch', locale: 'de-DE' },
];

const FALLBACK_LANGUAGE: LanguageCode = 'en';

const applyParams = (text: string, params?: Record<string, string | number>): string => {
  if (!params) return text;
  return text.replace(/{{(\w+)}}/g, (_, key) => {
    const value = params[key];
    return value === undefined || value === null ? '' : String(value);
  });
};

export const translate = (
  language: LanguageCode,
  key: string,
  params?: Record<string, string | number>,
  fallbackText?: string
): string => {
  const value =
    translations[language]?.[key] ??
    translations[FALLBACK_LANGUAGE]?.[key] ??
    fallbackText ??
    key;

  return applyParams(value, params);
};

export const getSpeechLocale = (language: LanguageCode): string => {
  return availableLanguages.find((item) => item.code === language)?.locale ?? 'en-US';
};

