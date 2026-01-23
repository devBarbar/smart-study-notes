import { Ionicons } from "@expo/vector-icons";
import { Pressable, View } from "react-native";

import { MarkdownText } from "@/components/markdown-text";
import { StudyStyles } from "@/components/study/study-styles";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { CanvasAnswerMarker, StudyChatMessage, StudyCitation } from "@/types";

type StudyChatMessageProps = {
  item: StudyChatMessage;
  marker: CanvasAnswerMarker | null;
  styles: StudyStyles;
  t: (key: string, params?: Record<string, any>) => string;
  ttsEnabled: boolean;
  isSpeaking: boolean;
  activeTtsMessageId: string | null;
  onReplay: (text: string, messageId: string) => void;
  onStopSpeaking: () => void;
  onOpenCitation: (citation: StudyCitation) => void;
  onViewNotes: (answerLinkId: string) => void;
  onViewDiagram: (blockId: string) => void;
};

export function StudyChatMessageItem({
  item,
  marker,
  styles,
  t,
  ttsEnabled,
  isSpeaking,
  activeTtsMessageId,
  onReplay,
  onStopSpeaking,
  onOpenCitation,
  onViewNotes,
  onViewDiagram,
}: StudyChatMessageProps) {
  const isActiveTtsMessage =
    item.role === "ai" && isSpeaking && activeTtsMessageId === item.id;

  return (
    <ThemedView
      style={[
        styles.chatBubble,
        item.role === "ai" ? styles.chatAI : styles.chatUser,
      ]}
    >
      <View style={styles.bubbleHeader}>
        <View style={styles.bubbleTitleRow}>
          <ThemedText
            type="defaultSemiBold"
            style={{ color: item.role === "ai" ? "#10b981" : "#60a5fa" }}
          >
            {item.role === "ai" ? t("study.tutorLabel") : t("study.youLabel")}
          </ThemedText>
          {marker && (
            <View style={styles.questionBadge}>
              <ThemedText style={styles.questionBadgeText}>
                Q{marker.questionIndex}
              </ThemedText>
            </View>
          )}
        </View>
        {item.role === "ai" && ttsEnabled && (
          <Pressable
            onPress={() =>
              isActiveTtsMessage
                ? onStopSpeaking()
                : onReplay(item.text, item.id)
            }
            style={styles.replayButton}
            accessibilityRole="button"
            accessibilityLabel={
              isActiveTtsMessage
                ? t("study.stopSpeaking")
                : t("voice.enableTts")
            }
            accessibilityHint={isActiveTtsMessage ? t("study.speaking") : undefined}
          >
            <Ionicons
              name={isActiveTtsMessage ? "stop-circle" : "play-circle"}
              size={24}
              color={isActiveTtsMessage ? "#ef4444" : "#94a3b8"}
            />
          </Pressable>
        )}
      </View>
      {item.role === "ai" ? (
        <MarkdownText content={item.text} />
      ) : (
        <ThemedText style={{ color: "#e2e8f0" }}>{item.text}</ThemedText>
      )}
      {item.role === "ai" && item.citations && item.citations.length > 0 && (
        <View style={styles.citationRow}>
          {item.citations.map((citation, idx) => (
            <Pressable
              key={`${item.id}-citation-${idx}`}
              style={styles.citationChip}
              onPress={() => onOpenCitation(citation)}
            >
              <Ionicons name="book-outline" size={12} color="#0ea5e9" />
              <ThemedText style={styles.citationChipText}>
                {citation.pageNumber
                  ? `Source p${citation.pageNumber}`
                  : "Source"}
              </ThemedText>
            </Pressable>
          ))}
        </View>
      )}
      {item.answerLinkId && (
        <Pressable
          style={styles.viewNotesButton}
          onPress={() => onViewNotes(item.answerLinkId!)}
        >
          <Ionicons name="document-text-outline" size={14} color="#60a5fa" />
          <ThemedText style={styles.viewNotesText}>
            {t("study.viewNotes")}
          </ThemedText>
        </Pressable>
      )}
      {item.visualBlockIds && item.visualBlockIds.length > 0 && (
        <Pressable
          style={styles.viewDiagramButton}
          onPress={() => onViewDiagram(item.visualBlockIds![0])}
        >
          <Ionicons name="git-network-outline" size={14} color="#10b981" />
          <ThemedText style={styles.viewDiagramText}>
            {t("study.viewDiagram")}
          </ThemedText>
        </Pressable>
      )}
    </ThemedView>
  );
}
