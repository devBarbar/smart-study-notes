export type SettingsThemeName = 'light' | 'dark';

export const SETTINGS_TOUCH_TARGET_MIN = 44;
export const SETTINGS_MIN_CONTRAST_RATIO = 4.5;

export const SETTINGS_THEME_COLORS: Record<SettingsThemeName, {
  pageBackground: string;
  cardBackground: string;
  cardBorder: string;
  text: string;
  mutedText: string;
  controlBackground: string;
  controlBorder: string;
  selectedBackground: string;
  selectedText: string;
  primaryButtonBackground: string;
  primaryButtonText: string;
  successText: string;
}> = {
  light: {
    pageBackground: '#f6f7fb',
    cardBackground: '#ffffff',
    cardBorder: '#cbd5e1',
    text: '#0f172a',
    mutedText: '#475569',
    controlBackground: '#f8fafc',
    controlBorder: '#94a3b8',
    selectedBackground: '#4338ca',
    selectedText: '#ffffff',
    primaryButtonBackground: '#4338ca',
    primaryButtonText: '#ffffff',
    successText: '#047857',
  },
  dark: {
    pageBackground: '#0b1220',
    cardBackground: '#111827',
    cardBorder: '#334155',
    text: '#f8fafc',
    mutedText: '#cbd5e1',
    controlBackground: '#0f172a',
    controlBorder: '#64748b',
    selectedBackground: '#c7d2fe',
    selectedText: '#0f172a',
    primaryButtonBackground: '#4f46e5',
    primaryButtonText: '#ffffff',
    successText: '#6ee7b7',
  },
};
