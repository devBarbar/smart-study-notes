import { Ionicons } from '@expo/vector-icons';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, Animated, Pressable, StyleSheet, View } from 'react-native';

import { Colors, Radii, Shadows, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useLanguage } from '@/contexts/language-context';
import { transcribeAudio } from '@/lib/openai';

import { ThemedText } from './themed-text';

type Props = {
  onTranscription: (text: string, costUsd?: number) => void;
  onError?: (error: Error) => void;
  disabled?: boolean;
  /** Enable hands-free listening mode - auto-rearms after TTS completion */
  listeningMode?: boolean;
  /** Callback when listening mode should be disabled (e.g., after error) */
  onListeningModeEnd?: () => void;
  /** Signal that TTS has finished and we can auto-rearm in listening mode */
  ttsFinished?: boolean;
};

export const VoiceInput = ({ 
  onTranscription, 
  onError, 
  disabled,
  listeningMode = false,
  onListeningModeEnd,
  ttsFinished = false,
}: Props) => {
  const { agentLanguage, t } = useLanguage();
  const colorScheme = useColorScheme();
  const palette = Colors[colorScheme ?? 'light'];
  const styles = useMemo(() => createStyles(palette), [palette]);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [permissionGranted, setPermissionGranted] = useState(false);
  const recordingRef = useRef<Audio.Recording | null>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const autoRearmTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Request audio permissions on mount
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

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (autoRearmTimeoutRef.current) {
        clearTimeout(autoRearmTimeoutRef.current);
      }
    };
  }, []);

  // Auto-rearm recording in listening mode when TTS finishes
  useEffect(() => {
    if (listeningMode && ttsFinished && permissionGranted && !isRecording && !isTranscribing && !disabled) {
      // Small delay before auto-rearm to let user process the response
      autoRearmTimeoutRef.current = setTimeout(() => {
        startRecording();
      }, 500);
    }

    return () => {
      if (autoRearmTimeoutRef.current) {
        clearTimeout(autoRearmTimeoutRef.current);
      }
    };
  }, [listeningMode, ttsFinished, permissionGranted, isRecording, isTranscribing, disabled]);

  // Pulse animation when recording
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

  const startRecording = useCallback(async () => {
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
      
      // Announce for accessibility
      AccessibilityInfo.announceForAccessibility(t('voice.listening'));
    } catch (err) {
      console.error('Failed to start recording:', err);
      onError?.(err as Error);
      // Disable listening mode on error
      onListeningModeEnd?.();
    }
  }, [onError, onListeningModeEnd, t]);

  const stopRecording = useCallback(async () => {
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
        const result = await transcribeAudio(dataUrl, agentLanguage);
        if (result.text.trim()) {
          onTranscription(result.text, result.costUsd);
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
      // Disable listening mode on error
      onListeningModeEnd?.();
    } finally {
      setIsTranscribing(false);
    }
  }, [agentLanguage, onError, onListeningModeEnd, onTranscription]);

  const handlePress = useCallback(() => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  }, [isRecording, startRecording, stopRecording]);

  // Get accessibility label based on state
  const getAccessibilityLabel = () => {
    if (isTranscribing) return t('voice.transcribing');
    if (isRecording) return t('voice.tapToStop');
    if (listeningMode) return t('voice.listeningMode');
    return t('voice.tapToSpeak');
  };

  if (!permissionGranted) {
    return (
      <View style={styles.container}>
        <View 
          style={[styles.button, styles.disabledButton]}
          accessibilityRole="button"
          accessibilityLabel={t('voice.permissionRequired')}
          accessibilityState={{ disabled: true }}
        >
          <Ionicons name="mic-off" size={28} color={palette.textMuted} />
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
            listeningMode && !isRecording && !isTranscribing && styles.listeningModeButton,
            disabled && styles.disabledButton,
          ]}
          onPress={handlePress}
          disabled={disabled || isTranscribing}
          accessibilityRole="button"
          accessibilityLabel={getAccessibilityLabel()}
          accessibilityState={{ 
            disabled: disabled || isTranscribing,
            busy: isTranscribing,
          }}
          accessibilityHint={isRecording ? t('voice.tapToStop') : t('voice.tapToSpeak')}
        >
          {isTranscribing ? (
            <ActivityIndicator color={palette.textOnPrimary} size="small" />
          ) : (
            <Ionicons
              name={isRecording ? 'stop' : listeningMode ? 'ear' : 'mic'}
              size={28}
              color={isRecording || listeningMode ? palette.textOnPrimary : palette.textMuted}
            />
          )}
        </Pressable>
      </Animated.View>
      <ThemedText tone="muted" style={styles.hint}>
        {isTranscribing
          ? t('voice.transcribing')
          : isRecording
          ? t('voice.tapToStop')
          : listeningMode
          ? t('voice.listening')
          : t('voice.tapToSpeak')}
      </ThemedText>
      {listeningMode && !isRecording && !isTranscribing && (
        <View style={styles.listeningBadge}>
          <Ionicons name="ear" size={12} color={palette.warning} />
          <ThemedText style={styles.listeningBadgeText}>{t('voice.listeningMode')}</ThemedText>
        </View>
      )}
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
      // Larger hit target for accessibility (minimum 44x44)
      width: 64,
      height: 64,
      borderRadius: 32,
      backgroundColor: palette.surface,
      justifyContent: 'center',
      alignItems: 'center',
      borderWidth: 2,
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
    listeningModeButton: {
      backgroundColor: palette.warning,
      borderColor: palette.warning,
    },
    disabledButton: {
      backgroundColor: palette.muted,
      borderColor: palette.muted,
      opacity: 0.7,
    },
    hint: {
      fontSize: 13,
      fontWeight: '500',
    },
    listeningBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      backgroundColor: `${palette.warning}1a`,
      paddingVertical: 4,
      paddingHorizontal: 10,
      borderRadius: Radii.pill,
      borderWidth: 1,
      borderColor: `${palette.warning}44`,
    },
    listeningBadgeText: {
      fontSize: 11,
      fontWeight: '600',
      color: palette.warning,
    },
  });
