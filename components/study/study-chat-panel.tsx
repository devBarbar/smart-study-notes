import { Ionicons } from "@expo/vector-icons";
import { RefObject, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  TextInput,
  View,
} from "react-native";

import { StudyChatHeader } from "@/components/study/study-chat-header";
import { StudyChatInputArea } from "@/components/study/study-chat-input-area";
import { StudyChatList } from "@/components/study/study-chat-list";
import { StudyChatToolbar } from "@/components/study/study-chat-toolbar";
import {
  StudyDepthProgress,
  StudyDepthProgressItem,
} from "@/components/study/study-depth-progress";
import { StudyStyles } from "@/components/study/study-styles";
import { ThemedText } from "@/components/themed-text";
import { Colors } from "@/constants/theme";
import {
    CanvasAnswerMarker,
    StudyChatMessage,
    StudyCitation,
    StudyPlanEntry,
    StudyQuestion,
} from "@/types";

type StudyChatPanelProps = {
  styles: StudyStyles;
  palette: typeof Colors.light;
  t: (key: string, params?: Record<string, any>) => string;
  studyPlanEntry: StudyPlanEntry | null;
  ttsEnabled: boolean;
  listeningMode: boolean;
  isChatting: boolean;
  isSpeaking: boolean;
  activeTtsMessageId: string | null;
  loadingQuestions: boolean;
  grading: boolean;
  currentQuestion: StudyQuestion | null;
  messages: StudyChatMessage[];
  answerMarkers: CanvasAnswerMarker[];
  fullScreen?: boolean;
  canCollapseTutor?: boolean;
  memorizationSecondsRemaining?: number | null;
  memorizationTotalSeconds?: number;
  finalQuizProgressLabel?: string | null;
  diagnosticQuestion?: string | null;
  depthProgressItems: StudyDepthProgressItem[];
  chatListRef: RefObject<FlatList<StudyChatMessage> | null>;
  getItemLayout: (
    data: any,
    index: number,
  ) => {
    length: number;
    offset: number;
    index: number;
  };
  onToggleTutor: () => void;
  onToggleTts: () => void;
  onToggleListening: () => void;
  onStopSpeaking: () => void;
  onRestartSession: () => void;
  onRequestExplanation: () => void;
  onRequestQuestions: () => void;
  onAddPage: () => void;
  onNextQuestion: () => void;
  onSendQuickAction: (text: string) => void;
  onVoiceTranscription: (text: string, transcriptionCostUsd?: number) => void;
  onListeningModeEnd: () => void;
  ttsFinished: boolean;
  getCitationLabel: (citation: StudyCitation) => string;
  getCitationSourceLabel: (citation: StudyCitation) => string;
  onReplayMessage: (text: string, messageId: string) => void;
  onOpenCitation: (citation: StudyCitation) => void;
  onViewNotes: (answerLinkId: string) => void;
  onViewDiagram: (blockId: string) => void;
  onSubmitAnswer: () => void;
  onSubmitDiagnosticAttempt: (text: string) => void;
  onDiagnosticNoClue: () => void;
  answerDraft: string;
  onAnswerDraftChange: (text: string) => void;
};

