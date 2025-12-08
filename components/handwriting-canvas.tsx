import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated from 'react-native-reanimated';
import Svg, { Polyline } from 'react-native-svg';
import ViewShot from 'react-native-view-shot';

type Point = { x: number; y: number };
type Stroke = { points: Point[]; color: string; width: number };

export type CanvasMode = 'pen' | 'eraser';

export type CanvasStroke = { points: { x: number; y: number }[]; color: string; width: number };

export type HandwritingCanvasHandle = {
  exportAsImage: () => Promise<string>;
  clear: () => void;
  setMode: (mode: CanvasMode) => void;
  setColor: (color: string) => void;
  setStrokeWidth: (width: number) => void;
  undo: () => void;
  getStrokes: () => CanvasStroke[];
  setStrokes: (strokes: CanvasStroke[]) => void;
};

type Props = {
  width?: number;
  height?: number;
  strokeColor?: string;
  strokeWidth?: number;
  mode?: CanvasMode;
  onModeChange?: (mode: CanvasMode) => void;
  onDrawingStart?: () => void;
  onDrawingEnd?: (lastPosition?: { x: number; y: number }) => void;
  onStrokesChange?: (strokes: CanvasStroke[]) => void;
  initialStrokes?: CanvasStroke[];
};

// Calculate distance from point to line segment
const pointToSegmentDistance = (point: Point, p1: Point, p2: Point): number => {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const lengthSquared = dx * dx + dy * dy;
  
  if (lengthSquared === 0) {
    return Math.hypot(point.x - p1.x, point.y - p1.y);
  }
  
  let t = ((point.x - p1.x) * dx + (point.y - p1.y) * dy) / lengthSquared;
  t = Math.max(0, Math.min(1, t));
  
  const closestX = p1.x + t * dx;
  const closestY = p1.y + t * dy;
  
  return Math.hypot(point.x - closestX, point.y - closestY);
};

// Check if eraser point intersects with a stroke
const eraserIntersectsStroke = (eraserPoint: Point, stroke: Stroke, eraserRadius: number = 20): boolean => {
  for (let i = 0; i < stroke.points.length - 1; i++) {
    const distance = pointToSegmentDistance(eraserPoint, stroke.points[i], stroke.points[i + 1]);
    if (distance < eraserRadius + stroke.width / 2) {
      return true;
    }
  }
  if (stroke.points.length === 1) {
    const distance = Math.hypot(eraserPoint.x - stroke.points[0].x, eraserPoint.y - stroke.points[0].y);
    return distance < eraserRadius + stroke.width / 2;
  }
  return false;
};

