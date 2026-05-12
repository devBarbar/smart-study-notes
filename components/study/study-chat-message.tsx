import { Ionicons } from "@expo/vector-icons";
import { ActivityIndicator, Pressable, View } from "react-native";

import { MarkdownText } from "@/components/markdown-text";
import { StudyStyles } from "@/components/study/study-styles";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { formatAIModelBadge } from "@/lib/ai-model-display";
import { CanvasAnswerMarker, StudyChatMessage, StudyCitation } from "@/types";

type StudyChatMessageProps = {
  item: StudyChatMessage;
  marker: CanvasAnswerMarker | null;
  isStreaming: boolean;
  styles: StudyStyles;
  t: (key: string, params?: Record<string, any>) => string;
  getCitationLabel: (citation: StudyCitation) => string;
  getCitationSourceLabel: (citation: StudyCitation) => string;
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
  isStreaming,
  styles,
  t,
  getCitationLabel,
  getCitationSourceLabel,
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
  const citations =
    item.role === "ai" && item.citations
      ? dedupeCitationsBySourcePage(item.citations)
      : [];
  const modelBadge =
    item.role === "ai" ? formatAIModelBadge(item.aiModel, item.aiPlatform) : null;
  const hasTutorText = item.text.trim().length > 0;
  const showThinkingProcess = item.role === "ai" && isStreaming;

  return (
    <ThemedView
      style={[
        styles.chatBubble,
        item.role === "ai" ? styles.chatAI : styles.chatUser,
      ]}
    >
      <View style={styles.bubbleHeader}>
        <View style={styles.bubbleTitleRow}>
          <View
            style={[
              styles.bubbleRoleIcon,
              item.role === "ai" ? styles.bubbleRoleIconTutor : styles.bubbleRoleIconUser,
            ]}
          >
            <Ionicons
              name={item.role === "ai" ? "school-outline" : "person-outline"}
              size={13}
              color={item.role === "ai" ? "#22c55e" : "#60a5fa"}
            />
          </View>
          <View style={styles.bubbleRoleTextStack}>
            <ThemedText
              type="defaultSemiBold"
              style={item.role === "ai" ? styles.bubbleTutorLabel : styles.bubbleUserLabel}
            >
              {item.role === "ai" ? t("study.tutorLabel") : t("study.youLabel")}
            </ThemedText>
            {showThinkingProcess && (
              <View style={styles.bubbleLiveRow}>
                <View style={styles.bubbleLiveDot} />
                <ThemedText style={styles.bubbleLiveText}>
                  {hasTutorText ? t("study.thinkingLive") : t("study.thinking")}
                </ThemedText>
              </View>
            )}
          </View>
          {marker && (
            <View style={styles.questionBadge}>
              <ThemedText style={styles.questionBadgeText}>
                Q{marker.questionIndex}
              </ThemedText>
            </View>
          )}
          {modelBadge && (
            <View
              style={styles.modelBadge}
              testID={`ai-model-badge-${item.id}`}
              accessibilityLabel={modelBadge}
            >
              <Ionicons name="hardware-chip-outline" size={12} color="#22c55e" />
              <ThemedText
                style={styles.modelBadgeText}
                numberOfLines={1}
                ellipsizeMode="middle"
              >
                {modelBadge}
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
      {showThinkingProcess && (
        <TutorThinkingProcess
          styles={styles}
          t={t}
          hasTutorText={hasTutorText}
        />
      )}
      {item.role === "ai" && hasTutorText ? (
        <MarkdownText content={item.text} />
      ) : item.role !== "ai" ? (
        <ThemedText style={{ color: "#e2e8f0" }}>{item.text}</ThemedText>
      ) : null}
      {item.role === "ai" && showThinkingProcess && hasTutorText && (
        <View style={styles.streamingFooter}>
          <ActivityIndicator color="#22c55e" size="small" />
          <ThemedText style={styles.streamingFooterText}>
            {t("study.thinkingLive")}
          </ThemedText>
        </View>
      )}
      {citations.length > 0 && (
        <View style={styles.citationRow}>
          {citations.map((citation, idx) => (
            <Pressable
              key={`${item.id}-citation-${citationKey(citation, idx)}`}
              style={styles.citationChip}
              onPress={() => onOpenCitation(citation)}
            >
              <Ionicons name="book-outline" size={12} color="#0ea5e9" />
              <View style={styles.citationSourceBadge}>
                <ThemedText style={styles.citationSourceBadgeText}>
                  {getCitationSourceLabel(citation)}
                </ThemedText>
              </View>
              <ThemedText
                style={styles.citationChipText}
                numberOfLines={1}
                ellipsizeMode="middle"
              >
                {getCitationLabel(citation)}
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

function TutorThinkingProcess({
  styles,
  t,
  hasTutorText,
}: {
  styles: StudyStyles;
  t: (key: string, params?: Record<string, any>) => string;
  hasTutorText: boolean;
}) {
  const steps = [
    {
      icon: "search-outline" as const,
      label: t("study.thinkingStepSources"),
      active: !hasTutorText,
    },
    {
      icon: "bulb-outline" as const,
      label: t("study.thinkingStepExplain"),
      active: hasTutorText,
    },
    {
      icon: "chatbubble-ellipses-outline" as const,
      label: t("study.thinkingStepQuestion"),
      active: hasTutorText,
    },
  ];

  return (
    <View style={styles.tutorThinkingCard}>
      <View style={styles.tutorThinkingHeader}>
        <View style={styles.tutorThinkingIcon}>
          <ActivityIndicator color="#0f172a" size="small" />
        </View>
        <View style={styles.tutorThinkingCopy}>
          <ThemedText style={styles.tutorThinkingTitle}>
            {hasTutorText ? t("study.thinkingLive") : t("study.thinkingPanelTitle")}
          </ThemedText>
          {!hasTutorText && (
            <ThemedText style={styles.tutorThinkingSubtitle}>
              {t("study.thinkingPanelSubtitle")}
            </ThemedText>
          )}
        </View>
      </View>
      {!hasTutorText && (
        <View style={styles.tutorThinkingSteps}>
          {steps.map((step, index) => (
            <View
              key={step.label}
              style={[
                styles.tutorThinkingStep,
                step.active && styles.tutorThinkingStepActive,
              ]}
            >
              <View style={styles.tutorThinkingStepIcon}>
                <Ionicons
                  name={step.icon}
                  size={14}
                  color={step.active ? "#0f172a" : "#64748b"}
                />
              </View>
              <ThemedText style={styles.tutorThinkingStepText}>
                {step.label}
              </ThemedText>
              {index === 0 && <View style={styles.tutorThinkingStepPulse} />}
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const citationKey = (citation: StudyCitation, index: number) =>
  citation.lectureFileId
    ? `${citation.lectureFileId}-${citation.pageNumber ?? "unknown"}`
    : `${citation.chunkId}-${citation.pageNumber ?? "unknown"}-${index}`;

const dedupeCitationsBySourcePage = (citations: StudyCitation[]) => {
  const seen = new Set<string>();
  return citations.filter((citation) => {
    const key = citation.lectureFileId
      ? `${citation.lectureFileId}-${citation.pageNumber ?? "unknown"}`
      : `${citation.chunkId}-${citation.pageNumber ?? "unknown"}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};
