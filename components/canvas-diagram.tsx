import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, G, Line, Marker, Path, Polygon, Rect, Text as SvgText } from 'react-native-svg';

import { DiagramData, DiagramEdge, DiagramNode, DiagramNodeShape } from '@/types';

// Layout constants
const NODE_WIDTH = 140;
const NODE_HEIGHT = 50;
const NODE_SPACING_X = 80;
const NODE_SPACING_Y = 100;
const PADDING = 30;
const ARROW_SIZE = 8;

// Color palette for nodes
const NODE_COLORS: Record<string, { fill: string; stroke: string; text: string }> = {
  default: { fill: '#f0f9ff', stroke: '#0ea5e9', text: '#0c4a6e' },
  blue: { fill: '#eff6ff', stroke: '#3b82f6', text: '#1e40af' },
  green: { fill: '#f0fdf4', stroke: '#22c55e', text: '#166534' },
  purple: { fill: '#faf5ff', stroke: '#a855f7', text: '#6b21a8' },
  orange: { fill: '#fff7ed', stroke: '#f97316', text: '#9a3412' },
  red: { fill: '#fef2f2', stroke: '#ef4444', text: '#991b1b' },
};

// Edge style configurations
const EDGE_STYLES: Record<string, { dashArray?: string }> = {
  solid: {},
  dashed: { dashArray: '8,4' },
  dotted: { dashArray: '2,4' },
};

type PositionedNode = DiagramNode & {
  x: number;
  y: number;
  width: number;
  height: number;
};

type Props = {
  data: DiagramData;
  position: { x: number; y: number };
  scale?: number;
  onNodePress?: (nodeId: string) => void;
};

/**
 * Calculate node positions using a simple grid layout algorithm
 */
const calculateNodePositions = (
  nodes: DiagramNode[],
  layout: 'vertical' | 'horizontal' | 'tree' = 'vertical'
): PositionedNode[] => {
  if (nodes.length === 0) return [];

  const positioned: PositionedNode[] = [];

  if (layout === 'horizontal') {
    // Single row layout
    nodes.forEach((node, index) => {
      positioned.push({
        ...node,
        x: PADDING + index * (NODE_WIDTH + NODE_SPACING_X),
        y: PADDING,
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
      });
    });
  } else if (layout === 'tree') {
    // Tree layout - place nodes based on edges (BFS from first node)
    // For simplicity, we'll use a level-based approach
    const levels: Map<string, number> = new Map();
    const visited = new Set<string>();
    const queue: { id: string; level: number }[] = [];

    // Start from first node
    if (nodes.length > 0) {
      queue.push({ id: nodes[0].id, level: 0 });
      levels.set(nodes[0].id, 0);
    }

    // Assign levels (not used for edges here, just node order)
    let maxLevel = 0;
    nodes.forEach((node, idx) => {
      if (!levels.has(node.id)) {
        const level = Math.floor(idx / 3); // Simple fallback: 3 per row
        levels.set(node.id, level);
        maxLevel = Math.max(maxLevel, level);
      }
    });

    // Position by level
    const levelCounts: Map<number, number> = new Map();
    nodes.forEach((node) => {
      const level = levels.get(node.id) ?? 0;
      const indexInLevel = levelCounts.get(level) ?? 0;
      levelCounts.set(level, indexInLevel + 1);

      positioned.push({
        ...node,
        x: PADDING + indexInLevel * (NODE_WIDTH + NODE_SPACING_X),
        y: PADDING + level * (NODE_HEIGHT + NODE_SPACING_Y),
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
      });
    });
  } else {
    // Vertical layout - nodes flow top to bottom, wrapping
    const maxCols = Math.ceil(Math.sqrt(nodes.length));
    nodes.forEach((node, index) => {
      const col = index % maxCols;
      const row = Math.floor(index / maxCols);
      positioned.push({
        ...node,
        x: PADDING + col * (NODE_WIDTH + NODE_SPACING_X),
        y: PADDING + row * (NODE_HEIGHT + NODE_SPACING_Y),
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
      });
    });
  }

  return positioned;
};

