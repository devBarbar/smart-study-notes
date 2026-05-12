import { RefObject } from "react";
import { FlatList } from "react-native";

import { StudyChatMessageItem } from "@/components/study/study-chat-message";
import { StudyStyles } from "@/components/study/study-styles";
import { CanvasAnswerMarker, StudyChatMessage, StudyCitation } from "@/types";

type StudyChatListProps = {
  styles: StudyStyles;
  t: (key: string, params?: Record<string, any>) => string;
  messages: StudyChatMessage[];
  answerMarkers: CanvasAnswerMarker[];
  isChatting: boolean;
  chatListRef: RefObject<FlatList<StudyChatMessage> | null>;
  getItemLayout: (
    data: any,
    index: number,
  ) => {
    length: number;
    offset: number;
    index: number;
  };
  ttsEnabled: boolean;
  isSpeaking: boolean;
  activeTtsMessageId: string | null;
  getCitationLabel: (citation: StudyCitation) => string;
  getCitationSourceLabel: (citation: StudyCitation) => string;
  onReplayMessage: (text: string, messageId: string) => void;
  onStopSpeaking: () => void;
  onOpenCitation: (citation: StudyCitation) => void;
  onViewNotes: (answerLinkId: string) => void;
  onViewDiagram: (blockId: string) => void;
};

export function StudyChatList({
  styles,
  t,
  messages,
  answerMarkers,
  isChatting,
  chatListRef,
  getItemLayout,
  ttsEnabled,
  isSpeaking,
  activeTtsMessageId,
  getCitationLabel,
  getCitationSourceLabel,
  onReplayMessage,
  onStopSpeaking,
  onOpenCitation,
  onViewNotes,
  onViewDiagram,
}: StudyChatListProps) {
  const latestAiMessageId = [...messages].reverse().find((message) => message.role === "ai")?.id;

  return (
    <FlatList
      ref={chatListRef}
      data={messages}
      keyExtractor={(item) => item.id}
      getItemLayout={getItemLayout}
      renderItem={({ item }) => {
        const marker = item.questionId
          ? (answerMarkers.find((m) => m.questionId === item.questionId) ??
            null)
          : null;
        return (
          <StudyChatMessageItem
            item={item}
            marker={marker}
            isStreaming={isChatting && item.id === latestAiMessageId}
            styles={styles}
            t={t}
            getCitationLabel={getCitationLabel}
            ttsEnabled={ttsEnabled}
            isSpeaking={isSpeaking}
            activeTtsMessageId={activeTtsMessageId}
            onReplay={onReplayMessage}
            onStopSpeaking={onStopSpeaking}
            onOpenCitation={onOpenCitation}
            getCitationSourceLabel={getCitationSourceLabel}
            onViewNotes={onViewNotes}
            onViewDiagram={onViewDiagram}
          />
        );
      }}
      style={styles.chatList}
      contentContainerStyle={{ gap: 8, paddingBottom: 8 }}
      onScrollToIndexFailed={(info) => {
        setTimeout(() => {
          chatListRef.current?.scrollToIndex({
            index: info.index,
            animated: true,
          });
        }, 100);
      }}
    />
  );
}
