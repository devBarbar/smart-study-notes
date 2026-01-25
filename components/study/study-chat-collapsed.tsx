import { Ionicons } from "@expo/vector-icons";
import { ActivityIndicator, Pressable, View } from "react-native";

import { StudyStyles } from "@/components/study/study-styles";
import { ThemedText } from "@/components/themed-text";
import { VoiceInput } from "@/components/voice-input";

type StudyChatCollapsedProps = {
  styles: StudyStyles;
  t: (key: string, params?: Record<string, any>) => string;
  messagesCount: number;
  isChatting: boolean;
  loadingQuestions: boolean;
  onToggleTutor: () => void;
  onRequestExplanation: () => void;
  onRequestQuestions: () => void;
  onRestartSession: () => void;
  onVoiceTranscription: (text: string, transcriptionCostUsd?: number) => void;
  listeningMode: boolean;
  onListeningModeEnd: () => void;
  ttsFinished: boolean;
};

export function StudyChatCollapsed({
  styles,
  t,
  messagesCount,
  isChatting,
  loadingQuestions,
  onToggleTutor,
  onRequestExplanation,
  onRequestQuestions,
  onRestartSession,
  onVoiceTranscription,
  listeningMode,
  onListeningModeEnd,
  ttsFinished,
}: StudyChatCollapsedProps) {
  return (
    <View style={styles.chatColumnCollapsed}>
      <Pressable
        style={styles.expandTutorButton}
        onPress={onToggleTutor}
        accessibilityLabel={t("study.showTutor")}
        accessibilityRole="button"
      >
        <Ionicons name="chatbubbles" size={24} color="#10b981" />
        {messagesCount > 0 && (
          <View style={styles.messageBadge}>
            <ThemedText style={styles.messageBadgeText}>
              {messagesCount}
            </ThemedText>
          </View>
        )}
      </Pressable>

      <View style={styles.collapsedQuickActions}>
        <Pressable
          style={styles.collapsedActionButton}
          onPress={onRestartSession}
          accessibilityLabel={t("study.restartSession")}
        >
          <Ionicons name="refresh" size={20} color="#64748b" />
        </Pressable>
        <Pressable
          style={styles.collapsedActionButton}
          onPress={onRequestExplanation}
          disabled={isChatting}
          accessibilityLabel={t("study.explainThis")}
        >
          <Ionicons name="bulb-outline" size={20} color="#f59e0b" />
        </Pressable>
        <Pressable
          style={styles.collapsedActionButton}
          onPress={onRequestQuestions}
          disabled={loadingQuestions}
          accessibilityLabel={t("study.quizMe")}
        >
          <Ionicons name="help-circle-outline" size={20} color="#818cf8" />
        </Pressable>
      </View>

      <View style={styles.collapsedVoiceInput}>
        <VoiceInput
          onTranscription={onVoiceTranscription}
          disabled={isChatting}
          listeningMode={listeningMode}
          onListeningModeEnd={onListeningModeEnd}
          ttsFinished={ttsFinished}
        />
      </View>

      {isChatting && (
        <View style={styles.collapsedThinking}>
          <ActivityIndicator color="#10b981" size="small" />
        </View>
      )}
    </View>
  );
}
