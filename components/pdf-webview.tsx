import { Ionicons } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';
import { useMemo } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { Colors, Radii, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

import { ThemedText } from './themed-text';

type Props = {
  uri: string;
};

export const PdfWebView = ({ uri }: Props) => {
  const colorScheme = useColorScheme();
  const palette = Colors[colorScheme ?? 'light'];
  const themedStyles = useMemo(() => createThemedStyles(palette), [palette]);

  const isWeb = Platform.OS === 'web';

  const googleViewerUri = useMemo(() => {
    if (!uri) return '';
    if (uri.includes('docs.google.com/gview')) return uri;
    return `https://docs.google.com/gview?embedded=true&url=${encodeURIComponent(uri)}`;
  }, [uri]);

  const openPdf = async () => {
    if (isWeb) {
      window.open(uri, '_blank');
    } else {
      // Opens in-app browser (Safari View Controller on iOS, Chrome Custom Tabs on Android)
      await WebBrowser.openBrowserAsync(googleViewerUri);
    }
  };

  // Web platform: use iframe with Google Docs viewer
  if (isWeb) {
    return (
      <View style={styles.webContainer}>
        <iframe
          src={googleViewerUri}
          style={{
            flex: 1,
            width: '100%',
            height: '100%',
            border: 'none',
          }}
          title="PDF Viewer"
        />
      </View>
    );
  }

  // Native platforms (Expo Go compatible): show preview card with open button
  return (
    <Pressable onPress={openPdf} style={[styles.container, themedStyles.card]}>
      <View style={themedStyles.iconContainer}>
        <Ionicons name="document-text" size={48} color={palette.primary} />
      </View>
      <View style={styles.content}>
        <ThemedText type="defaultSemiBold" style={themedStyles.title}>
          PDF Document
        </ThemedText>
        <ThemedText tone="muted" style={styles.subtitle}>
          Tap to view in browser
        </ThemedText>
      </View>
      <View style={themedStyles.openButton}>
        <Ionicons name="open-outline" size={20} color={palette.primary} />
        <ThemedText type="defaultSemiBold" tone="primary">
          Open
        </ThemedText>
      </View>
    </Pressable>
  );
};

const createThemedStyles = (palette: typeof Colors.light) =>
  StyleSheet.create({
    card: {
      backgroundColor: palette.surface,
      borderColor: palette.border,
    },
    iconContainer: {
      width: 72,
      height: 72,
      borderRadius: Radii.md,
      backgroundColor: `${palette.primary}12`,
      alignItems: 'center',
      justifyContent: 'center',
    },
    title: {
      fontSize: 16,
    },
    openButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingVertical: 8,
      paddingHorizontal: 14,
      borderRadius: Radii.md,
      backgroundColor: `${palette.primary}12`,
      borderWidth: 1,
      borderColor: `${palette.primary}26`,
    },
  });

const styles = StyleSheet.create({
  container: {
    height: 100,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.md,
    gap: Spacing.md,
  },
  webContainer: {
    height: 340,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  content: {
    flex: 1,
    gap: 2,
  },
  subtitle: {
    fontSize: 13,
  },
});

