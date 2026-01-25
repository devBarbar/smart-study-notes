import dagre from 'dagre';
import React, { useMemo, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, G, Marker, Path, Polygon, Rect, Text as SvgText } from 'react-native-svg';

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

type PositionedEdge = DiagramEdge & {
  points: { x: number; y: number }[];
};

type LayoutResult = {
  nodes: PositionedNode[];
  edges: PositionedEdge[];
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
 * Calculate node positions and edge paths using dagre
 */
const calculateNodePositions = (
  nodes: DiagramNode[],
  edges: DiagramEdge[],
  layout: 'vertical' | 'horizontal' | 'tree' = 'vertical'
): LayoutResult => {
  if (nodes.length === 0) return { nodes: [], edges: [], width: 0, height: 0 };

  const g = new dagre.graphlib.Graph();
  const rankdir = layout === 'horizontal' ? 'LR' : 'TB';
  
  g.setGraph({
    rankdir,
    nodesep: NODE_SPACING_X,
    ranksep: NODE_SPACING_Y,
    marginx: PADDING,
    marginy: PADDING,
  });
  
  g.setDefaultEdgeLabel(() => ({}));

  nodes.forEach((node) => {
    g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  });

  edges.forEach((edge) => {
    g.setEdge(edge.from, edge.to);
  });

  dagre.layout(g);

  const positionedNodes: PositionedNode[] = nodes.map((node) => {
    const dagreNode = g.node(node.id);
    return {
      ...node,
      x: dagreNode.x - dagreNode.width / 2,
      y: dagreNode.y - dagreNode.height / 2,
      width: dagreNode.width,
      height: dagreNode.height,
    };
  });

  const positionedEdges: PositionedEdge[] = edges.map((edge) => {
    const dagreEdge = g.edge(edge.from, edge.to);
    return {
      ...edge,
      points: dagreEdge.points,
    };
  });

  const graph = g.graph();

  return {
    nodes: positionedNodes,
    edges: positionedEdges,
    width: graph.width ?? 800,
    height: graph.height ?? 600,
  };
};

/**
 * Render a node shape based on its type
 */
const renderNodeShape = (
  node: PositionedNode,
  colors: { fill: string; stroke: string },
  isMasked: boolean = false
): React.ReactElement => {
  const shape: DiagramNodeShape = node.shape ?? 'box';
  const fill = isMasked ? '#f1f5f9' : colors.fill;
  const stroke = isMasked ? '#94a3b8' : colors.stroke;
  const strokeDash = isMasked ? '4,4' : undefined;

  switch (shape) {
    case 'circle':
      return (
        <Circle
          cx={node.x + node.width / 2}
          cy={node.y + node.height / 2}
          r={Math.min(node.width, node.height) / 2 - 4}
          fill={fill}
          stroke={stroke}
          strokeWidth={2}
          strokeDasharray={strokeDash}
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
          fill={fill}
          stroke={stroke}
          strokeWidth={2}
          strokeDasharray={strokeDash}
        />
      );
    case 'ellipse':
      return (
        <Circle
          cx={node.x + node.width / 2}
          cy={node.y + node.height / 2}
          r={node.width / 2 - 4}
          fill={fill}
          stroke={stroke}
          strokeWidth={2}
          strokeDasharray={strokeDash}
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
          fill={fill}
          stroke={stroke}
          strokeWidth={2}
          strokeDasharray={strokeDash}
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
export const CanvasDiagram: React.FC<Props> = ({ data, position, scale = 1, onNodePress }) => {
  const [unmaskedNodes, setUnmaskedNodes] = useState<Set<string>>(new Set());

  // Calculate positioned nodes and edges
  const layoutResult = useMemo(
    () => calculateNodePositions(data.nodes, data.edges, data.layout),
    [data.nodes, data.edges, data.layout]
  );

  const handleNodePress = (node: PositionedNode) => {
    // 1. Handle masking toggle
    if (node.isMasked && !unmaskedNodes.has(node.id)) {
      setUnmaskedNodes((prev) => new Set(prev).add(node.id));
      return;
    }

    // 2. Handle description display
    if (node.description) {
      Alert.alert(node.label, node.description);
    }

    // 3. Optional external callback
    onNodePress?.(node.id);
  };

  // Title offset
  const titleOffset = data.title ? 40 : 0;
  const diagramWidth = layoutResult.width;
  const diagramHeight = layoutResult.height + titleOffset;

  return (
    <View style={styles.container}>
      <Svg
        width={diagramWidth * scale}
        height={diagramHeight * scale}
        viewBox={`0 0 ${diagramWidth} ${diagramHeight}`}
      >
        {/* Background */}
        <Rect
          x={0}
          y={0}
          width={diagramWidth}
          height={diagramHeight}
          rx={12}
          fill="#fcfcfc"
          stroke="#e2e8f0"
          strokeWidth={1}
        />

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
          {layoutResult.edges.map((edge, index) => {
            const style = EDGE_STYLES[edge.style ?? 'solid'];
            
            // Create path data from points
            const pathData = edge.points
              .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`)
              .join(' ');

            // Find mid-point for label
            const midIndex = Math.floor(edge.points.length / 2);
            const midPoint = edge.points[midIndex];

            return (
              <G key={`edge-${index}`}>
                <Path
                  d={pathData}
                  stroke="#64748b"
                  strokeWidth={2}
                  strokeDasharray={style.dashArray}
                  fill="none"
                  markerEnd="url(#arrowhead)"
                />
                {edge.label && (
                  <G>
                    <Rect
                      x={midPoint.x - edge.label.length * 3.5 - 4}
                      y={midPoint.y - 10}
                      width={edge.label.length * 7 + 8}
                      height={20}
                      fill="white"
                      rx={4}
                    />
                    <SvgText
                      x={midPoint.x}
                      y={midPoint.y + 4}
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
          {layoutResult.nodes.map((node) => {
            const colorKey = node.color ?? 'default';
            const colors = NODE_COLORS[colorKey] ?? NODE_COLORS.default;
            
            const isMaskedAndHidden = node.isMasked && !unmaskedNodes.has(node.id);
            const displayLabel = isMaskedAndHidden ? node.label : (node.hiddenLabel ?? node.label);
            const textLines = wrapText(displayLabel);
            const lineHeight = 16;
            const textStartY = node.y + node.height / 2 - ((textLines.length - 1) * lineHeight) / 2;

            return (
              <G key={node.id} onPress={() => handleNodePress(node)}>
                {renderNodeShape(node, colors, isMaskedAndHidden)}
                {textLines.map((line, lineIndex) => (
                  <SvgText
                    key={`${node.id}-line-${lineIndex}`}
                    x={node.x + node.width / 2}
                    y={textStartY + lineIndex * lineHeight}
                    fontSize={13}
                    fontWeight={isMaskedAndHidden ? "400" : "600"}
                    fill={isMaskedAndHidden ? "#64748b" : colors.text}
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
