import { v4 as uuid } from 'uuid';
import {
  BulletData,
  CanvasVisualBlock,
  DefinitionData,
  DiagramData,
  StepData,
  VisualBlockData,
  VisualBlockType,
} from '@/types';

/**
 * Result of parsing an AI response for visual content
 */
export type ParsedAIResponse = {
  /** The text content without visual blocks */
  text: string;
  /** Extracted visual blocks ready to render on canvas */
  visualBlocks: Omit<CanvasVisualBlock, 'position' | 'messageId' | 'createdAt'>[];
  /** Whether any visual blocks were found */
  hasVisuals: boolean;
};

/**
 * Raw visual block as extracted from AI response
 */
type RawVisualBlock = {
  type: VisualBlockType;
  data: VisualBlockData;
};

/**
 * Regex to match ```visual code blocks in AI responses
 * Matches: ```visual\n{...json...}\n```
 */
const VISUAL_BLOCK_REGEX = /```visual\s*\n([\s\S]*?)\n```/g;

/**
 * Validates that a diagram has the required structure
 */
const isValidDiagramData = (data: unknown): data is DiagramData => {
  if (!data || typeof data !== 'object') return false;
  const d = data as Record<string, unknown>;
  if (!Array.isArray(d.nodes)) return false;
  if (!Array.isArray(d.edges)) return false;
  
  // Validate nodes have required fields
  for (const node of d.nodes) {
    if (!node || typeof node !== 'object') return false;
    const n = node as Record<string, unknown>;
    if (typeof n.id !== 'string' || typeof n.label !== 'string') return false;
  }
  
  // Validate edges have required fields
  for (const edge of d.edges) {
    if (!edge || typeof edge !== 'object') return false;
    const e = edge as Record<string, unknown>;
    if (typeof e.from !== 'string' || typeof e.to !== 'string') return false;
  }
  
  return true;
};

/**
 * Validates that bullet data has the required structure
 */
const isValidBulletData = (data: unknown): data is BulletData => {
  if (!data || typeof data !== 'object') return false;
  const d = data as Record<string, unknown>;
  if (!Array.isArray(d.items)) return false;
  
  for (const item of d.items) {
    if (!item || typeof item !== 'object') return false;
    const i = item as Record<string, unknown>;
    if (typeof i.text !== 'string') return false;
  }
  
  return true;
};

/**
 * Validates that definition data has the required structure
 */
const isValidDefinitionData = (data: unknown): data is DefinitionData => {
  if (!data || typeof data !== 'object') return false;
  const d = data as Record<string, unknown>;
  return typeof d.term === 'string' && typeof d.definition === 'string';
};

/**
 * Validates that step data has the required structure
 */
const isValidStepData = (data: unknown): data is StepData => {
  if (!data || typeof data !== 'object') return false;
  const d = data as Record<string, unknown>;
  if (!Array.isArray(d.steps)) return false;
  
  for (const step of d.steps) {
    if (!step || typeof step !== 'object') return false;
    const s = step as Record<string, unknown>;
    if (typeof s.number !== 'number' || typeof s.title !== 'string') return false;
  }
  
  return true;
};

/**
 * Validates and normalizes a visual block's data based on its type
 */
const validateVisualBlock = (raw: unknown): RawVisualBlock | null => {
  if (!raw || typeof raw !== 'object') return null;
  
  const obj = raw as Record<string, unknown>;
  const type = obj.type as string;
  const data = obj.data;
  
  if (!type || !data) return null;
  
  switch (type) {
    case 'diagram':
      if (isValidDiagramData(data)) {
        return { type: 'diagram', data };
      }
      break;
    case 'bullets':
      if (isValidBulletData(data)) {
        return { type: 'bullets', data };
      }
      break;
    case 'definition':
      if (isValidDefinitionData(data)) {
        return { type: 'definition', data };
      }
      break;
    case 'steps':
      if (isValidStepData(data)) {
        return { type: 'steps', data };
      }
      break;
  }
  
  return null;
};

/**
 * Parses an AI response to extract visual blocks and clean text
 * 
 * @param rawText - The raw AI response text that may contain ```visual blocks
 * @returns Parsed response with text and visual blocks separated
 */
