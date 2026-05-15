import { Ionicons } from "@expo/vector-icons";
import { RefObject, useMemo, useState } from "react";
import {
  ActivityIndicator,
  LayoutChangeEvent,
  Modal,
  Pressable,
  ScrollView,
  View,
  ViewStyle,
} from "react-native";
import Animated, { AnimatedStyle } from "react-native-reanimated";

import { CanvasToolbar } from "@/components/canvas-toolbar";
import { CanvasVisualBlock } from "@/components/canvas-visual-block";
import {
  CanvasMode,
  CanvasStroke,
  HandwritingCanvas,
  HandwritingCanvasHandle,
} from "@/components/handwriting-canvas";
import { StudyStyles } from "@/components/study/study-styles";
import {
  StudyDepthProgress,
  StudyDepthProgressItem,
} from "@/components/study/study-depth-progress";
import { ThemedText } from "@/components/themed-text";
import { NativeTextInput } from "@/components/ui/native-primitives";
import { Colors } from "@/constants/theme";
import {
  CanvasAnswerMarker,
  CanvasBounds,
  CanvasPage,
  CanvasStrokeData,
  CanvasVisualBlock as CanvasVisualBlockType,
  StudyCitation,
  StudyPlanEntry,
} from "@/types";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type StudyCanvasPanelProps = {
  styles: StudyStyles;
  palette: typeof Colors.light;
  t: (key: string, params?: Record<string, any>) => string;
  tutorCollapsed: boolean;
  secondaryWorkspace?: boolean;
  lockedAnswerMode?: boolean;
  toggleTutor: () => void;
  studyTitle: string;
  studyOutline: string;
  studyPlanEntry: StudyPlanEntry | null;
  canvasPages: CanvasPage[];
  activePageId: string;
  activePage?: CanvasPage;
  canvasSize: { width: number; height: number };
  canvasMode: CanvasMode;
  canvasColor: string;
  onCanvasModeChange: (mode: CanvasMode) => void;
  onCanvasColorChange: (color: string) => void;
  onClearCanvas: () => void;
  onUndo: () => void;
  onAddPage: () => void;
  onSelectPage: (pageId: string) => void;
  onTitleStrokesChange: (strokes: CanvasStroke[]) => void;
  titleCanvasRef: RefObject<HandwritingCanvasHandle | null>;
  canvasRef: RefObject<HandwritingCanvasHandle | null>;
  pageScrollRef: RefObject<ScrollView | null>;
  canvasScrollRef: RefObject<ScrollView | null>;
  canvasHScrollRef: RefObject<ScrollView | null>;
  scrollEnabled: boolean;
  onDrawingStart: () => void;
  onDrawingEnd: (lastPosition?: { x: number; y: number }) => void;
  initialCanvasStrokes?: CanvasStrokeData[];
  onCanvasStrokesChange: (strokes: CanvasStroke[]) => void;
  activeVisualBlocks: CanvasVisualBlockType[];
  highlightedVisualBlockId: string | null;
  onHighlightVisualBlock: (blockId: string | null) => void;
  highlightedAnswerLinkId: string | null;
  highlightedBounds: CanvasBounds | null;
  onCanvasLayout: (event: LayoutChangeEvent) => void;
  checkButtonPosition: { top: number; left: number } | null;
  checkButtonAnimatedStyle: AnimatedStyle<ViewStyle>;
  lastDrawingPosition: { x: number; y: number } | null;
  onSubmitAnswer: () => void;
  grading: boolean;
  answerMarkers: CanvasAnswerMarker[];
  onMarkerPress: (messageId: string) => void;
  answerText: string;
  onNotesChange: (text: string) => void;
  references: {
    key: string;
    citation: StudyCitation;
    label: string;
    sourceLabel: string;
  }[];
  onOpenCitation: (citation: StudyCitation) => void;
  depthProgressItems: StudyDepthProgressItem[];
  recallHintText?: string | null;
  recallHintRevealed?: boolean;
  onRevealRecallHint: () => void;
};

