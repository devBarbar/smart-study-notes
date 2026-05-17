import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle, G, Rect, Text as SvgText } from 'react-native-svg';

import { ThemedText } from '@/components/themed-text';
import { Colors, Radii, Shadows } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
  BulletData,
  CanvasFeedbackBlockData,
  CanvasVisualBlock as CanvasVisualBlockType,
  DefinitionData,
  DiagramData,
  StepData,
} from '@/types';

import { CanvasDiagram } from './canvas-diagram';
import {
  getCanvasFeedbackToneColor,
  normalizeCanvasFeedbackBlockData,
} from '@/lib/study/canvas-feedback';

// Constants for rendering
const BULLET_LINE_HEIGHT = 28;
const STEP_HEIGHT = 60;
const PADDING = 16;

type Props = {
  block: CanvasVisualBlockType;
  onPress?: (blockId: string) => void;
  highlighted?: boolean;
  t?: (key: string, params?: Record<string, any>) => string;
};

/**
 * Renders a bullet list as SVG
 */
const BulletListRenderer: React.FC<{
  data: BulletData;
  position: { x: number; y: number };
}> = ({ data, position }) => {
  const itemCount = data.items.length;
  const titleHeight = data.title ? 36 : 0;
  const height = titleHeight + itemCount * BULLET_LINE_HEIGHT + PADDING * 2;
  const width = 320;

  return (
    <View style={styles.blockContainer}>
      <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        {/* Background */}
        <Rect
          x={0}
          y={0}
          width={width}
          height={height}
          rx={12}
          fill="#f8fafc"
          stroke="#e2e8f0"
          strokeWidth={1}
        />

        {/* Title */}
        {data.title && (
          <SvgText
            x={PADDING}
            y={28}
            fontSize={16}
            fontWeight="600"
            fill="#1e293b"
          >
            {data.title}
          </SvgText>
        )}

        {/* Bullet items */}
        <G transform={`translate(0 ${titleHeight})`}>
          {data.items.map((item, index) => {
            const indent = (item.indent ?? 0) * 20;
            const y = PADDING + index * BULLET_LINE_HEIGHT + 14;
            const bulletX = PADDING + indent;
            const textX = bulletX + 20;

            // Render bullet icon
            let bulletIcon: React.ReactElement;
            switch (item.icon) {
              case 'check':
                bulletIcon = (
                  <SvgText x={bulletX} y={y} fontSize={14} fill="#22c55e">
                    ✓
                  </SvgText>
                );
                break;
              case 'arrow':
                bulletIcon = (
                  <SvgText x={bulletX} y={y} fontSize={14} fill="#0ea5e9">
                    →
                  </SvgText>
                );
                break;
              case 'number':
                bulletIcon = (
                  <SvgText x={bulletX} y={y} fontSize={13} fill="#64748b" fontWeight="600">
                    {index + 1}.
                  </SvgText>
                );
                break;
              case 'bullet':
              default:
                bulletIcon = (
                  <Circle cx={bulletX + 4} cy={y - 4} r={3} fill="#64748b" />
                );
            }

            return (
              <G key={`item-${index}`}>
                {bulletIcon}
                <SvgText
                  x={textX}
                  y={y}
                  fontSize={14}
                  fill="#334155"
                >
                  {item.text.length > 40 ? item.text.slice(0, 40) + '...' : item.text}
                </SvgText>
              </G>
            );
          })}
        </G>
      </Svg>
    </View>
  );
};

/**
 * Renders a definition card as SVG
 */
const DefinitionRenderer: React.FC<{
  data: DefinitionData;
  position: { x: number; y: number };
}> = ({ data, position }) => {
  const width = 350;
  const termHeight = 40;
  const defLines = Math.ceil(data.definition.length / 45);
  const exampleLines = data.example ? Math.ceil(data.example.length / 45) : 0;
  const lineHeight = 20;
  const height = termHeight + defLines * lineHeight + exampleLines * lineHeight + PADDING * 2 + (data.example ? 20 : 0);

  // Wrap text helper
  const wrapText = (text: string, maxChars: number = 45): string[] => {
    const words = text.split(' ');
    const lines: string[] = [];
    let currentLine = '';

    for (const word of words) {
      if ((currentLine + ' ' + word).trim().length <= maxChars) {
        currentLine = (currentLine + ' ' + word).trim();
      } else {
        if (currentLine) lines.push(currentLine);
        currentLine = word;
      }
    }
    if (currentLine) lines.push(currentLine);
    return lines;
  };

  const defTextLines = wrapText(data.definition);
  const exampleTextLines = data.example ? wrapText(data.example) : [];

  return (
    <View style={styles.blockContainer}>
      <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        {/* Background with accent border */}
        <Rect
          x={0}
          y={0}
          width={width}
          height={height}
          rx={12}
          fill="#eff6ff"
          stroke="#3b82f6"
          strokeWidth={2}
        />

        {/* Term */}
        <SvgText
          x={PADDING}
          y={PADDING + 20}
          fontSize={18}
          fontWeight="700"
          fill="#1e40af"
        >
          {data.term}
        </SvgText>

        {/* Definition */}
        <G transform={`translate(0 ${termHeight})`}>
          {defTextLines.map((line, index) => (
            <SvgText
              key={`def-${index}`}
              x={PADDING}
              y={PADDING + index * lineHeight}
              fontSize={14}
              fill="#334155"
            >
              {line}
            </SvgText>
          ))}
        </G>

        {/* Example (if present) */}
        {data.example && (
          <G transform={`translate(0 ${termHeight + defLines * lineHeight + 10})`}>
            <SvgText
              x={PADDING}
              y={PADDING}
              fontSize={12}
              fontWeight="600"
              fill="#64748b"
            >
              Example:
            </SvgText>
            {exampleTextLines.map((line, index) => (
              <SvgText
                key={`ex-${index}`}
                x={PADDING}
                y={PADDING + 16 + index * lineHeight}
                fontSize={13}
                fill="#475569"
                fontStyle="italic"
              >
                {line}
              </SvgText>
            ))}
          </G>
        )}
      </Svg>
    </View>
  );
};

