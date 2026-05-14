import { useCallback, useEffect, useState } from 'react';
import { MaterialIcons } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { NativeButton, NativeTextInput } from '@/components/ui/native-primitives';
import { useAuth } from '@/contexts/auth-context';
import { availableLanguages, useLanguage } from '@/contexts/language-context';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
  AI_PLATFORM_LABELS,
  AI_REASONING_OPTIONS,
  AI_USE_CASES,
  AIModelOption,
  AIModelConfig,
  AIPlatform,
  AISettingsResponse,
  AIUseCase,
  getAIModelOptions,
  getDefaultModelForUseCase,
  getAISettings,
  isKnownAIModel,
  updateAISettings,
} from '@/lib/ai-settings';
import { SETTINGS_THEME_COLORS, SETTINGS_TOUCH_TARGET_MIN } from '@/lib/settings-a11y';
import { getUserTotalCost } from '@/lib/supabase';

export default function SettingsScreen() {
  const colorScheme = useColorScheme();
  const themeName = colorScheme === 'dark' ? 'dark' : 'light';
  const settingsColors = SETTINGS_THEME_COLORS[themeName];
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
  const [expandedModelUseCase, setExpandedModelUseCase] = useState<AIUseCase | null>(null);

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
              {
                backgroundColor: isActive
                  ? settingsColors.selectedBackground
                  : settingsColors.controlBackground,
                borderColor: isActive
                  ? settingsColors.selectedBackground
                  : settingsColors.controlBorder,
              },
            ]}
            accessibilityRole="button"
            accessibilityState={{ selected: isActive }}
            onPress={() => onSelect(lang.code)}
          >
            <ThemedText
              type="defaultSemiBold"
              style={[
                styles.optionText,
                { color: isActive ? settingsColors.selectedText : settingsColors.text },
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
      model: getDefaultModelForUseCase(useCase, 'openai'),
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
    const current = aiSettings?.modelConfig[useCase] ?? getDefaultConfig(useCase);
    const nextModel = isKnownAIModel(useCase, platform, current.model)
      ? current.model
      : getDefaultModelForUseCase(useCase, platform);
    setExpandedModelUseCase(null);
    patchUseCaseConfig(useCase, { platform, model: nextModel });
  };

  const handleModelSelect = (useCase: AIUseCase, model: string) => {
    patchUseCaseConfig(useCase, { model });
    setExpandedModelUseCase(null);
  };

  const getVisibleModelOptions = (
    useCase: AIUseCase,
    platform: AIPlatform,
    currentModel: string,
  ): AIModelOption[] => {
    const options = getAIModelOptions(useCase, platform);
    if (options.some((option) => option.model === currentModel)) {
      return options;
    }
    return [
      {
        id: 'current-saved-model',
        label: currentModel,
        model: currentModel,
        description: 'Saved model from your existing settings.',
      },
      ...options,
    ];
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
    <ScrollView
      style={{ backgroundColor: settingsColors.pageBackground }}
      contentContainerStyle={[
        styles.container,
        { backgroundColor: settingsColors.pageBackground },
      ]}
    >
      <ThemedView style={styles.header}>
        <ThemedText type="title" style={{ color: settingsColors.text }}>
          {t('settings.title')}
        </ThemedText>
      </ThemedView>

      <ThemedView style={[
        styles.card,
        { backgroundColor: settingsColors.cardBackground, borderColor: settingsColors.cardBorder },
      ]}>
        <ThemedText type="defaultSemiBold" style={{ color: settingsColors.text }}>
          {t('settings.appLanguage')}
        </ThemedText>
        <ThemedText style={[styles.hint, { color: settingsColors.mutedText }]}>
          {t('settings.appLanguageHint')}
        </ThemedText>
        {renderLanguageOptions(appLanguage, setAppLanguage)}
      </ThemedView>

      <ThemedView style={[
        styles.card,
        { backgroundColor: settingsColors.cardBackground, borderColor: settingsColors.cardBorder },
      ]}>
        <ThemedText type="defaultSemiBold" style={{ color: settingsColors.text }}>
          {t('settings.agentLanguage')}
        </ThemedText>
        <ThemedText style={[styles.hint, { color: settingsColors.mutedText }]}>
          {t('settings.agentLanguageHint')}
        </ThemedText>
        {renderLanguageOptions(agentLanguage, setAgentLanguage)}
      </ThemedView>

      <ThemedView style={[
        styles.card,
        { backgroundColor: settingsColors.cardBackground, borderColor: settingsColors.cardBorder },
      ]}>
        <ThemedText type="defaultSemiBold" style={{ color: settingsColors.text }}>
          {t('settings.aiUsageTitle')}
        </ThemedText>
        <View style={styles.costRow}>
          <ThemedText style={[styles.costLabel, { color: settingsColors.mutedText }]}>
            {t('settings.totalCost')}
          </ThemedText>
          {loadingCost ? (
            <ThemedText style={[styles.costValue, { color: settingsColors.text }]}>
              {t('settings.loadingCost')}
            </ThemedText>
          ) : (
            <ThemedText type="defaultSemiBold" style={[styles.costValue, { color: settingsColors.text }]}>
              {t('settings.totalCostValue', { value: (totalCost ?? 0).toFixed(4) })}
            </ThemedText>
          )}
        </View>
      </ThemedView>

      <ThemedView style={[
        styles.card,
        { backgroundColor: settingsColors.cardBackground, borderColor: settingsColors.cardBorder },
      ]} testID="ai-settings-section">
        <View style={styles.sectionHeaderRow}>
          <View style={styles.sectionHeaderText}>
            <ThemedText type="defaultSemiBold" style={{ color: settingsColors.text }}>
              {t('settings.aiModelsTitle')}
            </ThemedText>
            <ThemedText style={[styles.hint, { color: settingsColors.mutedText }]}>
              {t('settings.aiModelsHint')}
            </ThemedText>
          </View>
          {loadingAISettings && <ActivityIndicator size="small" color={settingsColors.selectedBackground} />}
        </View>

        <ThemedText type="defaultSemiBold" style={[styles.subheading, { color: settingsColors.text }]}>
          {t('settings.providerKeys')}
        </ThemedText>
        <NativeTextInput
          testID="ai-key-openai-input"
          style={[
            styles.input,
            {
              backgroundColor: settingsColors.controlBackground,
              borderColor: settingsColors.controlBorder,
            },
          ]}
          textStyle={{ color: settingsColors.text }}
          placeholder={
            aiSettings?.providerKeys.openai.configured
              ? t('settings.apiKeySaved', { last4: aiSettings.providerKeys.openai.last4 ?? '****' })
              : t('settings.openAIKeyPlaceholder')
          }
          placeholderTextColor={settingsColors.mutedText}
          value={openAIKeyInput}
          onChangeText={setOpenAIKeyInput}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
        />
        <NativeTextInput
          testID="ai-key-openrouter-input"
          style={[
            styles.input,
            {
              backgroundColor: settingsColors.controlBackground,
              borderColor: settingsColors.controlBorder,
            },
          ]}
          textStyle={{ color: settingsColors.text }}
          placeholder={
            aiSettings?.providerKeys.openrouter.configured
              ? t('settings.apiKeySaved', { last4: aiSettings.providerKeys.openrouter.last4 ?? '****' })
              : t('settings.openRouterKeyPlaceholder')
          }
          placeholderTextColor={settingsColors.mutedText}
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
              const modelOptions = getVisibleModelOptions(item.id, config.platform, config.model);
              const selectedModel = modelOptions.find((option) => option.model === config.model);
              const isModelExpanded = expandedModelUseCase === item.id;
              return (
                <View
                  key={item.id}
                  style={[
                    styles.useCaseBlock,
                    { borderTopColor: settingsColors.cardBorder },
                  ]}
                >
                  <View style={styles.useCaseHeader}>
                    <ThemedText type="defaultSemiBold" style={{ color: settingsColors.text }}>
                      {item.label}
                    </ThemedText>
                    <ThemedText style={[styles.hint, { color: settingsColors.mutedText }]}>
                      {item.hint}
                    </ThemedText>
                  </View>

                  <ThemedText style={[styles.controlLabel, { color: settingsColors.mutedText }]}>
                    {t('settings.platform')}
                  </ThemedText>
                  <View style={styles.optionsRow}>
                    {(['openai', 'openrouter'] as AIPlatform[]).map((platform) => {
                      const isActive = config.platform === platform;
                      return (
                        <Pressable
                          key={platform}
                          testID={`ai-provider-${item.id}-${platform}`}
                          style={[
                            styles.optionButton,
                            {
                              backgroundColor: isActive
                                ? settingsColors.selectedBackground
                                : settingsColors.controlBackground,
                              borderColor: isActive
                                ? settingsColors.selectedBackground
                                : settingsColors.controlBorder,
                            },
                          ]}
                          accessibilityRole="button"
                          accessibilityState={{ selected: isActive }}
                          accessibilityLabel={`${item.label} ${t('settings.platform')} ${AI_PLATFORM_LABELS[platform]}`}
                          onPress={() => handlePlatformSelect(item.id, platform)}
                        >
                          <ThemedText
                            type="defaultSemiBold"
                            style={[
                              styles.optionText,
                              {
                                color: isActive
                                  ? settingsColors.selectedText
                                  : settingsColors.text,
                              },
                            ]}
                          >
                            {AI_PLATFORM_LABELS[platform]}
                          </ThemedText>
                        </Pressable>
                      );
                    })}
                  </View>

                  <ThemedText style={[styles.controlLabel, { color: settingsColors.mutedText }]}>
                    {t('settings.model')}
                  </ThemedText>
                  <Pressable
                    testID={`ai-model-${item.id}`}
                    accessibilityRole="button"
                    accessibilityLabel={`${item.label} ${t('settings.model')} ${selectedModel?.label ?? config.model}`}
                    accessibilityState={{ expanded: isModelExpanded }}
                    style={[
                      styles.modelSelectButton,
                      {
                        backgroundColor: settingsColors.controlBackground,
                        borderColor: settingsColors.controlBorder,
                      },
                    ]}
                    onPress={() =>
                      setExpandedModelUseCase((current) => current === item.id ? null : item.id)
                    }
                  >
                    <View style={styles.modelSelectText}>
                      <ThemedText
                        type="defaultSemiBold"
                        style={{ color: settingsColors.text }}
                      >
                        {selectedModel?.label ?? config.model}
                      </ThemedText>
                      <ThemedText
                        type="caption"
                        style={[styles.modelSelectDescription, { color: settingsColors.mutedText }]}
                      >
                        {config.model}
                      </ThemedText>
                    </View>
                    <MaterialIcons
                      name={isModelExpanded ? 'keyboard-arrow-up' : 'keyboard-arrow-down'}
                      size={24}
                      color={settingsColors.text}
                    />
                  </Pressable>

                  {isModelExpanded && (
                    <View
                      testID={`ai-model-options-${item.id}`}
                      style={[
                        styles.modelOptionList,
                        {
                          backgroundColor: settingsColors.controlBackground,
                          borderColor: settingsColors.controlBorder,
                        },
                      ]}
                    >
                      {modelOptions.map((option) => {
                        const isSelected = option.model === config.model;
                        return (
                          <Pressable
                            key={option.id}
                            testID={`ai-model-option-${item.id}-${option.id}`}
                            accessibilityRole="button"
                            accessibilityState={{ selected: isSelected }}
                            accessibilityLabel={`${item.label} ${t('settings.model')} ${option.label}`}
                            onPress={() => handleModelSelect(item.id, option.model)}
                            style={[
                              styles.modelOptionButton,
                              {
                                backgroundColor: isSelected
                                  ? settingsColors.selectedBackground
                                  : settingsColors.controlBackground,
                              },
                            ]}
                          >
                            <View style={styles.modelSelectText}>
                              <ThemedText
                                type="defaultSemiBold"
                                style={{
                                  color: isSelected
                                    ? settingsColors.selectedText
                                    : settingsColors.text,
                                }}
                              >
                                {option.label}
                              </ThemedText>
                              <ThemedText
                                type="caption"
                                style={[
                                  styles.modelSelectDescription,
                                  {
                                    color: isSelected
                                      ? settingsColors.selectedText
                                      : settingsColors.mutedText,
                                  },
                                ]}
                              >
                                {option.description}
                              </ThemedText>
                            </View>
                            {isSelected && (
                              <MaterialIcons
                                name="check"
                                size={20}
                                color={settingsColors.selectedText}
                              />
                            )}
                          </Pressable>
                        );
                      })}
                    </View>
                  )}

                  {item.supportsReasoning && (
                    <>
                      <ThemedText style={[styles.controlLabel, { color: settingsColors.mutedText }]}>
                        {t('settings.reasoning')}
                      </ThemedText>
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
                                {
                                  backgroundColor: isActive
                                    ? settingsColors.selectedBackground
                                    : settingsColors.controlBackground,
                                  borderColor: isActive
                                    ? settingsColors.selectedBackground
                                    : settingsColors.controlBorder,
                                },
                              ]}
                              accessibilityRole="button"
                              accessibilityState={{ selected: isActive }}
                              accessibilityLabel={`${item.label} ${t('settings.reasoning')} ${option.label}`}
                              onPress={() =>
                                patchUseCaseConfig(item.id, { reasoningEffort: option.value })
                              }
                            >
                              <ThemedText
                                type="defaultSemiBold"
                                style={[
                                  styles.optionText,
                                  {
                                    color: isActive
                                      ? settingsColors.selectedText
                                      : settingsColors.text,
                                  },
                                ]}
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
          <ThemedText
            testID="ai-settings-message"
            style={[styles.statusMessage, { color: settingsColors.successText }]}
          >
            {aiSettingsMessage}
          </ThemedText>
        )}

        <NativeButton
          testID="ai-save-button"
          label={savingAISettings ? t('settings.saving') : t('settings.saveAISettings')}
          style={[
            styles.saveAIButton,
            { backgroundColor: settingsColors.primaryButtonBackground },
          ]}
          textStyle={[styles.signOutText, { color: settingsColors.primaryButtonText }]}
          onPress={handleSaveAISettings}
          disabled={!aiSettings || savingAISettings}
        />
      </ThemedView>

      <ThemedView style={styles.footerRow}>
        {isSaving && (
          <View style={styles.savingRow}>
            <ActivityIndicator size="small" color={settingsColors.selectedBackground} />
            <ThemedText style={{ color: settingsColors.text }}>{t('settings.saving')}</ThemedText>
          </View>
        )}
        <NativeButton
          label={authLoading ? t('settings.saving') : t('common.signOut')}
          style={[
            styles.signOutButton,
            { backgroundColor: settingsColors.primaryButtonBackground },
          ]}
          textStyle={[styles.signOutText, { color: settingsColors.primaryButtonText }]}
          onPress={() => signOut()}
          disabled={authLoading}
        />
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
    borderRadius: 12,
    padding: 14,
    gap: 6,
  },
  hint: {
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
    minHeight: SETTINGS_TOUCH_TARGET_MIN,
    justifyContent: 'center',
  },
  optionText: {},
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
    minHeight: SETTINGS_TOUCH_TARGET_MIN,
    justifyContent: 'center',
  },
  signOutText: {
  },
  costRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
  },
  costLabel: {},
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
    minHeight: SETTINGS_TOUCH_TARGET_MIN,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  useCaseList: {
    marginTop: 8,
  },
  useCaseBlock: {
    borderTopWidth: 1,
    paddingTop: 14,
    paddingBottom: 12,
    gap: 8,
  },
  useCaseHeader: {
    gap: 3,
  },
  controlLabel: {
    fontSize: 13,
    marginTop: 2,
  },
  modelSelectButton: {
    minHeight: SETTINGS_TOUCH_TARGET_MIN,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  modelSelectText: {
    flex: 1,
    gap: 2,
  },
  modelSelectDescription: {
    lineHeight: 18,
  },
  modelOptionList: {
    borderWidth: 1,
    borderRadius: 8,
    overflow: 'hidden',
  },
  modelOptionButton: {
    minHeight: SETTINGS_TOUCH_TARGET_MIN,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  statusMessage: {},
  saveAIButton: {
    marginTop: 6,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: 'center',
    minHeight: SETTINGS_TOUCH_TARGET_MIN,
    justifyContent: 'center',
  },
});
