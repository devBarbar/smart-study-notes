import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle, G, Rect, Text as SvgText } from 'react-native-svg';

import { ThemedText } from '@/components/themed-text';
import { Colors, Radii, Shadows } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
  BulletData,
  CanvasVisualBlock as CanvasVisualBlockType,
  DefinitionData,
  DiagramData,
  StepData,
} from '@/types';

import { CanvasDiagram } from './canvas-diagram';

// Constants for rendering
const BULLET_LINE_HEIGHT = 28;
const STEP_HEIGHT = 60;
const PADDING = 16;

type Props = {
  block: CanvasVisualBlockType;
  onPress?: (blockId: string) => void;
  highlighted?: boolean;
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
        <G translateY={titleHeight}>
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
        <G translateY={termHeight}>
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
          <G translateY={termHeight + defLines * lineHeight + 10}>
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
        <G translateY={titleHeight}>
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

/**
 * Main container component that renders any type of visual block
 */
export const CanvasVisualBlock: React.FC<Props> = ({ block, onPress, highlighted }) => {
  const colorScheme = useColorScheme();
  const palette = Colors[colorScheme ?? 'light'];

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
});

export default CanvasVisualBlock;