export function StudyChatPanel({
  styles,
  palette,
  t,
  studyPlanEntry,
  ttsEnabled,
  listeningMode,
  isChatting,
  isSpeaking,
  activeTtsMessageId,
  loadingQuestions,
  grading,
  currentQuestion,
  messages,
  answerMarkers,
  fullScreen = false,
  canCollapseTutor = true,
  memorizationSecondsRemaining = null,
  memorizationTotalSeconds = 60,
  finalQuizProgressLabel = null,
  diagnosticQuestion = null,
  depthProgressItems,
  chatListRef,
  getItemLayout,
  onToggleTutor,
  onToggleTts,
  onToggleListening,
  onStopSpeaking,
  onRestartSession,
  onRequestExplanation,
  onRequestQuestions,
  onAddPage,
  onNextQuestion,
  onSendQuickAction,
  onVoiceTranscription,
  onListeningModeEnd,
  ttsFinished,
  getCitationLabel,
  getCitationSourceLabel,
  onReplayMessage,
  onOpenCitation,
  onViewNotes,
  onViewDiagram,
  onSubmitAnswer,
  onSubmitDiagnosticAttempt,
  onDiagnosticNoClue,
  answerDraft,
  onAnswerDraftChange,
}: StudyChatPanelProps) {
  const isMemorizing = memorizationSecondsRemaining !== null;
  const timerPercent =
    !isMemorizing
      ? 0
      : Math.max(
          0,
          Math.min(100, (memorizationSecondsRemaining / memorizationTotalSeconds) * 100),
        );

  return (
    <View style={[styles.chatColumn, fullScreen && styles.chatColumnFullscreen]}>
      <StudyChatHeader
        styles={styles}
        t={t}
        ttsEnabled={ttsEnabled}
        listeningMode={listeningMode}
        canCollapseTutor={canCollapseTutor}
        onToggleTutor={onToggleTutor}
        onToggleTts={onToggleTts}
        onToggleListening={onToggleListening}
        onRestartSession={onRestartSession}
      />
      <View style={styles.tutorFocusCard}>
        <View style={styles.tutorFocusIcon}>
          <Ionicons name="book-outline" size={15} color="#06b6d4" />
        </View>
        <ThemedText
          style={styles.chatSubtitle}
          numberOfLines={2}
        >
          {studyPlanEntry
            ? t("study.focusedOn", { title: studyPlanEntry.title })
            : t("study.aiSubtitle")}
        </ThemedText>
      </View>
      {studyPlanEntry && depthProgressItems.length > 0 && (
        <StudyDepthProgress
          styles={styles}
          palette={palette}
          t={t}
          items={depthProgressItems}
        />
      )}
      {memorizationSecondsRemaining !== null && (
        <View style={styles.recallTimerBanner}>
          <View style={styles.recallTimerHeader}>
            <Ionicons name="timer-outline" size={18} color="#f59e0b" />
            <ThemedText style={styles.recallTimerText}>
              {t("study.recallTimer", {
                seconds: memorizationSecondsRemaining,
              })}
            </ThemedText>
          </View>
          <View style={styles.recallTimerTrack}>
            <View
              style={[
                styles.recallTimerFill,
                { width: `${timerPercent}%` },
              ]}
            />
          </View>
        </View>
      )}
      {finalQuizProgressLabel && (
        <View style={styles.finalQuizBanner}>
          <Ionicons name="school-outline" size={16} color="#818cf8" />
          <ThemedText style={styles.finalQuizBannerText}>
            {finalQuizProgressLabel}
          </ThemedText>
        </View>
      )}
      {!isMemorizing && !diagnosticQuestion && (
        <StudyChatToolbar
          styles={styles}
          t={t}
          isChatting={isChatting}
          loadingQuestions={loadingQuestions}
          currentQuestion={currentQuestion}
          onRequestExplanation={onRequestExplanation}
          onRequestQuestions={onRequestQuestions}
          onAddPage={onAddPage}
          onNextQuestion={onNextQuestion}
          onSendQuickAction={onSendQuickAction}
        />
      )}

      {grading && <GradingStatusCard styles={styles} t={t} />}

      {diagnosticQuestion && (
        <DiagnosticAttemptCard
          styles={styles}
          t={t}
          question={diagnosticQuestion}
          disabled={isChatting}
          onSubmit={onSubmitDiagnosticAttempt}
          onNoClue={onDiagnosticNoClue}
        />
      )}

      <StudyChatList
        styles={styles}
        t={t}
        messages={messages}
        answerMarkers={answerMarkers}
        isChatting={isChatting}
        chatListRef={chatListRef}
        getItemLayout={getItemLayout}
        ttsEnabled={ttsEnabled}
        isSpeaking={isSpeaking}
        activeTtsMessageId={activeTtsMessageId}
        getCitationLabel={getCitationLabel}
        getCitationSourceLabel={getCitationSourceLabel}
        onReplayMessage={onReplayMessage}
        onStopSpeaking={onStopSpeaking}
        onOpenCitation={onOpenCitation}
        onViewNotes={onViewNotes}
        onViewDiagram={onViewDiagram}
      />

      {!isMemorizing && !diagnosticQuestion && (
        <StudyChatInputArea
          styles={styles}
          t={t}
          isChatting={isChatting}
          currentQuestion={null}
          grading={grading}
          onVoiceTranscription={onVoiceTranscription}
          listeningMode={listeningMode}
          onListeningModeEnd={onListeningModeEnd}
          ttsFinished={ttsFinished}
          onSubmitAnswer={onSubmitAnswer}
          answerDraft={answerDraft}
          onAnswerDraftChange={onAnswerDraftChange}
          onSendMessage={onSendQuickAction}
        />
      )}
    </View>
  );
}

