import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors } from '@/constants/theme';
import { useAuth } from '@/contexts/auth-context';
import { availableLanguages, useLanguage } from '@/contexts/language-context';
import { useColorScheme } from '@/hooks/use-color-scheme';

export default function SettingsScreen() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const { signOut, isLoading: authLoading } = useAuth();
  const {
    appLanguage,
    agentLanguage,
    setAppLanguage,
    setAgentLanguage,
    t,
    isSaving,
  } = useLanguage();

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
});

