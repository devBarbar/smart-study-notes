import { Ionicons } from "@expo/vector-icons";
import { RefObject } from "react";
import { FlatList, View } from "react-native";

import { StudyChatHeader } from "@/components/study/study-chat-header";
import { StudyChatInputArea } from "@/components/study/study-chat-input-area";
import { StudyChatList } from "@/components/study/study-chat-list";
import { StudyChatToolbar } from "@/components/study/study-chat-toolbar";
import { StudyStyles } from "@/components/study/study-styles";
import { ThemedText } from "@/components/themed-text";
import {
    CanvasAnswerMarker,
    StudyChatMessage,
    StudyCitation,
    StudyPlanEntry,
    StudyQuestion,
} from "@/types";

type StudyChatPanelProps = {
  styles: StudyStyles;
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
  answerDraft: string;
  onAnswerDraftChange: (text: string) => void;
};

export function StudyChatPanel({
  styles,
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
      <ThemedText
        style={styles.chatSubtitle}
        numberOfLines={1}
      >
        {studyPlanEntry
          ? t("study.focusedOn", { title: studyPlanEntry.title })
          : t("study.aiSubtitle")}
      </ThemedText>
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
      {!isMemorizing && (
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

      <StudyChatList
        styles={styles}
        t={t}
        messages={messages}
        answerMarkers={answerMarkers}
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

      {!isMemorizing && (
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
