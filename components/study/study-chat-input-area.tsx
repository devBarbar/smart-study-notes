import { Ionicons } from "@expo/vector-icons";
import { ActivityIndicator, Pressable, View } from "react-native";

import { StudyStyles } from "@/components/study/study-styles";
import { ThemedText } from "@/components/themed-text";
import { VoiceInput } from "@/components/voice-input";
import { StudyQuestion } from "@/types";

type StudyChatInputAreaProps = {
  styles: StudyStyles;
  t: (key: string, params?: Record<string, any>) => string;
  isChatting: boolean;
  currentQuestion: StudyQuestion | null;
  grading: boolean;
  onVoiceTranscription: (text: string, transcriptionCostUsd?: number) => void;
  listeningMode: boolean;
  onListeningModeEnd: () => void;
  ttsFinished: boolean;
  onSubmitAnswer: () => void;
};

export function StudyChatInputArea({
  styles,
  t,
  isChatting,
  currentQuestion,
  grading,
  onVoiceTranscription,
  listeningMode,
  onListeningModeEnd,
  ttsFinished,
  onSubmitAnswer,
}: StudyChatInputAreaProps) {
  return (
    <View style={styles.inputArea}>
      <View style={styles.voiceRow}>
        <VoiceInput
          onTranscription={onVoiceTranscription}
          disabled={isChatting}
          listeningMode={listeningMode}
          onListeningModeEnd={onListeningModeEnd}
          ttsFinished={ttsFinished}
        />
        {isChatting && (
          <View style={styles.thinkingIndicator}>
            <ActivityIndicator color="#10b981" size="small" />
            <ThemedText style={{ color: "#94a3b8", fontSize: 12 }}>
              {t("study.thinking")}
            </ThemedText>
          </View>
        )}
      </View>

      {currentQuestion && (
        <View style={styles.submitArea}>
          <Pressable
            style={[styles.submitButton, grading && styles.disabledButton]}
            onPress={onSubmitAnswer}
            disabled={grading}
          >
            {grading ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <>
                <Ionicons name="checkmark-circle" size={18} color="#fff" />
                <ThemedText style={styles.primaryButtonText}>
                  {t("study.submitAnswer")}
                </ThemedText>
              </>
            )}
          </Pressable>
          <ThemedText style={styles.metaText}>
            {t("study.gradingHint")}
          </ThemedText>
        </View>
      )}
    </View>
  );
}
