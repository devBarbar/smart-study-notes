import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, G, Rect, Text as SvgText } from 'react-native-svg';

import { BulletData, BulletItem } from '@/types';

// Layout constants
const LINE_HEIGHT = 28;
const PADDING = 16;
const DEFAULT_WIDTH = 320;

type Props = {
  data: BulletData;
  position: { x: number; y: number };
  width?: number;
  scale?: number;
};

/**
 * Render a single bullet icon based on the item's icon type
 */
const renderBulletIcon = (
  item: BulletItem,
  x: number,
  y: number,
  index: number
): React.ReactElement => {
  switch (item.icon) {
    case 'check':
      return (
        <SvgText x={x} y={y} fontSize={14} fill="#22c55e">
          ✓
        </SvgText>
      );
    case 'arrow':
      return (
        <SvgText x={x} y={y} fontSize={14} fill="#0ea5e9">
          →
        </SvgText>
      );
    case 'number':
      return (
        <SvgText x={x} y={y} fontSize={13} fill="#64748b" fontWeight="600">
          {index + 1}.
        </SvgText>
      );
    case 'bullet':
    default:
      return <Circle cx={x + 4} cy={y - 4} r={3} fill="#64748b" />;
  }
};

/**
 * Truncate text to fit within available width
 */
const truncateText = (text: string, maxLength: number = 45): string => {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + '...';
};

/**
 * Calculate the height needed for the bullet list
 */
export const calculateBulletListHeight = (data: BulletData): number => {
  const titleHeight = data.title ? 36 : 0;
  return titleHeight + data.items.length * LINE_HEIGHT + PADDING * 2;
};

/**
 * Calculate the width needed for the bullet list
 */
export const calculateBulletListWidth = (data: BulletData, defaultWidth: number = DEFAULT_WIDTH): number => {
  // Calculate based on longest item
  const maxItemLength = Math.max(
    ...data.items.map((item) => item.text.length + (item.indent ?? 0) * 2),
    data.title?.length ?? 0
  );
  
  // Estimate character width (roughly 8px per character)
  const estimatedWidth = maxItemLength * 8 + PADDING * 2 + 40; // 40 for bullet/icon space
  
  return Math.min(Math.max(estimatedWidth, 200), defaultWidth);
};

/**
 * Canvas Bullet List Component
 * Renders a structured bullet point list as SVG
 */
export const CanvasBulletList: React.FC<Props> = ({
  data,
  position,
  width = DEFAULT_WIDTH,
  scale = 1,
}) => {
  const titleHeight = data.title ? 36 : 0;
  const height = calculateBulletListHeight(data);

  return (
    <View
      style={[
        styles.container,
        {
          transform: [
            { translateX: position.x },
            { translateY: position.y },
          ],
        },
      ]}
    >
      <Svg
        width={width * scale}
        height={height * scale}
        viewBox={`0 0 ${width} ${height}`}
      >
        {/* Background card */}
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
            {truncateText(data.title, 40)}
          </SvgText>
        )}

        {/* Bullet items */}
        <G translateY={titleHeight}>
          {data.items.map((item, index) => {
            const indent = (item.indent ?? 0) * 20;
            const y = PADDING + index * LINE_HEIGHT + 14;
            const bulletX = PADDING + indent;
            const textX = bulletX + 20;

            return (
              <G key={`item-${index}`}>
                {renderBulletIcon(item, bulletX, y, index)}
                <SvgText x={textX} y={y} fontSize={14} fill="#334155">
                  {truncateText(item.text, 40)}
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
 * Color theme options for bullet lists
 */
export type BulletListTheme = 'default' | 'success' | 'warning' | 'info';

const THEME_COLORS: Record<BulletListTheme, { bg: string; border: string; title: string }> = {
  default: { bg: '#f8fafc', border: '#e2e8f0', title: '#1e293b' },
  success: { bg: '#f0fdf4', border: '#86efac', title: '#166534' },
  warning: { bg: '#fffbeb', border: '#fcd34d', title: '#92400e' },
  info: { bg: '#eff6ff', border: '#93c5fd', title: '#1e40af' },
};

/**
 * Themed bullet list variant
 */
export const ThemedBulletList: React.FC<Props & { theme?: BulletListTheme }> = ({
  data,
  position,
  width = DEFAULT_WIDTH,
  scale = 1,
  theme = 'default',
}) => {
  const colors = THEME_COLORS[theme];
  const titleHeight = data.title ? 36 : 0;
  const height = calculateBulletListHeight(data);

  return (
    <View
      style={[
        styles.container,
        {
          transform: [
            { translateX: position.x },
            { translateY: position.y },
          ],
        },
      ]}
    >
      <Svg
        width={width * scale}
        height={height * scale}
        viewBox={`0 0 ${width} ${height}`}
      >
        {/* Themed background */}
        <Rect
          x={0}
          y={0}
          width={width}
          height={height}
          rx={12}
          fill={colors.bg}
          stroke={colors.border}
          strokeWidth={2}
        />

        {/* Title */}
        {data.title && (
          <SvgText
            x={PADDING}
            y={28}
            fontSize={16}
            fontWeight="600"
            fill={colors.title}
          >
            {truncateText(data.title, 40)}
          </SvgText>
        )}

        {/* Bullet items */}
        <G translateY={titleHeight}>
          {data.items.map((item, index) => {
            const indent = (item.indent ?? 0) * 20;
            const y = PADDING + index * LINE_HEIGHT + 14;
            const bulletX = PADDING + indent;
            const textX = bulletX + 20;

            return (
              <G key={`item-${index}`}>
                {renderBulletIcon(item, bulletX, y, index)}
                <SvgText x={textX} y={y} fontSize={14} fill="#334155">
                  {truncateText(item.text, 40)}
                </SvgText>
              </G>
            );
          })}
        </G>
      </Svg>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    backgroundColor: 'transparent',
  },
});

export default CanvasBulletList;
