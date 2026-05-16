import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { Platform, StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated from "react-native-reanimated";
import Svg, { Polyline } from "react-native-svg";
import ViewShot from "react-native-view-shot";

type Point = { x: number; y: number };
type Stroke = {
  points: Point[];
  color: string;
  width: number;
  svgPoints: string;
};

export type CanvasMode = "pen" | "eraser";

export type CanvasStroke = {
  points: { x: number; y: number }[];
  color: string;
  width: number;
};

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
  readOnly?: boolean;
  coordinateScale?: number;
};

const MIN_POINT_DISTANCE = 1.25;

const toSvgPoint = (point: Point) => `${point.x},${point.y}`;

const createStroke = (
  points: Point[],
  color: string,
  width: number,
): Stroke => ({
  points,
  color,
  width,
  svgPoints: points.map(toSvgPoint).join(" "),
});

const normalizeStrokes = (strokes: CanvasStroke[] = []): Stroke[] =>
  strokes.map((stroke) =>
    createStroke(stroke.points, stroke.color, stroke.width),
  );

const serializeStrokes = (strokes: Stroke[]): CanvasStroke[] =>
  strokes.map(({ points, color, width }) => ({ points, color, width }));

const shouldAppendPoint = (lastPoint: Point | undefined, point: Point) => {
  if (!lastPoint) return true;
  return (
    Math.hypot(point.x - lastPoint.x, point.y - lastPoint.y) >=
    MIN_POINT_DISTANCE
  );
};

const appendPointToStroke = (stroke: Stroke, point: Point) => {
  if (!shouldAppendPoint(stroke.points[stroke.points.length - 1], point)) {
    return false;
  }

  stroke.points.push(point);
  stroke.svgPoints = stroke.svgPoints
    ? `${stroke.svgPoints} ${toSvgPoint(point)}`
    : toSvgPoint(point);
  return true;
};