/**
 * Renders a step-by-step card as SVG
 */
const StepsRenderer: React.FC<{
  data: StepData;
  position: { x: number; y: number };
}> = ({ data, position }) => {
  const width = 400;
  const titleHeight = data.title ? 40 : 0;
  const height = titleHeight + data.steps.length * STEP_HEIGHT + PADDING * 2;

  return (
    <View style={styles.blockContainer}>
      <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        {/* Background */}
        <Rect
          x={0}
          y={0}
          width={width}
          height={height}
          rx={12}
          fill="#fafafa"
          stroke="#e5e5e5"
          strokeWidth={1}
        />

        {/* Title */}
        {data.title && (
          <SvgText
            x={PADDING}
            y={28}
            fontSize={16}
            fontWeight="600"
            fill="#1e293b"
          >
            {data.title}
          </SvgText>
        )}

        {/* Steps */}
        <G transform={`translate(0 ${titleHeight})`}>
          {data.steps.map((step, index) => {
            const y = PADDING + index * STEP_HEIGHT;
            const circleY = y + 20;

            return (
              <G key={`step-${index}`}>
                {/* Step number circle */}
                <Circle
                  cx={PADDING + 16}
                  cy={circleY}
                  r={14}
                  fill="#10b981"
                />
                <SvgText
                  x={PADDING + 16}
                  y={circleY + 5}
                  fontSize={14}
                  fontWeight="700"
                  fill="white"
                  textAnchor="middle"
                >
                  {step.number}
                </SvgText>

                {/* Step title */}
                <SvgText
                  x={PADDING + 44}
                  y={circleY + 5}
                  fontSize={15}
                  fontWeight="600"
                  fill="#1e293b"
                >
                  {step.title.length > 35 ? step.title.slice(0, 35) + '...' : step.title}
                </SvgText>

                {/* Step description (if present) */}
                {step.description && (
                  <SvgText
                    x={PADDING + 44}
                    y={circleY + 24}
                    fontSize={12}
                    fill="#64748b"
                  >
                    {step.description.length > 50 ? step.description.slice(0, 50) + '...' : step.description}
                  </SvgText>
                )}

                {/* Connector line to next step */}
                {index < data.steps.length - 1 && (
                  <Rect
                    x={PADDING + 14}
                    y={circleY + 16}
                    width={4}
                    height={STEP_HEIGHT - 32}
                    fill="#d1fae5"
                    rx={2}
                  />
                )}
              </G>
            );
          })}
        </G>
      </Svg>
    </View>
  );
};

