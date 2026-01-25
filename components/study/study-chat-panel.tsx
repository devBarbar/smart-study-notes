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
  onReplayMessage: (text: string, messageId: string) => void;
  onOpenCitation: (citation: StudyCitation) => void;
  onViewNotes: (answerLinkId: string) => void;
  onViewDiagram: (blockId: string) => void;
  onSubmitAnswer: () => void;
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
  onReplayMessage,
  onOpenCitation,
  onViewNotes,
  onViewDiagram,
  onSubmitAnswer,
}: StudyChatPanelProps) {
  return (
    <View style={styles.chatColumn}>
      <StudyChatHeader
        styles={styles}
        t={t}
        ttsEnabled={ttsEnabled}
        listeningMode={listeningMode}
        onToggleTutor={onToggleTutor}
        onToggleTts={onToggleTts}
        onToggleListening={onToggleListening}
        onRestartSession={onRestartSession}
      />
      <ThemedText
        style={{
          color: "#94a3b8",
          fontSize: 13,
          marginVertical: 0,
          marginBottom: -200,
        }}
      >
        {studyPlanEntry
          ? t("study.focusedOn", { title: studyPlanEntry.title })
          : t("study.aiSubtitle")}
      </ThemedText>
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
        onReplayMessage={onReplayMessage}
        onStopSpeaking={onStopSpeaking}
        onOpenCitation={onOpenCitation}
        onViewNotes={onViewNotes}
        onViewDiagram={onViewDiagram}
      />

      <StudyChatInputArea
        styles={styles}
        t={t}
        isChatting={isChatting}
        currentQuestion={currentQuestion}
        grading={grading}
        onVoiceTranscription={onVoiceTranscription}
        listeningMode={listeningMode}
        onListeningModeEnd={onListeningModeEnd}
        ttsFinished={ttsFinished}
        onSubmitAnswer={onSubmitAnswer}
      />
    </View>
  );
}