function DiagnosticAttemptCard({
  styles,
  t,
  question,
  disabled,
  onSubmit,
  onNoClue,
}: {
  styles: StudyStyles;
  t: (key: string, params?: Record<string, any>) => string;
  question: string;
  disabled: boolean;
  onSubmit: (text: string) => void;
  onNoClue: () => void;
}) {
  const [draft, setDraft] = useState("");
  const trimmedDraft = draft.trim();

  const submit = () => {
    if (!trimmedDraft || disabled) return;
    setDraft("");
    onSubmit(trimmedDraft);
  };

  const submitNoClue = () => {
    if (disabled) return;
    setDraft("");
    onNoClue();
  };

  return (
    <View style={styles.diagnosticAttemptCard}>
      <View style={styles.diagnosticAttemptHeader}>
        <View style={styles.diagnosticAttemptIcon}>
          <Ionicons name="search-outline" size={16} color="#ffffff" />
        </View>
        <View style={styles.diagnosticAttemptCopy}>
          <ThemedText style={styles.diagnosticAttemptTitle}>
            {t("study.coldStartTitle")}
          </ThemedText>
          <ThemedText style={styles.diagnosticAttemptSubtitle}>
            {t("study.coldStartSubtitle")}
          </ThemedText>
        </View>
      </View>
      <ThemedText style={styles.diagnosticAttemptQuestion}>
        {question}
      </ThemedText>
      <TextInput
        style={styles.diagnosticAttemptInput}
        placeholder={t("study.coldStartPlaceholder")}
        placeholderTextColor="#64748b"
        value={draft}
        onChangeText={setDraft}
        editable={!disabled}
        multiline
      />
      <View style={styles.diagnosticAttemptActions}>
        <Pressable
          style={[
            styles.submitButton,
            (!trimmedDraft || disabled) && styles.disabledButton,
          ]}
          onPress={submit}
          disabled={!trimmedDraft || disabled}
          accessibilityRole="button"
          accessibilityLabel={t("study.coldStartSubmit")}
        >
          <Ionicons name="arrow-forward-circle" size={18} color="#fff" />
          <ThemedText style={styles.primaryButtonText}>
            {t("study.coldStartSubmit")}
          </ThemedText>
        </Pressable>
        <Pressable
          style={[styles.noClueButton, disabled && styles.disabledButton]}
          onPress={submitNoClue}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityLabel={t("study.noClueYet")}
        >
          <Ionicons name="help-circle-outline" size={17} color="#0f766e" />
          <ThemedText style={styles.noClueButtonText}>
            {t("study.noClueYet")}
          </ThemedText>
        </Pressable>
      </View>
    </View>
  );
}

function GradingStatusCard({
  styles,
  t,
}: {
  styles: StudyStyles;
  t: (key: string, params?: Record<string, any>) => string;
}) {
  const steps = [
    {
      icon: "scan-outline" as const,
      label: t("study.gradingStepCapture"),
    },
    {
      icon: "library-outline" as const,
      label: t("study.gradingStepSources"),
    },
    {
      icon: "school-outline" as const,
      label: t("study.gradingStepFeedback"),
    },
  ];

  return (
    <View style={styles.gradingStatusCard}>
      <View style={styles.gradingStatusHeader}>
        <View style={styles.gradingStatusIcon}>
          <ActivityIndicator color="#0f172a" size="small" />
        </View>
        <View style={styles.gradingStatusCopy}>
          <ThemedText style={styles.gradingStatusTitle}>
            {t("study.gradingPanelTitle")}
          </ThemedText>
          <ThemedText style={styles.gradingStatusSubtitle}>
            {t("study.gradingPanelSubtitle")}
          </ThemedText>
        </View>
      </View>
      <View style={styles.gradingStatusSteps}>
        {steps.map((step) => (
          <View key={step.label} style={styles.gradingStatusStep}>
            <View style={styles.gradingStatusStepIcon}>
              <Ionicons name={step.icon} size={13} color="#0f172a" />
            </View>
            <ThemedText style={styles.gradingStatusStepText}>
              {step.label}
            </ThemedText>
          </View>
        ))}
      </View>
    </View>
  );
}