export function StudyCanvasPanel({
  styles,
  palette,
  t,
  tutorCollapsed,
  secondaryWorkspace = false,
  lockedAnswerMode = false,
  toggleTutor,
  studyTitle,
  studyOutline,
  studyPlanEntry,
  canvasPages,
  activePageId,
  activePage,
  canvasSize,
  canvasMode,
  canvasColor,
  onCanvasModeChange,
  onCanvasColorChange,
  onClearCanvas,
  onUndo,
  onAddPage,
  onSelectPage,
  onTitleStrokesChange,
  titleCanvasRef,
  canvasRef,
  pageScrollRef,
  canvasScrollRef,
  canvasHScrollRef,
  scrollEnabled,
  onDrawingStart,
  onDrawingEnd,
  initialCanvasStrokes,
  onCanvasStrokesChange,
  activeVisualBlocks,
  highlightedVisualBlockId,
  onHighlightVisualBlock,
  highlightedAnswerLinkId,
  highlightedBounds,
  onCanvasLayout,
  checkButtonPosition,
  checkButtonAnimatedStyle,
  lastDrawingPosition,
  onSubmitAnswer,
  grading,
  answerMarkers,
  onMarkerPress,
  answerText,
  onNotesChange,
  references,
  onOpenCitation,
  depthProgressItems,
  recallHintText = null,
  recallHintRevealed = false,
  onRevealRecallHint,
}: StudyCanvasPanelProps) {
  const [referencesOpen, setReferencesOpen] = useState(false);
  const visibleReferences = useMemo(() => references.slice(0, 4), [references]);
  const referenceCountLabel =
    references.length > 0
      ? t("study.referencesCount", { count: references.length })
      : t("study.referencesEmpty");

  return (
    <View
      style={[
        styles.canvasColumn,
        tutorCollapsed && styles.canvasColumnFullscreen,
        secondaryWorkspace && styles.canvasColumnSecondary,
      ]}
    >
      <ScrollView
        ref={pageScrollRef}
        contentContainerStyle={styles.canvasArea}
        scrollEnabled={scrollEnabled}
        showsVerticalScrollIndicator
      >
        <View style={styles.canvasHeader}>
          <ThemedText type="title" style={styles.canvasTitle}>
            {studyTitle}
          </ThemedText>
          {!lockedAnswerMode && (
            <Pressable
              style={[
                styles.tutorToggleButton,
                tutorCollapsed && styles.tutorToggleButtonCollapsed,
              ]}
              onPress={toggleTutor}
              accessibilityLabel={
                tutorCollapsed ? t("study.showTutor") : t("study.hideTutor")
              }
              accessibilityRole="button"
            >
              <Ionicons
                name={tutorCollapsed ? "chatbubbles" : "chevron-forward"}
                size={20}
                color={tutorCollapsed ? "#10b981" : palette.textMuted}
              />
              {tutorCollapsed && (
                <ThemedText style={styles.tutorToggleText}>
                  {t("study.showTutor")}
                </ThemedText>
              )}
            </Pressable>
          )}
        </View>

        {lockedAnswerMode && (
          <View style={styles.answerModeBanner}>
            <View style={styles.answerModeBannerIcon}>
              <Ionicons name="eye-off-outline" size={16} color="#ffffff" />
            </View>
            <ThemedText style={styles.answerModeBannerText}>
              {t("study.answerModeLocked")}
            </ThemedText>
            <Pressable
              style={styles.referenceSummaryButton}
              onPress={() => setReferencesOpen(true)}
              accessibilityRole="button"
              accessibilityLabel={t("study.referencesTitle")}
            >
              <Ionicons name="library-outline" size={15} color={palette.primary} />
              <ThemedText style={styles.referenceSummaryText}>
                {referenceCountLabel}
              </ThemedText>
            </Pressable>
          </View>
        )}

        {lockedAnswerMode && recallHintText && (
          <View style={styles.socraticHintCard}>
            <View style={styles.socraticHintHeader}>
              <View style={styles.socraticHintIcon}>
                <Ionicons name="bulb-outline" size={15} color="#ffffff" />
              </View>
              <View style={styles.socraticHintCopy}>
                <ThemedText style={styles.socraticHintTitle}>
                  {t("study.socraticHintTitle")}
                </ThemedText>
                <ThemedText style={styles.socraticHintSubtitle}>
                  {t("study.socraticHintSubtitle")}
                </ThemedText>
              </View>
              {!recallHintRevealed && (
                <Pressable
                  style={styles.socraticHintButton}
                  onPress={onRevealRecallHint}
                  accessibilityRole="button"
                  accessibilityLabel={t("study.showHint")}
                >
                  <Ionicons name="eye-outline" size={14} color={palette.warning} />
                  <ThemedText style={styles.socraticHintButtonText}>
                    {t("study.showHint")}
                  </ThemedText>
                </Pressable>
              )}
            </View>
            {recallHintRevealed && (
              <ThemedText style={styles.socraticHintText}>
                {recallHintText}
              </ThemedText>
            )}
          </View>
        )}

        {!lockedAnswerMode && studyPlanEntry && (
          <View style={styles.topicFocusBadge}>
            <Ionicons name="locate" size={14} color="#10b981" />
            <ThemedText style={styles.topicFocusText}>
              {t("study.focusBadge", {
                concepts:
                  studyPlanEntry.keyConcepts?.slice(0, 3).join(", ") ||
                  t("study.focusConceptsFallback"),
              })}
            </ThemedText>
          </View>
        )}

        {studyPlanEntry && depthProgressItems.length > 0 && (
          <StudyDepthProgress
            styles={styles}
            palette={palette}
            t={t}
            items={depthProgressItems}
          />
        )}

        {!lockedAnswerMode && (
          <ThemedText style={{ marginBottom: 8, color: "#64748b" }}>
            {studyOutline}
          </ThemedText>
        )}

        <View style={styles.workspaceRail}>
          <View style={styles.workspaceRailHeader}>
            <View style={styles.workspaceTitleStack}>
              <ThemedText type="defaultSemiBold" style={styles.workspaceTitle}>
                {t("study.canvasTitle")}
              </ThemedText>
              <ThemedText style={styles.workspaceSubtitle}>
                {activePage
                  ? t("study.pageLabel", {
                      number:
                        canvasPages.findIndex((page) => page.id === activePage.id) + 1,
                    })
                  : t("study.pageLabel", { number: 1 })}
              </ThemedText>
            </View>
            <Pressable
              style={styles.referencesButton}
              onPress={() => setReferencesOpen(true)}
              accessibilityRole="button"
              accessibilityLabel={t("study.referencesTitle")}
            >
              <Ionicons name="library-outline" size={16} color={palette.primary} />
              <ThemedText style={styles.referencesButtonText}>
                {referenceCountLabel}
              </ThemedText>
            </Pressable>
          </View>

          <View style={styles.pageNavContainer}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.pageTabsContent}
            >
              {canvasPages.map((page, index) => (
                <Pressable
                  key={page.id}
                  style={[
                    styles.pageTab,
                    page.id === activePageId && styles.pageTabActive,
                  ]}
                  onPress={() => onSelectPage(page.id)}
                >
                  {page.titleStrokes.length > 0 ? (
                    <View style={styles.pageTitlePreview}>
                      <HandwritingCanvas
                        width={60}
                        height={20}
                        initialStrokes={page.titleStrokes}
                        mode="pen"
                        readOnly
                      />
                    </View>
                  ) : (
                    <ThemedText
                      style={[
                        styles.pageTabText,
                        page.id === activePageId && styles.pageTabTextActive,
                      ]}
                    >
                      {t("study.pageLabel", { number: index + 1 })}
                    </ThemedText>
                  )}
                </Pressable>
              ))}
              <Pressable style={styles.addPageButton} onPress={onAddPage}>
                <Ionicons name="add" size={20} color="#10b981" />
              </Pressable>
            </ScrollView>
          </View>

          <View style={styles.pageTitleContainer}>
            <ThemedText style={styles.pageTitleLabel}>
              {t("study.pageTitleLabel")}
            </ThemedText>
            <View style={styles.pageTitleCanvasWrapper}>
              <HandwritingCanvas
                key={activePage?.id ? `${activePage.id}-title` : "title-default"}
                ref={titleCanvasRef}
                width={260}
                height={34}
                strokeColor={canvasColor}
                strokeWidth={2}
                initialStrokes={activePage?.titleStrokes}
                onStrokesChange={onTitleStrokesChange}
              />
            </View>
          </View>

          {visibleReferences.length > 0 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.referenceStrip}
            >
              {visibleReferences.map((item) => (
                <Pressable
                  key={item.key}
                  style={styles.referenceChip}
                  onPress={() => onOpenCitation(item.citation)}
                  accessibilityRole="button"
                >
                  <ThemedText style={styles.referenceChipSource}>
                    {item.sourceLabel}
                  </ThemedText>
                  <ThemedText
                    style={styles.referenceChipText}
                    numberOfLines={1}
                    ellipsizeMode="middle"
                  >
                    {item.label}
                  </ThemedText>
                </Pressable>
              ))}
            </ScrollView>
          )}
        </View>

        <View style={styles.canvasScrollShell}>
          {grading && (
            <View style={styles.gradingCanvasOverlay} pointerEvents="auto">
              <View style={styles.gradingCanvasCard}>
                <View style={styles.gradingCanvasIcon}>
                  <ActivityIndicator color="#0f172a" size="small" />
                </View>
                <View style={styles.gradingCanvasCopy}>
                  <ThemedText style={styles.gradingCanvasTitle}>
                    {t("study.gradingPanelTitle")}
                  </ThemedText>
                  <ThemedText style={styles.gradingCanvasSubtitle}>
                    {t("study.gradingPanelSubtitle")}
                  </ThemedText>
                </View>
              </View>
            </View>
          )}
          <ScrollView
            ref={canvasHScrollRef}
            horizontal
            scrollEnabled={scrollEnabled}
            showsHorizontalScrollIndicator
            contentContainerStyle={{ paddingBottom: 4 }}
          >
            <ScrollView
              ref={canvasScrollRef}
              scrollEnabled={scrollEnabled}
              showsVerticalScrollIndicator
              contentContainerStyle={styles.canvasInnerVertical}
            >
              <View
                style={[
                  styles.canvasWrapper,
                  { width: canvasSize.width, height: canvasSize.height },
                ]}
                onLayout={onCanvasLayout}
              >
                {highlightedAnswerLinkId && (
                  <View
                    style={[
                      styles.canvasHighlight,
                      highlightedBounds
                        ? {
                            top: highlightedBounds.y,
                            left: highlightedBounds.x,
                            width: highlightedBounds.width,
                            height: highlightedBounds.height,
                          }
                        : styles.canvasHighlightFull,
                      styles.canvasHighlightActive,
                    ]}
                    pointerEvents="none"
                  />
                )}
                <HandwritingCanvas
                  key={activePage?.id || "canvas-default"}
                  ref={canvasRef}
                  width={canvasSize.width}
                  height={canvasSize.height}
                  strokeColor={canvasColor}
                  onDrawingStart={onDrawingStart}
                  onDrawingEnd={onDrawingEnd}
                  initialStrokes={initialCanvasStrokes}
                  onStrokesChange={onCanvasStrokesChange}
                />

                {activeVisualBlocks.map((block) => (
                  <CanvasVisualBlock
                    key={block.id}
                    block={block}
                    highlighted={highlightedVisualBlockId === block.id}
                    onPress={(blockId) => {
                      onHighlightVisualBlock(blockId);
                      setTimeout(() => onHighlightVisualBlock(null), 2000);
                    }}
                  />
                ))}

                {lastDrawingPosition && (
                  <AnimatedPressable
                    style={[
                      styles.checkAnswerButton,
                      checkButtonAnimatedStyle,
                      checkButtonPosition && {
                        top: checkButtonPosition.top,
                        left: checkButtonPosition.left,
                      },
                    ]}
                    onPress={onSubmitAnswer}
                    disabled={grading}
                  >
                    {grading ? (
                      <ActivityIndicator color="#fff" size="small" />
                    ) : (
                      <>
                        <Ionicons
                          name="checkmark-circle"
                          size={20}
                          color="#fff"
                        />
                        <ThemedText style={styles.checkAnswerButtonText}>
                          {t("study.checkAnswer")}
                        </ThemedText>
                      </>
                    )}
                  </AnimatedPressable>
                )}
              </View>
            </ScrollView>
          </ScrollView>
        </View>

        {answerMarkers.length > 0 && (
          <View style={styles.answerMarkersContainer}>
            <ThemedText type="defaultSemiBold" style={styles.markersTitle}>
              {t("study.answerSectionTitle")}
            </ThemedText>
            <View style={styles.markersList}>
              {answerMarkers.map((marker) => (
                <Pressable
                  key={`${marker.answerLinkId}-${marker.messageId}`}
                  style={[
                    styles.markerBadge,
                    highlightedAnswerLinkId === marker.answerLinkId &&
                      styles.markerBadgeHighlighted,
                  ]}
                  onPress={() => onMarkerPress(marker.messageId)}
                >
                  <ThemedText style={styles.markerBadgeText}>
                    Q{marker.questionIndex}
                  </ThemedText>
                  <Ionicons
                    name="chatbubble-outline"
                    size={12}
                    color="#10b981"
                  />
                </Pressable>
              ))}
            </View>
          </View>
        )}

        <ThemedText type="defaultSemiBold" style={{ marginTop: 16 }}>
          {t("study.typedNotes")}
        </ThemedText>
        <NativeTextInput
          style={styles.input}
          placeholder={t("study.notesPlaceholder")}
          placeholderTextColor="#94a3b8"
          multiline
          value={answerText}
          onChangeText={onNotesChange}
        />
      </ScrollView>
      <View pointerEvents="box-none" style={styles.floatingToolDock}>
        <CanvasToolbar
          mode={canvasMode}
          color={canvasColor}
          onModeChange={onCanvasModeChange}
          onColorChange={onCanvasColorChange}
          onClear={onClearCanvas}
          onUndo={onUndo}
          variant="floating"
        />
      </View>
      <Modal
        visible={referencesOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setReferencesOpen(false)}
      >
        <Pressable
          style={styles.referencesModalBackdrop}
          onPress={() => setReferencesOpen(false)}
        >
          <Pressable style={styles.referencesModal} onPress={() => undefined}>
            <View style={styles.referencesModalHeader}>
              <View>
                <ThemedText type="defaultSemiBold" style={styles.referencesModalTitle}>
                  {t("study.referencesTitle")}
                </ThemedText>
                <ThemedText style={styles.referencesModalSubtitle}>
                  {referenceCountLabel}
                </ThemedText>
              </View>
              <Pressable
                style={styles.referencesCloseButton}
                onPress={() => setReferencesOpen(false)}
                accessibilityRole="button"
                accessibilityLabel={t("common.close")}
              >
                <Ionicons name="close" size={18} color={palette.text} />
              </Pressable>
            </View>
            {references.length > 0 ? (
              <ScrollView contentContainerStyle={styles.referencesModalList}>
                {references.map((item) => (
                  <Pressable
                    key={item.key}
                    style={styles.referenceModalRow}
                    onPress={() => {
                      setReferencesOpen(false);
                      onOpenCitation(item.citation);
                    }}
                    accessibilityRole="button"
                  >
                    <View style={styles.referenceModalIcon}>
                      <Ionicons
                        name="document-text-outline"
                        size={16}
                        color={palette.primary}
                      />
                    </View>
                    <View style={styles.referenceModalTextStack}>
                      <ThemedText style={styles.referenceModalSource}>
                        {item.sourceLabel}
                      </ThemedText>
                      <ThemedText style={styles.referenceModalLabel}>
                        {item.label}
                      </ThemedText>
                    </View>
                    <Ionicons
                      name="open-outline"
                      size={16}
                      color={palette.textMuted}
                    />
                  </Pressable>
                ))}
              </ScrollView>
            ) : (
              <View style={styles.referencesEmptyState}>
                <Ionicons
                  name="library-outline"
                  size={24}
                  color={palette.textMuted}
                />
                <ThemedText style={styles.referencesEmptyText}>
                  {t("study.referencesEmptyLong")}
                </ThemedText>
              </View>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}
