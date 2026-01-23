import { Ionicons } from "@expo/vector-icons";
import { RefObject } from "react";
import {
  ActivityIndicator,
  LayoutChangeEvent,
  Pressable,
  ScrollView,
  TextInput,
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
import { ThemedText } from "@/components/themed-text";
import { Colors } from "@/constants/theme";
import {
  CanvasAnswerMarker,
  CanvasBounds,
  CanvasPage,
  CanvasStrokeData,
  CanvasVisualBlock as CanvasVisualBlockType,
  StudyPlanEntry,
} from "@/types";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type StudyCanvasPanelProps = {
  styles: StudyStyles;
  palette: typeof Colors.light;
  t: (key: string, params?: Record<string, any>) => string;
  tutorCollapsed: boolean;
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
};

export function StudyCanvasPanel({
  styles,
  palette,
  t,
  tutorCollapsed,
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
}: StudyCanvasPanelProps) {
  return (
    <View
      style={[
        styles.canvasColumn,
        tutorCollapsed && styles.canvasColumnFullscreen,
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
        </View>

        {studyPlanEntry && (
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

        <ThemedText style={{ marginBottom: 8, color: "#64748b" }}>
          {studyOutline}
        </ThemedText>

        <ThemedText
          type="defaultSemiBold"
          style={{ marginTop: 12, marginBottom: 8 }}
        >
          {t("study.canvasTitle")}
        </ThemedText>

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
              width={300}
              height={40}
              strokeColor={canvasColor}
              strokeWidth={2}
              initialStrokes={activePage?.titleStrokes}
              onStrokesChange={onTitleStrokesChange}
            />
          </View>
        </View>

        <CanvasToolbar
          mode={canvasMode}
          color={canvasColor}
          onModeChange={onCanvasModeChange}
          onColorChange={onCanvasColorChange}
          onClear={onClearCanvas}
          onUndo={onUndo}
        />

        <View style={styles.canvasScrollShell}>
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
        <TextInput
          style={styles.input}
          placeholder={t("study.notesPlaceholder")}
          placeholderTextColor="#94a3b8"
          multiline
          value={answerText}
          onChangeText={onNotesChange}
        />
      </ScrollView>
    </View>
  );
}