const FeedbackRenderer: React.FC<{
  data: CanvasFeedbackBlockData;
  width?: number;
  t?: (key: string, params?: Record<string, any>) => string;
}> = ({ data, width = 520, t }) => {
  const safeData = normalizeCanvasFeedbackBlockData(data);
  const toneColor = getCanvasFeedbackToneColor(safeData.status);
  const softColor = safeData.status === 'passed' ? '#dcfce7' : '#fee2e2';
  const title =
    safeData.status === 'passed'
      ? t?.('study.feedback.canvasPassed') ?? 'Tutor feedback: passed'
      : t?.('study.feedback.canvasFailed') ?? 'Tutor feedback: needs work';
  const scoreLabel = typeof safeData.score === 'number' ? `${Math.round(safeData.score)}/100` : null;
  const sections = [
    {
      title: t?.('study.feedback.canvasWhatWentRight') ?? 'What you did right',
      items: safeData.whatWentRight,
      color: '#16a34a',
    },
    {
      title: t?.('study.feedback.canvasWhatToFix') ?? 'What to fix',
      items: safeData.whatWentWrong,
      color: '#dc2626',
    },
  ].filter((section) => section.items.length > 0);

  return (
    <View
      testID={`canvas-feedback-${safeData.status}`}
      style={[
        styles.feedbackCard,
        { width, borderColor: toneColor, backgroundColor: softColor },
      ]}
    >
      <View style={styles.feedbackHeader}>
        <View style={[styles.feedbackStatusDot, { backgroundColor: toneColor }]} />
        <ThemedText style={[styles.feedbackTitle, { color: toneColor }]}>
          {title}
        </ThemedText>
        {scoreLabel && (
          <ThemedText style={[styles.feedbackScore, { color: toneColor }]}>
            {scoreLabel}
          </ThemedText>
        )}
      </View>
      <ThemedText style={styles.feedbackSummary}>{safeData.summary}</ThemedText>
      {sections.map((section) => (
        <View key={section.title} style={styles.feedbackSection}>
          <ThemedText style={[styles.feedbackSectionTitle, { color: section.color }]}>
            {section.title}
          </ThemedText>
          {section.items.map((item) => (
            <ThemedText key={item} style={styles.feedbackBullet}>
              {`\u2022 ${item}`}
            </ThemedText>
          ))}
        </View>
      ))}
      {safeData.correctAnswer && (
        <View style={styles.feedbackSection}>
          <ThemedText style={styles.feedbackSectionTitle}>
            {t?.('study.feedback.canvasCorrectAnswer') ?? 'Correct answer'}
          </ThemedText>
          <ThemedText style={styles.feedbackBody}>{safeData.correctAnswer}</ThemedText>
        </View>
      )}
      {safeData.rewriteExample && (
        <View style={styles.feedbackSection}>
          <ThemedText style={styles.feedbackSectionTitle}>
            {t?.('study.feedback.canvasRewriteExample') ?? 'A stronger answer'}
          </ThemedText>
          <ThemedText style={styles.feedbackBody}>{safeData.rewriteExample}</ThemedText>
        </View>
      )}
    </View>
  );
};

/**
 * Main container component that renders any type of visual block
 */
export const CanvasVisualBlock: React.FC<Props> = ({ block, onPress, highlighted, t }) => {
  const colorScheme = useColorScheme();
  const palette = Colors[colorScheme === 'dark' ? 'dark' : 'light'];

  const handlePress = () => {
    onPress?.(block.id);
  };

  const renderContent = () => {
    switch (block.type) {
      case 'diagram':
        return (
          <CanvasDiagram
            data={block.data as DiagramData}
            position={{ x: 0, y: 0 }}
          />
        );
      case 'bullets':
        return (
          <BulletListRenderer
            data={block.data as BulletData}
            position={{ x: 0, y: 0 }}
          />
        );
      case 'definition':
        return (
          <DefinitionRenderer
            data={block.data as DefinitionData}
            position={{ x: 0, y: 0 }}
          />
        );
      case 'steps':
        return (
          <StepsRenderer
            data={block.data as StepData}
            position={{ x: 0, y: 0 }}
          />
        );
      case 'feedback':
        return (
          <FeedbackRenderer
            data={block.data as CanvasFeedbackBlockData}
            width={block.size?.width}
            t={t}
          />
        );
      default:
        return (
          <View style={styles.unknownBlock}>
            <ThemedText>Unknown visual block type</ThemedText>
          </View>
        );
    }
  };

  return (
    <Pressable
      onPress={handlePress}
      style={[
        styles.wrapper,
        {
          transform: [
            { translateX: block.position.x },
            { translateY: block.position.y },
          ],
        },
        highlighted && [styles.highlighted, { borderColor: palette.primary }],
      ]}
    >
      {renderContent()}
    </Pressable>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
  },
  blockContainer: {
    // No position: 'absolute' here - the wrapper handles positioning
    ...Shadows.sm,
  },
  highlighted: {
    borderWidth: 3,
    borderRadius: Radii.lg,
  },
  unknownBlock: {
    padding: PADDING,
    backgroundColor: '#fee2e2',
    borderRadius: Radii.md,
    borderWidth: 1,
    borderColor: '#fecaca',
  },
  feedbackCard: {
    padding: 18,
    borderRadius: Radii.md,
    borderWidth: 2,
    gap: 10,
    ...Shadows.sm,
  },
  feedbackHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  feedbackStatusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  feedbackTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: '800',
  },
  feedbackScore: {
    fontSize: 14,
    fontWeight: '900',
  },
  feedbackSummary: {
    color: '#0f172a',
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
  },
  feedbackSection: {
    gap: 4,
  },
  feedbackSectionTitle: {
    color: '#334155',
    fontSize: 13,
    fontWeight: '900',
  },
  feedbackBullet: {
    color: '#1e293b',
    fontSize: 13,
    lineHeight: 19,
  },
  feedbackBody: {
    color: '#1e293b',
    fontSize: 13,
    lineHeight: 19,
  },
});

export default CanvasVisualBlock;
