import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors } from '@/constants/theme';
import { useAuth } from '@/contexts/auth-context';
import { availableLanguages, useLanguage } from '@/contexts/language-context';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
  AI_PLATFORM_LABELS,
  AI_REASONING_OPTIONS,
  AI_USE_CASES,
  AIModelConfig,
  AIPlatform,
  AISettingsResponse,
  AIUseCase,
  getAISettings,
  updateAISettings,
} from '@/lib/ai-settings';
import { getUserTotalCost } from '@/lib/supabase';

export default function SettingsScreen() {
  const colorScheme = useColorScheme();
  const themeName = colorScheme === 'dark' ? 'dark' : 'light';
  const colors = Colors[themeName];
  const { signOut, isLoading: authLoading, user } = useAuth();
  const {
    appLanguage,
    agentLanguage,
    setAppLanguage,
    setAgentLanguage,
    t,
    isSaving,
  } = useLanguage();

  const [totalCost, setTotalCost] = useState<number | null>(null);
  const [loadingCost, setLoadingCost] = useState(false);
  const [aiSettings, setAISettings] = useState<AISettingsResponse | null>(null);
  const [loadingAISettings, setLoadingAISettings] = useState(false);
  const [savingAISettings, setSavingAISettings] = useState(false);
  const [aiSettingsMessage, setAISettingsMessage] = useState<string | null>(null);
  const [openAIKeyInput, setOpenAIKeyInput] = useState('');
  const [openRouterKeyInput, setOpenRouterKeyInput] = useState('');

  const fetchTotalCost = useCallback(async () => {
    if (!user) return;
    setLoadingCost(true);
    try {
      const cost = await getUserTotalCost();
      setTotalCost(cost);
    } catch (err) {
      console.warn('[settings] failed to fetch total cost', err);
    } finally {
      setLoadingCost(false);
    }
  }, [user]);

  useEffect(() => {
    fetchTotalCost();
  }, [fetchTotalCost]);

  const fetchAISettings = useCallback(async () => {
    if (!user) return;
    setLoadingAISettings(true);
    try {
      const settings = await getAISettings();
      setAISettings(settings);
    } catch (err) {
      console.warn('[settings] failed to fetch AI settings', err);
      setAISettingsMessage(t('settings.aiSettingsLoadFailed'));
    } finally {
      setLoadingAISettings(false);
    }
  }, [t, user]);

  useEffect(() => {
    fetchAISettings();
  }, [fetchAISettings]);

  const renderLanguageOptions = (
    selected: string,
    onSelect: (code: any) => void
  ) => (
    <View style={styles.optionsRow}>
      {availableLanguages.map((lang) => {
        const isActive = lang.code === selected;
        return (
          <Pressable
            key={lang.code}
            style={[
              styles.optionButton,
              { borderColor: colors.icon },
              isActive && { backgroundColor: colors.tint, borderColor: colors.tint },
            ]}
            onPress={() => onSelect(lang.code)}
          >
            <ThemedText
              type="defaultSemiBold"
              style={[
                styles.optionText,
                { color: isActive ? '#fff' : colors.text },
              ]}
            >
              {lang.label}
            </ThemedText>
          </Pressable>
        );
      })}
    </View>
  );

  const getDefaultConfig = (useCase: AIUseCase): AIModelConfig => {
    const item = AI_USE_CASES.find((entry) => entry.id === useCase)!;
    return {
      platform: 'openai',
      model: item.defaultModels.openai,
      reasoningEffort: item.supportsReasoning ? 'high' : null,
    };
  };

  const patchUseCaseConfig = (useCase: AIUseCase, patch: Partial<AIModelConfig>) => {
    setAISettings((current) => {
      if (!current) return current;
      const existing = current.modelConfig[useCase] ?? getDefaultConfig(useCase);
      return {
        ...current,
        modelConfig: {
          ...current.modelConfig,
          [useCase]: {
            ...existing,
            ...patch,
          },
        },
      };
    });
  };

  const handlePlatformSelect = (useCase: AIUseCase, platform: AIPlatform) => {
    const item = AI_USE_CASES.find((entry) => entry.id === useCase)!;
    const current = aiSettings?.modelConfig[useCase] ?? getDefaultConfig(useCase);
    const currentDefault = item.defaultModels[current.platform];
    const nextModel = current.model === currentDefault ? item.defaultModels[platform] : current.model;
    patchUseCaseConfig(useCase, { platform, model: nextModel });
  };

  const handleSaveAISettings = async () => {
    if (!aiSettings) return;
    setSavingAISettings(true);
    setAISettingsMessage(null);
    try {
      const apiKeys: Partial<Record<AIPlatform, string>> = {};
      if (openAIKeyInput.trim()) apiKeys.openai = openAIKeyInput.trim();
      if (openRouterKeyInput.trim()) apiKeys.openrouter = openRouterKeyInput.trim();
      const saved = await updateAISettings({
        modelConfig: aiSettings.modelConfig,
        apiKeys,
      });
      setAISettings(saved);
      setOpenAIKeyInput('');
      setOpenRouterKeyInput('');
      setAISettingsMessage(t('settings.aiSettingsSaved'));
    } catch (err) {
      console.warn('[settings] failed to save AI settings', err);
      setAISettingsMessage(t('settings.aiSettingsSaveFailed'));
    } finally {
      setSavingAISettings(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <ThemedView style={styles.header}>
        <ThemedText type="title">{t('settings.title')}</ThemedText>
      </ThemedView>

      <ThemedView style={styles.card}>
        <ThemedText type="defaultSemiBold">{t('settings.appLanguage')}</ThemedText>
        <ThemedText style={styles.hint}>{t('settings.appLanguageHint')}</ThemedText>
        {renderLanguageOptions(appLanguage, setAppLanguage)}
      </ThemedView>

      <ThemedView style={styles.card}>
        <ThemedText type="defaultSemiBold">{t('settings.agentLanguage')}</ThemedText>
        <ThemedText style={styles.hint}>{t('settings.agentLanguageHint')}</ThemedText>
        {renderLanguageOptions(agentLanguage, setAgentLanguage)}
      </ThemedView>

      <ThemedView style={styles.card}>
        <ThemedText type="defaultSemiBold">{t('settings.aiUsageTitle')}</ThemedText>
        <View style={styles.costRow}>
          <ThemedText style={styles.costLabel}>{t('settings.totalCost')}</ThemedText>
          {loadingCost ? (
            <ThemedText style={styles.costValue}>{t('settings.loadingCost')}</ThemedText>
          ) : (
            <ThemedText type="defaultSemiBold" style={styles.costValue}>
              {t('settings.totalCostValue', { value: (totalCost ?? 0).toFixed(4) })}
            </ThemedText>
          )}
        </View>
      </ThemedView>

      <ThemedView style={styles.card} testID="ai-settings-section">
        <View style={styles.sectionHeaderRow}>
          <View style={styles.sectionHeaderText}>
            <ThemedText type="defaultSemiBold">{t('settings.aiModelsTitle')}</ThemedText>
            <ThemedText style={styles.hint}>{t('settings.aiModelsHint')}</ThemedText>
          </View>
          {loadingAISettings && <ActivityIndicator size="small" color={colors.tint} />}
        </View>

        <ThemedText type="defaultSemiBold" style={styles.subheading}>
          {t('settings.providerKeys')}
        </ThemedText>
        <TextInput
          testID="ai-key-openai-input"
          style={[styles.input, { color: colors.text }]}
          placeholder={
            aiSettings?.providerKeys.openai.configured
              ? t('settings.apiKeySaved', { last4: aiSettings.providerKeys.openai.last4 ?? '****' })
              : t('settings.openAIKeyPlaceholder')
          }
          placeholderTextColor="#64748b"
          value={openAIKeyInput}
          onChangeText={setOpenAIKeyInput}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
        />
        <TextInput
          testID="ai-key-openrouter-input"
          style={[styles.input, { color: colors.text }]}
          placeholder={
            aiSettings?.providerKeys.openrouter.configured
              ? t('settings.apiKeySaved', { last4: aiSettings.providerKeys.openrouter.last4 ?? '****' })
              : t('settings.openRouterKeyPlaceholder')
          }
          placeholderTextColor="#64748b"
          value={openRouterKeyInput}
          onChangeText={setOpenRouterKeyInput}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
        />

        {aiSettings && (
          <View style={styles.useCaseList}>
            {AI_USE_CASES.map((item) => {
              const config = aiSettings.modelConfig[item.id] ?? getDefaultConfig(item.id);
              return (
                <View key={item.id} style={styles.useCaseBlock}>
                  <View style={styles.useCaseHeader}>
                    <ThemedText type="defaultSemiBold">{item.label}</ThemedText>
                    <ThemedText style={styles.hint}>{item.hint}</ThemedText>
                  </View>

                  <ThemedText style={styles.controlLabel}>{t('settings.platform')}</ThemedText>
                  <View style={styles.optionsRow}>
                    {(['openai', 'openrouter'] as AIPlatform[]).map((platform) => {
                      const isActive = config.platform === platform;
                      return (
                        <Pressable
                          key={platform}
                          testID={`ai-provider-${item.id}-${platform}`}
                          style={[
                            styles.optionButton,
                            { borderColor: colors.icon },
                            isActive && { backgroundColor: colors.tint, borderColor: colors.tint },
                          ]}
                          onPress={() => handlePlatformSelect(item.id, platform)}
                        >
                          <ThemedText
                            type="defaultSemiBold"
                            style={[styles.optionText, { color: isActive ? '#fff' : colors.text }]}
                          >
                            {AI_PLATFORM_LABELS[platform]}
                          </ThemedText>
                        </Pressable>
                      );
                    })}
                  </View>

                  <ThemedText style={styles.controlLabel}>{t('settings.model')}</ThemedText>
                  <TextInput
                    testID={`ai-model-${item.id}`}
                    style={[styles.input, { color: colors.text }]}
                    value={config.model}
                    onChangeText={(model) => patchUseCaseConfig(item.id, { model })}
                    autoCapitalize="none"
                    autoCorrect={false}
                    placeholder={item.defaultModels[config.platform]}
                    placeholderTextColor="#64748b"
                  />

                  {item.supportsReasoning && (
                    <>
                      <ThemedText style={styles.controlLabel}>{t('settings.reasoning')}</ThemedText>
                      <View style={styles.optionsRowWrap}>
                        {AI_REASONING_OPTIONS.map((option) => {
                          const isActive = (config.reasoningEffort ?? null) === option.value;
                          const testValue = option.value ?? 'off';
                          return (
                            <Pressable
                              key={testValue}
                              testID={`ai-reasoning-${item.id}-${testValue}`}
                              style={[
                                styles.optionButton,
                                { borderColor: colors.icon },
                                isActive && { backgroundColor: colors.tint, borderColor: colors.tint },
                              ]}
                              onPress={() =>
                                patchUseCaseConfig(item.id, { reasoningEffort: option.value })
                              }
                            >
                              <ThemedText
                                type="defaultSemiBold"
                                style={[styles.optionText, { color: isActive ? '#fff' : colors.text }]}
                              >
                                {option.label}
                              </ThemedText>
                            </Pressable>
                          );
                        })}
                      </View>
                    </>
                  )}
                </View>
              );
            })}
          </View>
        )}

        {aiSettingsMessage && (
          <ThemedText testID="ai-settings-message" style={styles.statusMessage}>
            {aiSettingsMessage}
          </ThemedText>
        )}

        <Pressable
          testID="ai-save-button"
          style={[styles.saveAIButton, { backgroundColor: colors.tint }]}
          onPress={handleSaveAISettings}
          disabled={!aiSettings || savingAISettings}
        >
          {savingAISettings ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <ThemedText type="defaultSemiBold" style={styles.signOutText}>
              {t('settings.saveAISettings')}
            </ThemedText>
          )}
        </Pressable>
      </ThemedView>

      <ThemedView style={styles.footerRow}>
        {isSaving && (
          <View style={styles.savingRow}>
            <ActivityIndicator size="small" color={colors.tint} />
            <ThemedText>{t('settings.saving')}</ThemedText>
          </View>
        )}
        <Pressable
          style={[styles.signOutButton, { backgroundColor: colors.tint }]}
          onPress={() => signOut()}
          disabled={authLoading}
        >
          {authLoading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <ThemedText type="defaultSemiBold" style={styles.signOutText}>
              {t('common.signOut')}
            </ThemedText>
          )}
        </Pressable>
      </ThemedView>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    gap: 12,
  },
  header: {
    marginBottom: 4,
  },
  card: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    padding: 14,
    gap: 6,
    backgroundColor: '#fff',
  },
  hint: {
    color: '#64748b',
    marginBottom: 6,
  },
  optionsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  optionsRowWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  optionButton: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
  },
  optionText: {
    color: '#0f172a',
  },
  footerRow: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  savingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  signOutButton: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
  },
  signOutText: {
    color: '#fff',
  },
  costRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
  },
  costLabel: {
    color: '#64748b',
  },
  costValue: {
    fontSize: 16,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  sectionHeaderText: {
    flex: 1,
  },
  subheading: {
    marginTop: 8,
  },
  input: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#f8fafc',
  },
  useCaseList: {
    marginTop: 8,
  },
  useCaseBlock: {
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    paddingTop: 14,
    paddingBottom: 12,
    gap: 8,
  },
  useCaseHeader: {
    gap: 3,
  },
  controlLabel: {
    color: '#475569',
    fontSize: 13,
    marginTop: 2,
  },
  statusMessage: {
    color: '#0f766e',
  },
  saveAIButton: {
    marginTop: 6,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
});