export const parseAIResponse = (rawText: string): ParsedAIResponse => {
  if (!rawText) {
    return { text: '', visualBlocks: [], hasVisuals: false };
  }
  
  const visualBlocks: Omit<CanvasVisualBlock, 'position' | 'messageId' | 'createdAt'>[] = [];
  
  // Extract all visual blocks
  let match: RegExpExecArray | null;
  const matches: { fullMatch: string; json: string }[] = [];
  
  // Reset regex state
  VISUAL_BLOCK_REGEX.lastIndex = 0;
  
  while ((match = VISUAL_BLOCK_REGEX.exec(rawText)) !== null) {
    matches.push({
      fullMatch: match[0],
      json: match[1].trim(),
    });
  }
  
  // Parse each visual block
  for (const { json } of matches) {
    try {
      const parsed = JSON.parse(json);
      const validated = validateVisualBlock(parsed);
      
      if (validated) {
        visualBlocks.push({
          id: `vb-${uuid()}`,
          type: validated.type,
          data: validated.data,
        });
      } else {
        console.warn('[parse-visual] Invalid visual block structure:', json.slice(0, 100));
      }
    } catch (err) {
      console.warn('[parse-visual] Failed to parse visual block JSON:', err);
    }
  }
  
  // Remove visual blocks from text
  let cleanText = rawText;
  for (const { fullMatch } of matches) {
    cleanText = cleanText.replace(fullMatch, '');
  }
  
  // Clean up extra whitespace left by removed blocks
  cleanText = cleanText
    .replace(/\n{3,}/g, '\n\n') // Collapse multiple newlines
    .trim();
  
  return {
    text: cleanText,
    visualBlocks,
    hasVisuals: visualBlocks.length > 0,
  };
};

/**
 * Creates a complete CanvasVisualBlock with position and metadata
 */
export const createCanvasVisualBlock = (
  partial: Omit<CanvasVisualBlock, 'position' | 'messageId' | 'createdAt'>,
  position: { x: number; y: number },
  messageId: string
): CanvasVisualBlock => {
  return {
    ...partial,
    position,
    messageId,
    createdAt: new Date().toISOString(),
  };
};

/**
 * Estimates the size of a visual block based on its content
 * Used for positioning and canvas growth calculations
 */
export const estimateVisualBlockSize = (
  block: Omit<CanvasVisualBlock, 'position' | 'messageId' | 'createdAt'>
): { width: number; height: number } => {
  const NODE_WIDTH = 140;
  const NODE_HEIGHT = 50;
  const NODE_SPACING_X = 60;
  const NODE_SPACING_Y = 80;
  const PADDING = 40;
  
  switch (block.type) {
    case 'diagram': {
      const data = block.data as DiagramData;
      const nodeCount = data.nodes.length;
      
      // Estimate grid dimensions based on layout
      const isVertical = data.layout !== 'horizontal';
      const cols = isVertical ? Math.ceil(Math.sqrt(nodeCount)) : nodeCount;
      const rows = isVertical ? Math.ceil(nodeCount / cols) : 1;
      
      const width = cols * NODE_WIDTH + (cols - 1) * NODE_SPACING_X + PADDING * 2;
      const height = rows * NODE_HEIGHT + (rows - 1) * NODE_SPACING_Y + PADDING * 2;
      
      // Add space for title if present
      const titleHeight = data.title ? 40 : 0;
      
      return { width, height: height + titleHeight };
    }
    
    case 'bullets': {
      const data = block.data as BulletData;
      const lineHeight = 28;
      const titleHeight = data.title ? 40 : 0;
      const height = titleHeight + data.items.length * lineHeight + PADDING;
      
      // Estimate width based on longest item
      const maxLength = Math.max(
        ...(data.items.map(i => i.text.length)),
        data.title?.length ?? 0
      );
      const width = Math.min(Math.max(maxLength * 8 + PADDING * 2, 200), 500);
      
      return { width, height };
    }
    
    case 'definition': {
      const data = block.data as DefinitionData;
      const termHeight = 36;
      const defLines = Math.ceil(data.definition.length / 50);
      const exampleLines = data.example ? Math.ceil(data.example.length / 50) : 0;
      const lineHeight = 24;
      
      const height = termHeight + defLines * lineHeight + exampleLines * lineHeight + PADDING * 2;
      const width = 350;
      
      return { width, height };
    }
    
    case 'steps': {
      const data = block.data as StepData;
      const stepHeight = 60;
      const titleHeight = data.title ? 40 : 0;
      const height = titleHeight + data.steps.length * stepHeight + PADDING;
      const width = 400;
      
      return { width, height };
    }
    
    default:
      return { width: 300, height: 200 };
  }
};
