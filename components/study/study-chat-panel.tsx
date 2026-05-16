import { Ionicons } from "@expo/vector-icons";
import { RefObject, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
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
import { NativeTextInput } from "@/components/ui/native-primitives";
import { Colors } from "@/constants/theme";
import {
    CanvasAnswerMarker,
    StudyChatMessage,
    StudyCitation,
    StudyMistakeNotebookItem,
    StudyMode,
    StudyPlanEntry,
    StudyPrepContent,
    StudyQuestion,
    StudyWarmupQuestion,
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
  warmupQuestion?: StudyWarmupQuestion | null;
  warmupSelectedOptionIndex?: number | null;
  warmupProgressLabel?: string | null;
  warmupGenerating?: boolean;
  finalQuizProgressLabel?: string | null;
  studyMode: StudyMode;
  studyPrepContent: StudyPrepContent;
  setupActive?: boolean;
  mistakeNotebook: StudyMistakeNotebookItem[];
  diagnosticQuestion?: string | null;
  depthProgressItems: StudyDepthProgressItem[];
  passScoreThreshold: number;
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
  onSelectWarmupOption: (optionIndex: number) => void;
  onContinueWarmup: () => void;
  onStudyModeChange: (mode: StudyMode) => void;
  onStartWarmup: () => void;
  onSubmitDiagnosticAttempt: (text: string) => void;
  onDiagnosticNoClue: () => void;
  answerDraft: string;
  onAnswerDraftChange: (text: string) => void;
};

type StudySetupTabKey = "primer" | "conceptMap" | "example";
type StudyProgressTabKey = "mastery" | "review";

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
  warmupQuestion = null,
  warmupSelectedOptionIndex = null,
  warmupProgressLabel = null,
  warmupGenerating = false,
  finalQuizProgressLabel = null,
  studyMode,
  studyPrepContent,
  setupActive = false,
  mistakeNotebook,
  diagnosticQuestion = null,
  depthProgressItems,
  passScoreThreshold,
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
  onSelectWarmupOption,
  onContinueWarmup,
  onStudyModeChange,
  onStartWarmup,
  onSubmitDiagnosticAttempt,
  onDiagnosticNoClue,
  answerDraft,
  onAnswerDraftChange,
}: StudyChatPanelProps) {
  const [activeProgressTab, setActiveProgressTab] =
    useState<StudyProgressTabKey>("mastery");
  const isMemorizing = memorizationSecondsRemaining !== null;
  const timerPercent =
    !isMemorizing
      ? 0
      : Math.max(
          0,
          Math.min(100, (memorizationSecondsRemaining / memorizationTotalSeconds) * 100),
        );

  return (
    <View
      testID="study-chat-panel"
      style={[styles.chatColumn, fullScreen && styles.chatColumnFullscreen]}
    >
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
      {!setupActive && (depthProgressItems.length > 0 || mistakeNotebook.length > 0) && (
        <StudyProgressTabs
          styles={styles}
          palette={palette}
          t={t}
          depthProgressItems={depthProgressItems}
          passScoreThreshold={passScoreThreshold}
          mistakeNotebook={mistakeNotebook}
          activeTab={activeProgressTab}
          onTabChange={setActiveProgressTab}
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
      {warmupProgressLabel && (
        <View style={styles.warmupBanner}>
          <Ionicons name="sparkles-outline" size={16} color="#0f766e" />
          <ThemedText style={styles.warmupBannerText}>
            {warmupProgressLabel}
          </ThemedText>
        </View>
      )}
      {!isMemorizing && !diagnosticQuestion && !warmupQuestion && !warmupGenerating && !setupActive && (
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

      {setupActive && (
        <StudySetupCard
          palette={palette}
          styles={styles}
          t={t}
          mode={studyMode}
          content={studyPrepContent}
          depthProgressItems={depthProgressItems}
          passScoreThreshold={passScoreThreshold}
          mistakeNotebook={mistakeNotebook}
          onModeChange={onStudyModeChange}
          onStart={onStartWarmup}
          disabled={isChatting}
        />
      )}

      {(warmupQuestion || warmupGenerating) && (
        <WarmupQuizCard
          styles={styles}
          t={t}
          question={warmupQuestion}
          selectedOptionIndex={warmupSelectedOptionIndex}
          loading={warmupGenerating}
          disabled={isChatting}
          onSelectOption={onSelectWarmupOption}
          onContinue={onContinueWarmup}
        />
      )}

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

      {!isMemorizing && !diagnosticQuestion && !warmupQuestion && !warmupGenerating && !setupActive && (
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

function StudySetupCard({
  palette,
  styles,
  t,
  mode,
  content,
  depthProgressItems,
  passScoreThreshold,
  mistakeNotebook,
  disabled,
  onModeChange,
  onStart,
}: {
  palette: typeof Colors.light;
  styles: StudyStyles;
  t: (key: string, params?: Record<string, any>) => string;
  mode: StudyMode;
  content: StudyPrepContent;
  depthProgressItems: StudyDepthProgressItem[];
  passScoreThreshold: number;
  mistakeNotebook: StudyMistakeNotebookItem[];
  disabled: boolean;
  onModeChange: (mode: StudyMode) => void;
  onStart: () => void;
}) {
  const [activeSetupTab, setActiveSetupTab] = useState<StudySetupTabKey>("primer");
  const modes: { value: StudyMode; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
    { value: "beginner", label: t("study.modeBeginner"), icon: "leaf-outline" },
    { value: "normal", label: t("study.modeNormal"), icon: "school-outline" },
    { value: "exam", label: t("study.modeExam"), icon: "timer-outline" },
  ];
  const setupTabs: {
    key: StudySetupTabKey;
    label: string;
    icon: keyof typeof Ionicons.glyphMap;
  }[] = [
    { key: "primer", label: t("study.primerTab"), icon: "list-outline" },
    { key: "conceptMap", label: t("study.conceptMapTab"), icon: "git-network-outline" },
    ...(content.workedExample
      ? [{ key: "example" as const, label: t("study.workedExampleTab"), icon: "construct-outline" as const }]
      : []),
  ];
  const selectedSetupTab = setupTabs.some((tab) => tab.key === activeSetupTab)
    ? activeSetupTab
    : setupTabs[0]?.key;

  return (
    <View style={styles.studySetupCard}>
      <View style={styles.studySetupHeader}>
        <View style={styles.studySetupIcon}>
          <Ionicons name="map-outline" size={18} color="#ffffff" />
        </View>
        <View style={styles.studySetupCopy}>
          <ThemedText style={styles.studySetupTitle}>
            {t("study.setupTitle")}
          </ThemedText>
          <ThemedText style={styles.studySetupSubtitle}>
            {t("study.setupSubtitle")}
          </ThemedText>
        </View>
      </View>

      <View style={styles.studyModeSegment}>
        {modes.map((item) => {
          const selected = item.value === mode;
          return (
            <Pressable
              key={item.value}
              style={[
                styles.studyModeOption,
                selected && styles.studyModeOptionActive,
              ]}
              onPress={() => onModeChange(item.value)}
              disabled={disabled}
              accessibilityRole="button"
              accessibilityLabel={item.label}
            >
              <Ionicons
                name={item.icon}
                size={15}
                color={selected ? "#ffffff" : "#0f766e"}
              />
              <ThemedText
                style={[
                  styles.studyModeOptionText,
                  selected && styles.studyModeOptionTextActive,
                ]}
              >
                {item.label}
              </ThemedText>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.supportTabsCard}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.supportTabBar}
        >
          {setupTabs.map((tab) => {
            const selected = selectedSetupTab === tab.key;
            return (
              <Pressable
                key={tab.key}
                style={[styles.supportTab, selected && styles.supportTabActive]}
                onPress={() => setActiveSetupTab(tab.key)}
                accessibilityRole="button"
                accessibilityLabel={tab.label}
              >
                <Ionicons
                  name={tab.icon}
                  size={14}
                  color={selected ? palette.primary : palette.textMuted}
                />
                <ThemedText
                  style={[
                    styles.supportTabText,
                    selected && styles.supportTabTextActive,
                  ]}
                >
                  {tab.label}
                </ThemedText>
              </Pressable>
            );
          })}
        </ScrollView>

        <ScrollView
          style={styles.supportTabBodyScroll}
          contentContainerStyle={styles.supportTabBody}
          nestedScrollEnabled
        >
          {selectedSetupTab === "primer" && (
            <View style={styles.studySetupSectionCompact}>
              <ThemedText style={styles.studySetupSectionTitle}>
                {t("study.primerTitle")}
              </ThemedText>
              {content.primer.map((item) => (
                <View key={item} style={styles.studySetupBulletRow}>
                  <Ionicons name="checkmark-circle" size={15} color="#0f766e" />
                  <ThemedText style={styles.studySetupBodyText}>{item}</ThemedText>
                </View>
              ))}
            </View>
          )}

          {selectedSetupTab === "conceptMap" && (
            <View style={styles.studySetupSectionCompact}>
              <ThemedText style={styles.studySetupSectionTitle}>
                {t("study.conceptMapTitle")}
              </ThemedText>
              <View style={styles.conceptMapList}>
                {content.conceptMap.map((edge, index) => (
                  <View key={`${edge.from}-${edge.to}-${index}`} style={styles.conceptMapEdge}>
                    <ThemedText style={styles.conceptMapNode}>{edge.from}</ThemedText>
                    <View style={styles.conceptMapRelation}>
                      <Ionicons name="arrow-forward" size={12} color="#0f766e" />
                      <ThemedText style={styles.conceptMapRelationText}>
                        {edge.relation}
                      </ThemedText>
                    </View>
                    <ThemedText style={styles.conceptMapNode}>{edge.to}</ThemedText>
                  </View>
                ))}
              </View>
            </View>
          )}

          {selectedSetupTab === "example" && content.workedExample && (
            <View style={styles.studySetupSectionCompact}>
              <ThemedText style={styles.studySetupSectionTitle}>
                {content.workedExample.title}
              </ThemedText>
              {content.workedExample.steps.map((step, index) => (
                <View key={step} style={styles.studySetupStepRow}>
                  <View style={styles.studySetupStepNumber}>
                    <ThemedText style={styles.studySetupStepNumberText}>
                      {index + 1}
                    </ThemedText>
                  </View>
                  <ThemedText style={styles.studySetupBodyText}>{step}</ThemedText>
                </View>
              ))}
            </View>
          )}
        </ScrollView>
      </View>

      {(depthProgressItems.length > 0 || mistakeNotebook.length > 0) && (
        <StudyProgressTabs
          styles={styles}
          palette={palette}
          t={t}
          depthProgressItems={depthProgressItems}
          passScoreThreshold={passScoreThreshold}
          mistakeNotebook={mistakeNotebook}
          compact
        />
      )}

      <Pressable
        style={[styles.submitButton, disabled && styles.disabledButton]}
        onPress={onStart}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={t("study.startRecognition")}
      >
        <Ionicons name="options-outline" size={18} color="#fff" />
        <ThemedText style={styles.primaryButtonText}>
          {t("study.startRecognition")}
        </ThemedText>
      </Pressable>
    </View>
  );
}

function StudyProgressTabs({
  styles,
  palette,
  t,
  depthProgressItems,
  passScoreThreshold,
  mistakeNotebook,
  activeTab,
  onTabChange,
  compact = false,
}: {
  styles: StudyStyles;
  palette: typeof Colors.light;
  t: (key: string, params?: Record<string, any>) => string;
  depthProgressItems: StudyDepthProgressItem[];
  passScoreThreshold: number;
  mistakeNotebook: StudyMistakeNotebookItem[];
  activeTab?: StudyProgressTabKey;
  onTabChange?: (tab: StudyProgressTabKey) => void;
  compact?: boolean;
}) {
  const [internalTab, setInternalTab] = useState<StudyProgressTabKey>("mastery");
  const tabs: {
    key: StudyProgressTabKey;
    label: string;
    icon: keyof typeof Ionicons.glyphMap;
    count?: number;
  }[] = [
    ...(depthProgressItems.length > 0
      ? [{ key: "mastery" as const, label: t("study.masteryPathTitle"), icon: "analytics-outline" as const }]
      : []),
    ...(mistakeNotebook.length > 0
      ? [{ key: "review" as const, label: t("study.mistakeNotebookTitle"), icon: "bookmark-outline" as const, count: mistakeNotebook.length }]
      : []),
  ];
  const selectedTab = tabs.some((tab) => tab.key === (activeTab ?? internalTab))
    ? (activeTab ?? internalTab)
    : tabs[0]?.key;

  if (!selectedTab) return null;

  const handleTabChange = (tab: StudyProgressTabKey) => {
    setInternalTab(tab);
    onTabChange?.(tab);
  };

  return (
    <View style={[styles.supportTabsCard, compact && styles.supportTabsCardCompact]}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.supportTabBar}
      >
        {tabs.map((tab) => {
          const selected = selectedTab === tab.key;
          return (
            <Pressable
              key={tab.key}
              style={[styles.supportTab, selected && styles.supportTabActive]}
              onPress={() => handleTabChange(tab.key)}
              accessibilityRole="button"
              accessibilityLabel={tab.label}
            >
              <Ionicons
                name={tab.icon}
                size={14}
                color={selected ? palette.primary : palette.textMuted}
              />
              <ThemedText
                style={[
                  styles.supportTabText,
                  selected && styles.supportTabTextActive,
                ]}
              >
                {tab.label}
              </ThemedText>
              {tab.count !== undefined && (
                <View style={styles.supportTabBadge}>
                  <ThemedText style={styles.supportTabBadgeText}>
                    {tab.count > 9 ? "9+" : tab.count}
                  </ThemedText>
                </View>
              )}
            </Pressable>
          );
        })}
      </ScrollView>

      <ScrollView
        style={compact ? styles.supportTabBodyScrollCompact : styles.supportTabBodyScroll}
        contentContainerStyle={styles.supportTabBody}
        nestedScrollEnabled
      >
        {selectedTab === "mastery" && (
          <StudyDepthProgress
            styles={styles}
            palette={palette}
            t={t}
            items={depthProgressItems}
            passScoreThreshold={passScoreThreshold}
          />
        )}

        {selectedTab === "review" && (
          <View style={styles.mistakeNotebookContent}>
            <ThemedText style={styles.mistakeNotebookSubtitle}>
              {t("study.mistakeNotebookSubtitle")}
            </ThemedText>
            {mistakeNotebook.slice(0, 4).map((item) => (
              <View key={item.id} style={styles.mistakeNotebookItem}>
                <ThemedText style={styles.mistakeNotebookConcept}>
                  {item.concept}
                </ThemedText>
                <ThemedText style={styles.mistakeNotebookNote} numberOfLines={2}>
                  {item.note}
                </ThemedText>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function WarmupQuizCard({
  styles,
  t,
  question,
  selectedOptionIndex,
  loading,
  disabled,
  onSelectOption,
  onContinue,
}: {
  styles: StudyStyles;
  t: (key: string, params?: Record<string, any>) => string;
  question: StudyWarmupQuestion | null;
  selectedOptionIndex: number | null;
  loading: boolean;
  disabled: boolean;
  onSelectOption: (optionIndex: number) => void;
  onContinue: () => void;
}) {
  if (loading || !question) {
    return (
      <View style={styles.warmupCard}>
        <View style={styles.warmupHeader}>
          <View style={styles.warmupIcon}>
            <ActivityIndicator color="#ffffff" size="small" />
          </View>
          <View style={styles.warmupCopy}>
            <ThemedText style={styles.warmupTitle}>
              {t("study.warmupTitle")}
            </ThemedText>
            <ThemedText style={styles.warmupSubtitle}>
              {t("study.warmupLoadingSubtitle")}
            </ThemedText>
          </View>
        </View>
      </View>
    );
  }

  const hasAnswered = selectedOptionIndex !== null;
  const isCorrect = selectedOptionIndex === question.correctOptionIndex;

  return (
    <View style={styles.warmupCard}>
      <View style={styles.warmupHeader}>
        <View style={styles.warmupIcon}>
          <Ionicons name="options-outline" size={17} color="#ffffff" />
        </View>
        <View style={styles.warmupCopy}>
          <ThemedText style={styles.warmupTitle}>
            {t("study.warmupTitle")}
          </ThemedText>
          <ThemedText style={styles.warmupSubtitle}>
            {t("study.warmupSubtitle")}
          </ThemedText>
        </View>
      </View>
      <ThemedText style={styles.warmupQuestion}>
        {question.prompt}
      </ThemedText>
      <View style={styles.warmupOptions}>
        {question.options.map((option, index) => {
          const selected = selectedOptionIndex === index;
          const correct = hasAnswered && question.correctOptionIndex === index;
          const wrongSelection = hasAnswered && selected && !correct;
          return (
            <Pressable
              key={`${question.id}-${index}`}
              style={[
                styles.warmupOption,
                selected && styles.warmupOptionSelected,
                correct && styles.warmupOptionCorrect,
                wrongSelection && styles.warmupOptionWrong,
              ]}
              onPress={() => onSelectOption(index)}
              disabled={disabled || hasAnswered}
              accessibilityRole="button"
              accessibilityLabel={option}
            >
              <View style={styles.warmupOptionMarker}>
                <ThemedText style={styles.warmupOptionMarkerText}>
                  {String.fromCharCode(65 + index)}
                </ThemedText>
              </View>
              <ThemedText style={styles.warmupOptionText}>
                {option}
              </ThemedText>
              {correct && (
                <Ionicons name="checkmark-circle" size={18} color="#0f766e" />
              )}
              {wrongSelection && (
                <Ionicons name="close-circle" size={18} color="#dc2626" />
              )}
            </Pressable>
          );
        })}
      </View>
      {hasAnswered && (
        <View style={styles.warmupFeedback}>
          <ThemedText style={styles.warmupFeedbackTitle}>
            {isCorrect ? t("study.warmupCorrect") : t("study.warmupIncorrect")}
          </ThemedText>
          <ThemedText style={styles.warmupFeedbackText}>
            {question.explanation}
          </ThemedText>
        </View>
      )}
      <Pressable
        style={[
          styles.submitButton,
          (!hasAnswered || disabled) && styles.disabledButton,
        ]}
        onPress={onContinue}
        disabled={!hasAnswered || disabled}
        accessibilityRole="button"
        accessibilityLabel={t("study.warmupContinue")}
      >
        <Ionicons name="arrow-forward-circle" size={18} color="#fff" />
        <ThemedText style={styles.primaryButtonText}>
          {t("study.warmupContinue")}
        </ThemedText>
      </Pressable>
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
      <NativeTextInput
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
