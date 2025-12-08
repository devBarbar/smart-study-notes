import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors } from '@/constants/theme';
import { useAuth } from '@/contexts/auth-context';
import { availableLanguages, useLanguage } from '@/contexts/language-context';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { getUserTotalCost } from '@/lib/supabase';

export default function SettingsScreen() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
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
});