export const HandwritingCanvas = forwardRef<HandwritingCanvasHandle, Props>(
  ({ width, height = 420, strokeColor = '#0f172a', strokeWidth = 3, mode: initialMode = 'pen', onDrawingStart, onDrawingEnd, onStrokesChange, initialStrokes }, ref) => {
    const [strokes, setStrokes] = useState<Stroke[]>(initialStrokes || []);
    const [currentMode, setCurrentMode] = useState<CanvasMode>(initialMode);
    const [currentColor, setCurrentColor] = useState(strokeColor);
    const [currentStrokeWidth, setCurrentStrokeWidth] = useState(strokeWidth);
    const viewShotRef = useRef<ViewShot>(null);
    const lineCount = Math.floor(height / 28);
    const isStylusActiveRef = useRef(false);
    const lastDrawingPositionRef = useRef<{ x: number; y: number } | null>(null);
    const hasLoadedInitialRef = useRef(false);
    
    // Load initial strokes when they become available (e.g., after async load)
    useEffect(() => {
      if (initialStrokes && initialStrokes.length > 0 && !hasLoadedInitialRef.current) {
        hasLoadedInitialRef.current = true;
        setStrokes(initialStrokes);
      }
    }, [initialStrokes]);
    
    // Use refs for gesture callbacks to avoid recreating gestures
    const modeRef = useRef(currentMode);
    const colorRef = useRef(currentColor);
    const strokeWidthRef = useRef(currentStrokeWidth);
    const onDrawingStartRef = useRef(onDrawingStart);
    const onDrawingEndRef = useRef(onDrawingEnd);
    
    const onStrokesChangeRef = useRef(onStrokesChange);
    
    modeRef.current = currentMode;
    colorRef.current = currentColor;
    strokeWidthRef.current = currentStrokeWidth;
    onDrawingStartRef.current = onDrawingStart;
    onDrawingEndRef.current = onDrawingEnd;
    onStrokesChangeRef.current = onStrokesChange;

    const eraseAtPoint = useCallback((point: Point) => {
      setStrokes((prev) => {
        const newStrokes = prev.filter((stroke) => !eraserIntersectsStroke(point, stroke));
        // Notify if strokes were removed
        if (newStrokes.length !== prev.length) {
          // Defer the callback to after state update
          setTimeout(() => onStrokesChangeRef.current?.(newStrokes), 0);
        }
        return newStrokes;
      });
    }, []);

    // Hover gesture - only Apple Pencil can trigger hover events on iPad
    // When we detect hover, we know stylus is being used
    const hoverGesture = Gesture.Hover()
      .onBegin(() => {
        isStylusActiveRef.current = true;
      })
      .onEnd(() => {
        // Give a small delay before marking stylus as inactive
        // This helps with the transition from hover to touch
        setTimeout(() => {
          isStylusActiveRef.current = false;
        }, 100);
      })
      .runOnJS(true);

    // Pan gesture for drawing
    const panGesture = Gesture.Pan()
      .minDistance(0)
      .minPointers(1)
      .maxPointers(1)
      .onBegin((event) => {
        // Check for stylus indicators in the event
        const evt = event as any;
        const isLikelyStylus = 
          isStylusActiveRef.current || // Hover was detected (Apple Pencil)
          evt.stylusData !== undefined || // Has stylus data
          (typeof evt.force === 'number' && evt.force > 0); // Has force feedback
        
        if (isLikelyStylus) {
          onDrawingStartRef.current?.();
          const point = { x: event.x, y: event.y };
          lastDrawingPositionRef.current = point; // Track position from start
          if (modeRef.current === 'eraser') {
            eraseAtPoint(point);
          } else {
            setStrokes((prev) => [
              ...prev,
              { points: [point], color: colorRef.current, width: strokeWidthRef.current }
            ]);
          }
        }
      })
      .onUpdate((event) => {
        const evt = event as any;
        const isLikelyStylus = 
          isStylusActiveRef.current || 
          evt.stylusData !== undefined ||
          (typeof evt.force === 'number' && evt.force > 0);
        
        if (isLikelyStylus) {
          const point = { x: event.x, y: event.y };
          lastDrawingPositionRef.current = point; // Track last position
          if (modeRef.current === 'eraser') {
            eraseAtPoint(point);
          } else {
            setStrokes((prev) => {
              if (prev.length === 0) return prev;
              const next = [...prev];
              const current = next[next.length - 1];
              if (current) {
                current.points = [...current.points, point];
              }
              return next;
            });
          }
        }
      })
      .onEnd(() => {
        onDrawingEndRef.current?.(lastDrawingPositionRef.current || undefined);
        // Notify about strokes change after drawing ends
        setStrokes((current) => {
          onStrokesChangeRef.current?.(current);
          return current;
        });
      })
      .onFinalize(() => {
        onDrawingEndRef.current?.(lastDrawingPositionRef.current || undefined);
      })
      .runOnJS(true);

    // Combine hover (stylus detection) with pan (drawing)
    const combinedGesture = Gesture.Simultaneous(hoverGesture, panGesture);

    useImperativeHandle(ref, () => ({
      exportAsImage: async () => {
        const uri = await viewShotRef.current?.capture?.();
        if (!uri) throw new Error('Unable to capture handwriting');
        return uri;
      },
      clear: () => {
        setStrokes([]);
        onStrokesChangeRef.current?.([]);
      },
      setMode: (mode: CanvasMode) => setCurrentMode(mode),
      setColor: (color: string) => setCurrentColor(color),
      setStrokeWidth: (width: number) => setCurrentStrokeWidth(width),
      undo: () => {
        setStrokes((prev) => {
          const newStrokes = prev.slice(0, -1);
          onStrokesChangeRef.current?.(newStrokes);
          return newStrokes;
        });
      },
      getStrokes: () => strokes,
      setStrokes: (newStrokes: CanvasStroke[]) => setStrokes(newStrokes),
    }), [strokes]);

    // Build dynamic size styles
    const sizeStyle = { height, ...(width ? { width } : {}) };

    return (
      <ViewShot ref={viewShotRef} options={{ format: 'png', quality: 0.9 }} style={[styles.container, sizeStyle]}>
        <GestureDetector gesture={combinedGesture}>
          <Animated.View style={styles.canvas}>
            {Array.from({ length: lineCount }).map((_, idx) => (
              <View key={idx} style={[styles.line, { top: idx * 28 }]} />
            ))}
            <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
              {strokes.map((stroke, idx) => (
                <Polyline
                  key={idx}
                  points={stroke.points.map((p) => `${p.x},${p.y}`).join(' ')}
                  fill="none"
                  stroke={stroke.color}
                  strokeWidth={stroke.width}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ))}
            </Svg>
          </Animated.View>
        </GestureDetector>
      </ViewShot>
    );
  },
);

const styles = StyleSheet.create({
  container: {
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  canvas: {
    flex: 1,
  },
  line: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: '#e2e8f0',
  },
});