/**
 * Calculate the total size needed for the diagram
 */
const calculateDiagramSize = (nodes: PositionedNode[], hasTitle: boolean): { width: number; height: number } => {
  if (nodes.length === 0) return { width: 200, height: 100 };

  const maxX = Math.max(...nodes.map((n) => n.x + n.width));
  const maxY = Math.max(...nodes.map((n) => n.y + n.height));

  return {
    width: maxX + PADDING,
    height: maxY + PADDING + (hasTitle ? 40 : 0),
  };
};

/**
 * Get connection points for an edge between two nodes
 */
const getEdgePoints = (
  from: PositionedNode,
  to: PositionedNode
): { x1: number; y1: number; x2: number; y2: number } => {
  const fromCenterX = from.x + from.width / 2;
  const fromCenterY = from.y + from.height / 2;
  const toCenterX = to.x + to.width / 2;
  const toCenterY = to.y + to.height / 2;

  // Determine which sides to connect
  const dx = toCenterX - fromCenterX;
  const dy = toCenterY - fromCenterY;

  let x1: number, y1: number, x2: number, y2: number;

  if (Math.abs(dx) > Math.abs(dy)) {
    // Horizontal connection
    if (dx > 0) {
      x1 = from.x + from.width;
      x2 = to.x;
    } else {
      x1 = from.x;
      x2 = to.x + to.width;
    }
    y1 = fromCenterY;
    y2 = toCenterY;
  } else {
    // Vertical connection
    x1 = fromCenterX;
    x2 = toCenterX;
    if (dy > 0) {
      y1 = from.y + from.height;
      y2 = to.y;
    } else {
      y1 = from.y;
      y2 = to.y + to.height;
    }
  }

  return { x1, y1, x2, y2 };
};

/**
 * Render a node shape based on its type
 */
const renderNodeShape = (
  node: PositionedNode,
  colors: { fill: string; stroke: string }
): React.ReactElement => {
  const shape: DiagramNodeShape = node.shape ?? 'box';

  switch (shape) {
    case 'circle':
      return (
        <Circle
          cx={node.x + node.width / 2}
          cy={node.y + node.height / 2}
          r={Math.min(node.width, node.height) / 2 - 4}
          fill={colors.fill}
          stroke={colors.stroke}
          strokeWidth={2}
        />
      );
    case 'diamond':
      const cx = node.x + node.width / 2;
      const cy = node.y + node.height / 2;
      const hw = node.width / 2 - 4;
      const hh = node.height / 2 - 4;
      return (
        <Polygon
          points={`${cx},${cy - hh} ${cx + hw},${cy} ${cx},${cy + hh} ${cx - hw},${cy}`}
          fill={colors.fill}
          stroke={colors.stroke}
          strokeWidth={2}
        />
      );
    case 'ellipse':
      return (
        <Circle
          cx={node.x + node.width / 2}
          cy={node.y + node.height / 2}
          r={node.width / 2 - 4}
          fill={colors.fill}
          stroke={colors.stroke}
          strokeWidth={2}
          scaleY={0.6}
        />
      );
    case 'box':
    default:
      return (
        <Rect
          x={node.x}
          y={node.y}
          width={node.width}
          height={node.height}
          rx={8}
          ry={8}
          fill={colors.fill}
          stroke={colors.stroke}
          strokeWidth={2}
        />
      );
  }
};

/**
 * Wrap text to fit within node width
 */
const wrapText = (text: string, maxChars: number = 18): string[] => {
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

  return lines.slice(0, 3); // Max 3 lines
};

/**
 * Canvas Diagram Component
 * Renders a flowchart or concept map directly as SVG
 */
