import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";

import { StudyStyles } from "@/components/study/study-styles";
import { ThemedText } from "@/components/themed-text";
import { NativeTextInput } from "@/components/ui/native-primitives";
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
  answerDraft: string;
  onAnswerDraftChange: (text: string) => void;
  onSendMessage: (text: string) => void;
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
  answerDraft,
  onAnswerDraftChange,
  onSendMessage,
}: StudyChatInputAreaProps) {
  const [chatDraft, setChatDraft] = useState("");

  const submitChatDraft = () => {
    const trimmed = chatDraft.trim();
    if (!trimmed) return;
    setChatDraft("");
    onSendMessage(trimmed);
  };

  return (
    <View style={styles.inputArea}>
      <View style={styles.chatTextInputRow}>
        <NativeTextInput
          style={styles.chatTextInput}
          placeholder={t("study.askTutorPlaceholder")}
          placeholderTextColor="#64748b"
          value={chatDraft}
          onChangeText={setChatDraft}
          editable={!isChatting}
          multiline
        />
        <Pressable
          style={[
            styles.chatSendButton,
            (!chatDraft.trim() || isChatting) && styles.disabledButton,
          ]}
          onPress={submitChatDraft}
          disabled={!chatDraft.trim() || isChatting}
          accessibilityRole="button"
          accessibilityLabel={t("study.sendMessage")}
        >
          <Ionicons name="send" size={18} color="#fff" />
        </Pressable>
      </View>

      <View style={styles.voiceRow}>
        <VoiceInput
          onTranscription={onVoiceTranscription}
          disabled={isChatting}
          listeningMode={listeningMode}
          onListeningModeEnd={onListeningModeEnd}
          ttsFinished={ttsFinished}
        />
        {(isChatting || grading) && (
          <View style={styles.thinkingIndicator}>
            <ActivityIndicator color="#10b981" size="small" />
            <ThemedText style={{ color: "#94a3b8", fontSize: 12 }}>
              {grading ? t("study.checking") : t("study.thinking")}
            </ThemedText>
          </View>
        )}
      </View>

      {currentQuestion && (
        <View style={styles.submitArea}>
          <NativeTextInput
            style={styles.answerTextInput}
            placeholder={t("study.answerPlaceholder")}
            placeholderTextColor="#64748b"
            value={answerDraft}
            onChangeText={onAnswerDraftChange}
            editable={!grading}
            multiline
          />
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
