import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { useMemo } from 'react';
import { Pressable, StyleSheet } from 'react-native';

import { Colors, Radii, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useLanguage } from '@/contexts/language-context';

import { ThemedText } from './themed-text';
import { ThemedView } from './themed-view';

type Props = {
  onFileSelected: (payload: { uri: string; type: 'pdf' | 'image'; name?: string; mimeType?: string }) => void;
};

export const UploadButtons = ({ onFileSelected }: Props) => {
  const { t } = useLanguage();
  const colorScheme = useColorScheme();
  const palette = Colors[colorScheme ?? 'light'];
  const styles = useMemo(() => createStyles(palette), [palette]);

  const pickDocument = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      type: 'application/pdf',
      copyToCacheDirectory: true,
    });
    if (result.assets?.[0]) {
      const asset = result.assets[0];
      onFileSelected({
        uri: asset.uri,
        type: 'pdf',
        name: asset.name,
        mimeType: asset.mimeType ?? 'application/pdf',
      });
    }
  };

  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.8,
    });
    if (!result.canceled) {
      const asset = result.assets[0];
      onFileSelected({
        uri: asset.uri,
        type: 'image',
        name: asset.fileName,
        mimeType: asset.mimeType ?? 'image/png',
      });
    }
  };

  return (
    <ThemedView variant="tinted" style={styles.container}>
      <Pressable style={[styles.button, styles.primary]} onPress={pickDocument}>
        <ThemedText type="defaultSemiBold" tone="inverse">
          {t('upload.pdf')}
        </ThemedText>
      </Pressable>
      <Pressable style={[styles.button, styles.secondary]} onPress={pickImage}>
        <ThemedText type="defaultSemiBold" tone="primary">
          {t('upload.image')}
        </ThemedText>
      </Pressable>
    </ThemedView>
  );
};

const createStyles = (palette: typeof Colors.light) =>
  StyleSheet.create({
    container: {
      flexDirection: 'row',
      gap: Spacing.sm,
      marginBottom: Spacing.md,
      borderColor: palette.border,
    },
    button: {
      flex: 1,
      paddingVertical: 12,
      paddingHorizontal: Spacing.md,
      borderRadius: Radii.md,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
    },
    primary: {
      backgroundColor: palette.primary,
      borderColor: palette.primary,
    },
    secondary: {
      backgroundColor: `${palette.primary}12`,
      borderColor: `${palette.primary}33`,
    },
  });