export const CanvasDiagram: React.FC<Props> = ({ data, position, scale = 1 }) => {
  // Calculate positioned nodes
  const positionedNodes = useMemo(
    () => calculateNodePositions(data.nodes, data.layout),
    [data.nodes, data.layout]
  );

  // Create a map for quick node lookup
  const nodeMap = useMemo(() => {
    const map = new Map<string, PositionedNode>();
    positionedNodes.forEach((node) => map.set(node.id, node));
    return map;
  }, [positionedNodes]);

  // Calculate diagram size
  const diagramSize = useMemo(
    () => calculateDiagramSize(positionedNodes, !!data.title),
    [positionedNodes, data.title]
  );

  // Title offset
  const titleOffset = data.title ? 40 : 0;

  return (
    <View style={styles.container}>
      <Svg
        width={diagramSize.width * scale}
        height={diagramSize.height * scale}
        viewBox={`0 0 ${diagramSize.width} ${diagramSize.height}`}
      >
        {/* Arrow marker definition */}
        <Defs>
          <Marker
            id="arrowhead"
            markerWidth={ARROW_SIZE}
            markerHeight={ARROW_SIZE}
            refX={ARROW_SIZE - 1}
            refY={ARROW_SIZE / 2}
            orient="auto"
          >
            <Polygon
              points={`0,0 ${ARROW_SIZE},${ARROW_SIZE / 2} 0,${ARROW_SIZE}`}
              fill="#64748b"
            />
          </Marker>
        </Defs>

        {/* Title */}
        {data.title && (
          <SvgText
            x={PADDING}
            y={28}
            fontSize={18}
            fontWeight="600"
            fill="#1e293b"
          >
            {data.title}
          </SvgText>
        )}

        {/* Edges (render before nodes so they appear behind) */}
        <G translateY={titleOffset}>
          {data.edges.map((edge, index) => {
            const fromNode = nodeMap.get(edge.from);
            const toNode = nodeMap.get(edge.to);
            if (!fromNode || !toNode) return null;

            const points = getEdgePoints(fromNode, toNode);
            const style = EDGE_STYLES[edge.style ?? 'solid'];
            const midX = (points.x1 + points.x2) / 2;
            const midY = (points.y1 + points.y2) / 2;

            return (
              <G key={`edge-${index}`}>
                <Line
                  x1={points.x1}
                  y1={points.y1}
                  x2={points.x2}
                  y2={points.y2}
                  stroke="#64748b"
                  strokeWidth={2}
                  strokeDasharray={style.dashArray}
                  markerEnd="url(#arrowhead)"
                />
                {edge.label && (
                  <G>
                    <Rect
                      x={midX - edge.label.length * 3.5 - 4}
                      y={midY - 10}
                      width={edge.label.length * 7 + 8}
                      height={20}
                      fill="white"
                      rx={4}
                    />
                    <SvgText
                      x={midX}
                      y={midY + 4}
                      fontSize={12}
                      fill="#64748b"
                      textAnchor="middle"
                    >
                      {edge.label}
                    </SvgText>
                  </G>
                )}
              </G>
            );
          })}
        </G>

        {/* Nodes */}
        <G translateY={titleOffset}>
          {positionedNodes.map((node) => {
            const colorKey = node.color ?? 'default';
            const colors = NODE_COLORS[colorKey] ?? NODE_COLORS.default;
            const textLines = wrapText(node.label);
            const lineHeight = 16;
            const textStartY = node.y + node.height / 2 - ((textLines.length - 1) * lineHeight) / 2;

            return (
              <G key={node.id}>
                {renderNodeShape(node, colors)}
                {textLines.map((line, lineIndex) => (
                  <SvgText
                    key={`${node.id}-line-${lineIndex}`}
                    x={node.x + node.width / 2}
                    y={textStartY + lineIndex * lineHeight}
                    fontSize={13}
                    fontWeight="500"
                    fill={colors.text}
                    textAnchor="middle"
                    alignmentBaseline="middle"
                  >
                    {line}
                  </SvgText>
                ))}
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
    // No position: 'absolute' here - the parent wrapper handles positioning
    backgroundColor: 'transparent',
  },
});

export default CanvasDiagram;