const StrokePolyline = React.memo(
  ({
    points,
    color,
    width,
  }: {
    points: string;
    color: string;
    width: number;
  }) => (
    <Polyline
      points={points}
      fill="none"
      stroke={color}
      strokeWidth={width}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
);

StrokePolyline.displayName = "StrokePolyline";

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
const eraserIntersectsStroke = (
  eraserPoint: Point,
  stroke: Stroke,
  eraserRadius: number = 20,
): boolean => {
  for (let i = 0; i < stroke.points.length - 1; i++) {
    const distance = pointToSegmentDistance(
      eraserPoint,
      stroke.points[i],
      stroke.points[i + 1],
    );
    if (distance < eraserRadius + stroke.width / 2) {
      return true;
    }
  }
  if (stroke.points.length === 1) {
    const distance = Math.hypot(
      eraserPoint.x - stroke.points[0].x,
      eraserPoint.y - stroke.points[0].y,
    );
    return distance < eraserRadius + stroke.width / 2;
  }
  return false;
};

export const HandwritingCanvas = forwardRef<HandwritingCanvasHandle, Props>(
  (
    {
      width,
      height = 420,
      strokeColor = "#0f172a",
      strokeWidth = 3,
      mode: initialMode = "pen",
      onDrawingStart,
      onDrawingEnd,
      onStrokesChange,
      initialStrokes,
      readOnly = false,
      coordinateScale = 1,
    },
    ref,
  ) => {
    const initialNormalizedStrokes = useMemo(
      () => normalizeStrokes(initialStrokes),
      [initialStrokes],
    );
    const [strokes, setStrokes] = useState<Stroke[]>(initialNormalizedStrokes);
    const [currentMode, setCurrentMode] = useState<CanvasMode>(initialMode);
    const [currentColor, setCurrentColor] = useState(strokeColor);
    const [currentStrokeWidth, setCurrentStrokeWidth] = useState(strokeWidth);
    const strokesRef = useRef<Stroke[]>(initialNormalizedStrokes);
    const renderFrameRef = useRef<number | null>(null);
    const viewShotRef = useRef<any>(null);
    const lineCount = Math.floor(height / 28);
    const isStylusActiveRef = useRef(false);
    const isWebDrawingRef = useRef(false);
    const isDrawingRef = useRef(false);
    const lastDrawingPositionRef = useRef<{ x: number; y: number } | null>(
      null,
    );
    const hasLoadedInitialRef = useRef(false);

    const flushRender = useCallback(() => {
      if (renderFrameRef.current !== null) {
        cancelAnimationFrame(renderFrameRef.current);
        renderFrameRef.current = null;
      }
      setStrokes([...strokesRef.current]);
    }, []);

    const scheduleRender = useCallback(() => {
      if (renderFrameRef.current !== null) return;

      renderFrameRef.current = requestAnimationFrame(() => {
        renderFrameRef.current = null;
        setStrokes([...strokesRef.current]);
      });
    }, []);

    const setCanvasStrokes = useCallback(
      (nextStrokes: CanvasStroke[] | Stroke[]) => {
        strokesRef.current = nextStrokes.map((stroke) =>
          "svgPoints" in stroke
            ? stroke
            : createStroke(stroke.points, stroke.color, stroke.width),
        );
        flushRender();
      },
      [flushRender],
    );

    // Load initial strokes when they become available (e.g., after async load)
    useEffect(() => {
      if (
        initialStrokes &&
        initialStrokes.length > 0 &&
        !hasLoadedInitialRef.current
      ) {
        hasLoadedInitialRef.current = true;
        setCanvasStrokes(initialStrokes);
      }
    }, [initialStrokes, setCanvasStrokes]);

    useEffect(() => {
      return () => {
        if (renderFrameRef.current !== null) {
          cancelAnimationFrame(renderFrameRef.current);
        }
      };
    }, []);

    // Use refs for gesture callbacks to avoid recreating gestures
    const modeRef = useRef(currentMode);
    const colorRef = useRef(currentColor);
    const strokeWidthRef = useRef(currentStrokeWidth);
    const onDrawingStartRef = useRef(onDrawingStart);
    const onDrawingEndRef = useRef(onDrawingEnd);

    const onStrokesChangeRef = useRef(onStrokesChange);
    const coordinateScaleRef = useRef(coordinateScale);

    modeRef.current = currentMode;
    colorRef.current = currentColor;
    strokeWidthRef.current = currentStrokeWidth;
    onDrawingStartRef.current = onDrawingStart;
    onDrawingEndRef.current = onDrawingEnd;
    onStrokesChangeRef.current = onStrokesChange;
    coordinateScaleRef.current = coordinateScale;

    const eraseAtPoint = useCallback(
      (point: Point) => {
        const newStrokes = strokesRef.current.filter(
          (stroke) => !eraserIntersectsStroke(point, stroke),
        );
        if (newStrokes.length !== strokesRef.current.length) {
          strokesRef.current = newStrokes;
          scheduleRender();
        }
      },
      [scheduleRender],
    );

    const startStrokeAtPoint = useCallback(
      (point: Point) => {
        strokesRef.current = [
          ...strokesRef.current,
          createStroke([point], colorRef.current, strokeWidthRef.current),
        ];
        scheduleRender();
      },
      [scheduleRender],
    );

    const appendPointToCurrentStroke = useCallback(
      (point: Point) => {
        const current = strokesRef.current[strokesRef.current.length - 1];
        if (current && appendPointToStroke(current, point)) {
          scheduleRender();
        }
      },
      [scheduleRender],
    );

    const notifyDrawingEnd = useCallback(() => {
      if (!isDrawingRef.current) return;

      isDrawingRef.current = false;
      flushRender();
      onDrawingEndRef.current?.(lastDrawingPositionRef.current || undefined);
      onStrokesChangeRef.current?.(serializeStrokes(strokesRef.current));
    }, [flushRender]);

    const scalePoint = useCallback((point: Point): Point => {
      const scale = coordinateScaleRef.current || 1;
      return { x: point.x / scale, y: point.y / scale };
    }, []);

    const getWebPoint = useCallback((event: any): Point => {
      const nativeEvent = event.nativeEvent ?? event;
      if (
        typeof nativeEvent.locationX === "number" &&
        typeof nativeEvent.locationY === "number"
      ) {
        return scalePoint({ x: nativeEvent.locationX, y: nativeEvent.locationY });
      }

      const target = nativeEvent.currentTarget ?? event.currentTarget;
      const bounds = target?.getBoundingClientRect?.();
      if (
        bounds &&
        typeof nativeEvent.clientX === "number" &&
        typeof nativeEvent.clientY === "number"
      ) {
        return scalePoint({
          x: nativeEvent.clientX - bounds.left,
          y: nativeEvent.clientY - bounds.top,
        });
      }

      return { x: 0, y: 0 };
    }, [scalePoint]);

    const beginWebDrawing = useCallback(
      (event: any) => {
        event.preventDefault?.();
        event.currentTarget?.setPointerCapture?.(
          event.nativeEvent?.pointerId ?? event.pointerId,
        );
        const point = getWebPoint(event);
        isWebDrawingRef.current = true;
        lastDrawingPositionRef.current = point;
        isDrawingRef.current = true;
        onDrawingStartRef.current?.();

        if (modeRef.current === "eraser") {
          eraseAtPoint(point);
        } else {
          startStrokeAtPoint(point);
        }
      },
      [eraseAtPoint, getWebPoint, startStrokeAtPoint],
    );

    const moveWebDrawing = useCallback(
      (event: any) => {
        if (!isWebDrawingRef.current) return;
        event.preventDefault?.();
        const point = getWebPoint(event);
        lastDrawingPositionRef.current = point;

        if (modeRef.current === "eraser") {
          eraseAtPoint(point);
        } else {
          appendPointToCurrentStroke(point);
        }
      },
      [appendPointToCurrentStroke, eraseAtPoint, getWebPoint],
    );

    const endWebDrawing = useCallback(
      (event?: any) => {
        if (!isWebDrawingRef.current) return;
        event?.preventDefault?.();
        isWebDrawingRef.current = false;
        notifyDrawingEnd();
      },
      [notifyDrawingEnd],
    );

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
          (typeof evt.force === "number" && evt.force > 0); // Has force feedback

        if (isLikelyStylus) {
          isDrawingRef.current = true;
          onDrawingStartRef.current?.();
          const point = scalePoint({ x: event.x, y: event.y });
          lastDrawingPositionRef.current = point; // Track position from start
          if (modeRef.current === "eraser") {
            eraseAtPoint(point);
          } else {
            startStrokeAtPoint(point);
          }
        }
      })
      .onUpdate((event) => {
        const evt = event as any;
        const isLikelyStylus =
          isStylusActiveRef.current ||
          evt.stylusData !== undefined ||
          (typeof evt.force === "number" && evt.force > 0);

        if (isLikelyStylus) {
          const point = scalePoint({ x: event.x, y: event.y });
          lastDrawingPositionRef.current = point; // Track last position
          if (modeRef.current === "eraser") {
            eraseAtPoint(point);
          } else {
            appendPointToCurrentStroke(point);
          }
        }
      })
      .onEnd(() => {
        notifyDrawingEnd();
      })
      .onFinalize(() => {
        notifyDrawingEnd();
      })
      .runOnJS(true);

    // Combine hover (stylus detection) with pan (drawing)
    const combinedGesture = useMemo(
      () => Gesture.Simultaneous(hoverGesture, panGesture),
      [hoverGesture, panGesture],
    );

    useImperativeHandle(
      ref,
      () => ({
        exportAsImage: async () => {
          const uri = await viewShotRef.current?.capture?.();
          if (!uri) throw new Error("Unable to capture handwriting");
          return uri;
        },
        clear: () => {
          setCanvasStrokes([]);
          onStrokesChangeRef.current?.([]);
        },
        setMode: (mode: CanvasMode) => setCurrentMode(mode),
        setColor: (color: string) => setCurrentColor(color),
        setStrokeWidth: (width: number) => setCurrentStrokeWidth(width),
        undo: () => {
          const newStrokes = strokesRef.current.slice(0, -1);
          setCanvasStrokes(newStrokes);
          onStrokesChangeRef.current?.(serializeStrokes(newStrokes));
        },
        getStrokes: () => serializeStrokes(strokesRef.current),
        setStrokes: setCanvasStrokes,
      }),
      [setCanvasStrokes],
    );

    // Build dynamic size styles
    const sizeStyle = { height, ...(width ? { width } : {}) };
    const svgSizeProps = width
      ? { width, height, viewBox: `0 0 ${width} ${height}` }
      : { width: "100%", height };

    const canvasContent = (
      <>
        {Array.from({ length: lineCount }).map((_, idx) => (
          <View key={idx} style={[styles.line, { top: idx * 28 }]} />
        ))}
        <Svg
          {...svgSizeProps}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        >
          {strokes.map((stroke, idx) => (
            <StrokePolyline
              key={idx}
              points={stroke.svgPoints}
              color={stroke.color}
              width={stroke.width}
            />
          ))}
        </Svg>
      </>
    );

    if (Platform.OS === "web") {
      return (
        <ViewShot
          ref={viewShotRef}
          options={{ format: "png", quality: 0.9 }}
          style={[styles.container, sizeStyle]}
        >
          <View
            style={styles.canvas}
            {...(readOnly
              ? {}
              : ({
                  onPointerDown: beginWebDrawing,
                  onPointerMove: moveWebDrawing,
                  onPointerUp: endWebDrawing,
                  onPointerCancel: endWebDrawing,
                  onPointerLeave: endWebDrawing,
                } as Record<string, unknown>))}
          >
            {canvasContent}
          </View>
        </ViewShot>
      );
    }

    return (
      <ViewShot
        ref={viewShotRef}
        options={{ format: "png", quality: 0.9 }}
        style={[styles.container, sizeStyle]}
      >
        {readOnly ? (
          <View style={styles.canvas}>{canvasContent}</View>
        ) : (
          <GestureDetector gesture={combinedGesture}>
            <Animated.View style={styles.canvas}>{canvasContent}</Animated.View>
          </GestureDetector>
        )}
      </ViewShot>
    );
  },
);

HandwritingCanvas.displayName = "HandwritingCanvas";

const styles = StyleSheet.create({
  container: {
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  canvas: {
    flex: 1,
  },
  line: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: "#e2e8f0",
  },
});
