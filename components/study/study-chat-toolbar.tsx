import { Ionicons } from "@expo/vector-icons";
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native";

import { StudyStyles } from "@/components/study/study-styles";
import { ThemedText } from "@/components/themed-text";
import { StudyQuestion } from "@/types";

type StudyChatToolbarProps = {
  styles: StudyStyles;
  t: (key: string, params?: Record<string, any>) => string;
  isChatting: boolean;
  loadingQuestions: boolean;
  currentQuestion: StudyQuestion | null;
  onRequestExplanation: () => void;
  onRequestQuestions: () => void;
  onAddPage: () => void;
  onNextQuestion: () => void;
  onSendQuickAction: (text: string) => void;
};

export function StudyChatToolbar({
  styles,
  t,
  isChatting,
  loadingQuestions,
  currentQuestion,
  onRequestExplanation,
  onRequestQuestions,
  onAddPage,
  onNextQuestion,
  onSendQuickAction,
}: StudyChatToolbarProps) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.chatToolbarScroll}
      contentContainerStyle={styles.chatToolbarContent}
    >
      <Pressable
        style={styles.explainButton}
        onPress={onRequestExplanation}
        disabled={isChatting}
        accessibilityRole="button"
        accessibilityLabel={t("study.explainThis")}
        accessibilityState={{ disabled: isChatting }}
      >
        <Ionicons name="bulb-outline" size={18} color="#f59e0b" />
        <ThemedText style={styles.explainButtonText}>
          {t("study.explainThis")}
        </ThemedText>
      </Pressable>
      <Pressable
        style={styles.primaryButton}
        onPress={onRequestQuestions}
        disabled={loadingQuestions}
        accessibilityRole="button"
        accessibilityLabel={t("study.quizMe")}
        accessibilityState={{
          disabled: loadingQuestions,
          busy: loadingQuestions,
        }}
      >
        {loadingQuestions ? (
          <ActivityIndicator color="#fff" size="small" />
        ) : (
          <ThemedText style={styles.primaryButtonText}>
            {t("study.quizMe")}
          </ThemedText>
        )}
      </Pressable>
      <Pressable
        style={styles.secondaryButton}
        onPress={onAddPage}
        accessibilityRole="button"
        accessibilityLabel="Start a new blank page without deleting notes"
      >
        <ThemedText style={styles.secondaryButtonText}>
          New blank page
        </ThemedText>
      </Pressable>
      {currentQuestion && (
        <Pressable
          style={styles.secondaryButton}
          onPress={onNextQuestion}
          accessibilityRole="button"
          accessibilityLabel={t("study.nextQuestion")}
        >
          <ThemedText style={styles.secondaryButtonText}>
            {t("study.nextQuestion")}
          </ThemedText>
        </Pressable>
      )}

      <View style={styles.toolbarDivider} />

      <Pressable
        style={styles.quickActionChip}
        onPress={() => onSendQuickAction(t("voice.quickSimpler"))}
        disabled={isChatting}
        accessibilityLabel={t("voice.quickSimpler")}
      >
        <Ionicons name="sparkles-outline" size={14} color="#a5b4fc" />
        <ThemedText style={styles.quickActionText}>
          {t("voice.simpler")}
        </ThemedText>
      </Pressable>
      <Pressable
        style={styles.quickActionChip}
        onPress={() => onSendQuickAction(t("voice.quickAnalogy"))}
        disabled={isChatting}
        accessibilityLabel={t("voice.quickAnalogy")}
      >
        <Ionicons name="swap-horizontal-outline" size={14} color="#a5b4fc" />
        <ThemedText style={styles.quickActionText}>
          {t("voice.analogy")}
        </ThemedText>
      </Pressable>
      <Pressable
        style={styles.quickActionChip}
        onPress={() => onSendQuickAction(t("voice.quickFormula"))}
        disabled={isChatting}
        accessibilityLabel={t("voice.quickFormula")}
      >
        <Ionicons name="calculator-outline" size={14} color="#a5b4fc" />
        <ThemedText style={styles.quickActionText}>
          {t("voice.formula")}
        </ThemedText>
      </Pressable>
    </ScrollView>
  );
}
