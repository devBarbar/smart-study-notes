import { Ionicons } from '@expo/vector-icons';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Pressable, StyleSheet, View } from 'react-native';

import { Colors, Radii, Shadows, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useLanguage } from '@/contexts/language-context';
import { transcribeAudio } from '@/lib/openai';

import { ThemedText } from './themed-text';

type Props = {
  onTranscription: (text: string) => void;
  onError?: (error: Error) => void;
  disabled?: boolean;
};

export const VoiceInput = ({ onTranscription, onError, disabled }: Props) => {
  const { agentLanguage, t } = useLanguage();
  const colorScheme = useColorScheme();
  const palette = Colors[colorScheme ?? 'light'];
  const styles = useMemo(() => createStyles(palette), [palette]);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [permissionGranted, setPermissionGranted] = useState(false);
  const recordingRef = useRef<Audio.Recording | null>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const requestPermissions = async () => {
      try {
        const { status } = await Audio.requestPermissionsAsync();
        setPermissionGranted(status === 'granted');
      } catch (err) {
        console.warn('Failed to get audio permissions:', err);
      }
    };
    requestPermissions();
  }, []);

  useEffect(() => {
    if (isRecording) {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.15,
            duration: 550,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 550,
            useNativeDriver: true,
          }),
        ])
      );
      pulse.start();
      return () => pulse.stop();
    } else {
      pulseAnim.setValue(1);
    }
  }, [isRecording, pulseAnim]);

  const startRecording = async () => {
    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );
      recordingRef.current = recording;
      setIsRecording(true);
    } catch (err) {
      console.error('Failed to start recording:', err);
      onError?.(err as Error);
    }
  };

  const stopRecording = async () => {
    if (!recordingRef.current) return;

    try {
      setIsRecording(false);
      setIsTranscribing(true);

      await recordingRef.current.stopAndUnloadAsync();
      const uri = recordingRef.current.getURI();
      recordingRef.current = null;

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
      });

      if (uri) {
        // Convert local recording to data URL for queued transcription
        const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
        const dataUrl = `data:audio/m4a;base64,${base64}`;
        const transcription = await transcribeAudio(dataUrl, agentLanguage);
        if (transcription.trim()) {
          onTranscription(transcription);
        }
        
        try {
          await FileSystem.deleteAsync(uri, { idempotent: true });
        } catch {
          // Ignore cleanup errors
        }
      }
    } catch (err) {
      console.error('Failed to stop recording or transcribe:', err);
      onError?.(err as Error);
    } finally {
      setIsTranscribing(false);
    }
  };

  const handlePress = () => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  if (!permissionGranted) {
    return (
      <View style={styles.container}>
        <View style={[styles.button, styles.disabledButton]}>
          <Ionicons name="mic-off" size={24} color={palette.textMuted} />
        </View>
        <ThemedText tone="muted" style={styles.hint}>{t('voice.permissionRequired')}</ThemedText>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
        <Pressable
          style={[
            styles.button,
            isRecording && styles.recordingButton,
            isTranscribing && styles.transcribingButton,
            disabled && styles.disabledButton,
          ]}
          onPress={handlePress}
          disabled={disabled || isTranscribing}
        >
          {isTranscribing ? (
            <ActivityIndicator color={palette.textOnPrimary} size="small" />
          ) : (
            <Ionicons
              name={isRecording ? 'stop' : 'mic'}
              size={24}
              color={isRecording ? palette.textOnPrimary : palette.textMuted}
            />
          )}
        </Pressable>
      </Animated.View>
      <ThemedText tone="muted" style={styles.hint}>
        {isTranscribing
          ? t('voice.transcribing')
          : isRecording
          ? t('voice.tapToStop')
          : t('voice.tapToSpeak')}
      </ThemedText>
    </View>
  );
};

const createStyles = (palette: typeof Colors.light) =>
  StyleSheet.create({
    container: {
      alignItems: 'center',
      gap: Spacing.xs,
    },
    button: {
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: palette.surface,
      justifyContent: 'center',
      alignItems: 'center',
      borderWidth: 1,
      borderColor: palette.border,
      ...Shadows.sm,
    },
    recordingButton: {
      backgroundColor: palette.danger,
      borderColor: palette.danger,
    },
    transcribingButton: {
      backgroundColor: palette.primary,
      borderColor: palette.primary,
    },
    disabledButton: {
      backgroundColor: palette.muted,
      borderColor: palette.muted,
      opacity: 0.7,
    },
    hint: {
      fontSize: 12,
    },
  });

