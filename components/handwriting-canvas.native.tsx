import {
  Canvas as SkiaCanvas,
  Fill,
  Line,
  Path,
  Skia,
  useCanvasRef,
  type SkPath,
} from "@shopify/react-native-skia";
import * as FileSystem from "expo-file-system/legacy";
import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { StyleSheet, View } from "react-native";
import {
  Gesture,
  GestureDetector,
  PointerType,
} from "react-native-gesture-handler";
import { useSharedValue } from "react-native-reanimated";

import {
  appendPoint,
  buildSmoothPathCommands,
  eraseStrokesAtPoint,
  getStrokeBounds,
  normalizeCanvasStrokes,
  type CanvasPoint,
  type StrokeBounds,
} from "@/lib/canvas-stroke-geometry";

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

type RenderStroke = CanvasStroke & {
  id: number;
  path: SkPath;
  bounds: StrokeBounds;
};

type ActiveStrokeStyle = {
  color: string;
  width: number;
} | null;

type GesturePoint = CanvasPoint & {
  absoluteX?: number;
  absoluteY?: number;
};

type CanvasWindowFrame = {
  x: number;
  y: number;
  width: number;
  height: number;
  measured: boolean;
};

const PAPER_COLOR = "#f8fafc";
const LINE_COLOR = "#e2e8f0";
const DEFAULT_STROKE_WIDTH = 3;
const MIN_SKIA_STROKE_WIDTH = 0.5;
const MAX_SKIA_STROKE_WIDTH = 24;
const MAX_SKIA_COORDINATE = 1_000_000;

const isSafeCanvasCoordinate = (value: number) =>
  Number.isFinite(value) && Math.abs(value) <= MAX_SKIA_COORDINATE;

const isSafeCanvasPoint = (point: CanvasPoint) =>
  isSafeCanvasCoordinate(point.x) && isSafeCanvasCoordinate(point.y);

const sanitizeStrokeWidth = (width: number) => {
  if (Number.isNaN(width)) return DEFAULT_STROKE_WIDTH;
  if (width === Number.POSITIVE_INFINITY) return MAX_SKIA_STROKE_WIDTH;
  if (width === Number.NEGATIVE_INFINITY) return MIN_SKIA_STROKE_WIDTH;
  return Math.min(
    Math.max(width, MIN_SKIA_STROKE_WIDTH),
    MAX_SKIA_STROKE_WIDTH,
  );
};

const sanitizeStroke = (stroke: CanvasStroke): CanvasStroke | null => {
  const points = stroke.points.filter(isSafeCanvasPoint).map((point) => ({
    x: point.x,
    y: point.y,
  }));
  if (points.length === 0) return null;

  return {
    points,
    color:
      typeof stroke.color === "string" && stroke.color
        ? stroke.color
        : "#0f172a",
    width: sanitizeStrokeWidth(stroke.width),
  };
};

const sanitizeStrokes = (strokes: CanvasStroke[] = []) =>
  normalizeCanvasStrokes(strokes)
    .map((stroke) => sanitizeStroke(stroke))
    .filter((stroke): stroke is CanvasStroke => stroke !== null);

const makePathFromPoints = (points: CanvasPoint[], smoothed: boolean) => {
  const path = Skia.Path.Make();
  const commands = smoothed ? buildSmoothPathCommands(points) : [];

  if (!smoothed && points.length > 0) {
    commands.push({ type: "move", x: points[0].x, y: points[0].y });
    commands.push({ type: "line", x: points[0].x + 0.01, y: points[0].y });
    points.slice(1).forEach((point) => {
      commands.push({ type: "line", x: point.x, y: point.y });
    });
  }

  commands.forEach((command) => {
    if (command.type === "move") {
      path.moveTo(command.x, command.y);
      return;
    }
    if (command.type === "line") {
      path.lineTo(command.x, command.y);
      return;
    }
    path.quadTo(command.cpx, command.cpy, command.x, command.y);
  });

  path.setIsVolatile(!smoothed);
  return path;
};

const serializeStrokes = (strokes: RenderStroke[]): CanvasStroke[] =>
  strokes.map(({ points, color, width }) => ({ points, color, width }));

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
    const skiaCanvasRef = useCanvasRef();
    const activePath = useSharedValue<SkPath>(Skia.Path.Make());
    const gestureSurfaceRef = useRef<View | null>(null);
    const nextStrokeIdRef = useRef(1);
    const renderStroke = useCallback((stroke: CanvasStroke): RenderStroke => {
      const id = nextStrokeIdRef.current;
      nextStrokeIdRef.current += 1;
      return {
        ...stroke,
        id,
        path: makePathFromPoints(stroke.points, true),
        bounds: getStrokeBounds(stroke),
      };
    }, []);

    const initialRenderStrokes = useMemo(
      () =>
        sanitizeStrokes(initialStrokes).map((stroke) => renderStroke(stroke)),
      [initialStrokes, renderStroke],
    );
    const [renderStrokes, setRenderStrokes] =
      useState<RenderStroke[]>(initialRenderStrokes);
    const [currentMode, setCurrentMode] = useState<CanvasMode>(initialMode);
    const [currentColor, setCurrentColor] = useState(strokeColor);
    const [currentStrokeWidth, setCurrentStrokeWidth] = useState(strokeWidth);
    const [activeStrokeStyle, setActiveStrokeStyle] =
      useState<ActiveStrokeStyle>(null);

    const strokesRef = useRef<RenderStroke[]>(initialRenderStrokes);
    const activeStrokeRef = useRef<CanvasStroke | null>(null);
    const activePathRenderFrameRef = useRef<number | null>(null);
    const lineCount = Math.floor(height / 28);
    const lineWidth = width ?? 4096;
    const isStylusActiveRef = useRef(false);
    const isDrawingRef = useRef(false);
    const lastDrawingPositionRef = useRef<{ x: number; y: number } | null>(
      null,
    );
    const gestureIdRef = useRef(0);
    const hasLoadedInitialRef = useRef(false);
    const canvasWindowFrameRef = useRef<CanvasWindowFrame>({
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      measured: false,
    });

    const modeRef = useRef(currentMode);
    const colorRef = useRef(currentColor);
    const strokeWidthRef = useRef(currentStrokeWidth);
    const onDrawingStartRef = useRef(onDrawingStart);
    const onDrawingEndRef = useRef(onDrawingEnd);
    const onStrokesChangeRef = useRef(onStrokesChange);
    const coordinateScaleRef = useRef(coordinateScale);

    const isStylusEvent = useCallback(
      (event: { pointerType?: PointerType; stylusData?: unknown }) =>
        isStylusActiveRef.current ||
        event.pointerType === PointerType.STYLUS ||
        event.stylusData !== undefined,
      [],
    );

    modeRef.current = currentMode;
    colorRef.current = currentColor;
    strokeWidthRef.current = currentStrokeWidth;
    onDrawingStartRef.current = onDrawingStart;
    onDrawingEndRef.current = onDrawingEnd;
    onStrokesChangeRef.current = onStrokesChange;
    coordinateScaleRef.current = coordinateScale;

    const storeGestureSurfaceFrame = useCallback(
      (x: number, y: number, measuredWidth: number, measuredHeight: number) => {
        canvasWindowFrameRef.current = {
          x,
          y,
          width: measuredWidth,
          height: measuredHeight,
          measured: true,
        };
      },
      [],
    );

    const measureGestureSurface = useCallback(() => {
      gestureSurfaceRef.current?.measureInWindow(storeGestureSurfaceFrame);
    }, [storeGestureSurfaceFrame]);

    const convertPointWithFrame = useCallback(
      (point: GesturePoint, frame: CanvasWindowFrame): CanvasPoint => {
        const requestedScale = coordinateScaleRef.current;
        const scale =
          Number.isFinite(requestedScale) && requestedScale > 0
            ? requestedScale
            : 1;
        if (
          frame.measured &&
          typeof point.absoluteX === "number" &&
          typeof point.absoluteY === "number"
        ) {
          return {
            x: (point.absoluteX - frame.x) / scale,
            y: (point.absoluteY - frame.y) / scale,
          };
        }

        return {
          x: point.x / scale,
          y: point.y / scale,
        };
      },
      [],
    );

    const withCanvasPoint = useCallback(
      (point: GesturePoint, callback: (point: CanvasPoint) => void) => {
        const invokeWithSafePoint = (canvasPoint: CanvasPoint) => {
          if (!isSafeCanvasPoint(canvasPoint)) return;
          callback(canvasPoint);
        };
        const gestureSurface = gestureSurfaceRef.current;
        if (
          gestureSurface &&
          typeof point.absoluteX === "number" &&
          typeof point.absoluteY === "number"
        ) {
          gestureSurface.measureInWindow((x, y, measuredWidth, measuredHeight) => {
            storeGestureSurfaceFrame(x, y, measuredWidth, measuredHeight);
            invokeWithSafePoint(
              convertPointWithFrame(point, canvasWindowFrameRef.current),
            );
          });
          return;
        }

        invokeWithSafePoint(
          convertPointWithFrame(point, canvasWindowFrameRef.current),
        );
      },
      [convertPointWithFrame, storeGestureSurfaceFrame],
    );

    const commitRenderStrokes = useCallback((strokes: RenderStroke[]) => {
      strokesRef.current = strokes;
      setRenderStrokes(strokes);
    }, []);

    const cancelActivePathRender = useCallback(() => {
      if (activePathRenderFrameRef.current !== null) {
        cancelAnimationFrame(activePathRenderFrameRef.current);
        activePathRenderFrameRef.current = null;
      }
    }, []);

    const scheduleActivePathRender = useCallback(() => {
      if (activePathRenderFrameRef.current !== null) return;

      activePathRenderFrameRef.current = requestAnimationFrame(() => {
        activePathRenderFrameRef.current = null;
        const activeStroke = activeStrokeRef.current;
        activePath.value = activeStroke
          ? makePathFromPoints(activeStroke.points, false)
          : Skia.Path.Make();
      });
    }, [activePath]);

    const resetActivePath = useCallback(() => {
      cancelActivePathRender();
      activePath.value = Skia.Path.Make();
    }, [activePath, cancelActivePathRender]);

    const setCanvasStrokes = useCallback(
      (nextStrokes: CanvasStroke[]) => {
        const normalized = sanitizeStrokes(nextStrokes).map((stroke) =>
          renderStroke(stroke),
        );
        commitRenderStrokes(normalized);
        activeStrokeRef.current = null;
        resetActivePath();
        setActiveStrokeStyle(null);
      },
      /* c8 ignore next */
      [commitRenderStrokes, renderStroke, resetActivePath]);

    useEffect(() => {
      if (
        initialStrokes &&
        initialStrokes.length > 0 &&
        !hasLoadedInitialRef.current
      ) {
        hasLoadedInitialRef.current = true;
        setCanvasStrokes(initialStrokes);
      }
      return cancelActivePathRender;
    }, [cancelActivePathRender, initialStrokes, setCanvasStrokes]);

    const eraseAtPoint = useCallback(
      (point: CanvasPoint) => {
        const nextStrokes = eraseStrokesAtPoint(strokesRef.current, point);
        if (nextStrokes.length !== strokesRef.current.length) {
          commitRenderStrokes(nextStrokes);
        }
      },
      [commitRenderStrokes],
    );

    const startStrokeAtPoint = useCallback((point: CanvasPoint) => {
      if (!isSafeCanvasPoint(point)) return;
      const stroke = {
        points: [point],
        color: colorRef.current,
        width: sanitizeStrokeWidth(strokeWidthRef.current),
      };
      const path = makePathFromPoints(stroke.points, false);
      activeStrokeRef.current = stroke;
      activePath.value = path;
      setActiveStrokeStyle({ color: stroke.color, width: stroke.width });
    }, [activePath]);

    const appendPointToCurrentStroke = useCallback(
      (point: CanvasPoint) => {
        if (!isSafeCanvasPoint(point)) return;
        const current = activeStrokeRef.current;
        if (!current || !appendPoint(current.points, point)) return;

        scheduleActivePathRender();
      },
      [scheduleActivePathRender],
    );

    const notifyDrawingEnd = useCallback(() => {
      if (!isDrawingRef.current) return;

      isDrawingRef.current = false;

      const activeStroke = activeStrokeRef.current;
      if (activeStroke) {
        const nextStrokes = [...strokesRef.current, renderStroke(activeStroke)];
        commitRenderStrokes(nextStrokes);
        activeStrokeRef.current = null;
      }

      resetActivePath();
      setActiveStrokeStyle(null);
      onDrawingEndRef.current?.(lastDrawingPositionRef.current || undefined);
      onStrokesChangeRef.current?.(serializeStrokes(strokesRef.current));
    }, [commitRenderStrokes, renderStroke, resetActivePath]);

    const hoverGesture = Gesture.Hover()
      .onBegin(() => {
        isStylusActiveRef.current = true;
      })
      .onEnd(() => {
        setTimeout(() => {
          isStylusActiveRef.current = false;
        }, 100);
      })
      .runOnJS(true);

    // Keep gesture state transitions native; JS callbacks only decide whether to draw.
    const panGesture = Gesture.Pan()
      .enabled(!readOnly)
      .minDistance(0)
      .minPointers(1)
      .maxPointers(1)
      .onBegin((event) => {
        if (!isStylusEvent(event)) return;

        const gestureId = gestureIdRef.current + 1;
        gestureIdRef.current = gestureId;
        isDrawingRef.current = true;
        withCanvasPoint(
          {
            x: event.x,
            y: event.y,
            absoluteX: event.absoluteX,
            absoluteY: event.absoluteY,
          },
          (point) => {
            if (!isDrawingRef.current || gestureId !== gestureIdRef.current) {
              return;
            }

            lastDrawingPositionRef.current = point;
            onDrawingStartRef.current?.();

            if (modeRef.current === "eraser") {
              eraseAtPoint(point);
            } else {
              startStrokeAtPoint(point);
            }
          },
        );
      })
      .onUpdate((event) => {
        if (!isDrawingRef.current) return;

        const gestureId = gestureIdRef.current;
        withCanvasPoint(
          {
            x: event.x,
            y: event.y,
            absoluteX: event.absoluteX,
            absoluteY: event.absoluteY,
          },
          (point) => {
            if (!isDrawingRef.current || gestureId !== gestureIdRef.current) {
              return;
            }

            lastDrawingPositionRef.current = point;

            if (modeRef.current === "eraser") {
              eraseAtPoint(point);
            } else {
              appendPointToCurrentStroke(point);
            }
          },
        );
      })
      .onEnd(() => {
        notifyDrawingEnd();
      })
      .onFinalize(() => {
        notifyDrawingEnd();
      })
      .runOnJS(true);

    const combinedGesture = useMemo(
      () => Gesture.Simultaneous(hoverGesture, panGesture),
      [hoverGesture, panGesture],
    );

    useImperativeHandle(
      ref,
      () => ({
        exportAsImage: async () => {
          const image = skiaCanvasRef.current?.makeImageSnapshot();
          const base64 = image?.encodeToBase64();
          const cacheDirectory = FileSystem.cacheDirectory;
          if (!base64 || !cacheDirectory) {
            throw new Error("Unable to capture handwriting");
          }

          const uri = `${cacheDirectory}handwriting-${Date.now()}-${Math.round(
            Math.random() * 1_000_000,
          )}.png`;
          await FileSystem.writeAsStringAsync(uri, base64, {
            encoding: FileSystem.EncodingType.Base64,
          });
          return uri;
        },
        clear: () => {
          setCanvasStrokes([]);
          onStrokesChangeRef.current?.([]);
        },
        setMode: (mode: CanvasMode) => setCurrentMode(mode),
        setColor: (color: string) => setCurrentColor(color),
        setStrokeWidth: (value: number) => setCurrentStrokeWidth(value),
        undo: () => {
          const nextStrokes = strokesRef.current.slice(0, -1);
          commitRenderStrokes(nextStrokes);
          onStrokesChangeRef.current?.(serializeStrokes(nextStrokes));
        },
        getStrokes: () => serializeStrokes(strokesRef.current),
        setStrokes: setCanvasStrokes,
      }),
      [commitRenderStrokes, setCanvasStrokes, skiaCanvasRef],
    );

    const sizeStyle = { height, ...(width ? { width } : {}) };
    const canvas = (
      <SkiaCanvas ref={skiaCanvasRef} style={styles.canvas}>
        <Fill color={PAPER_COLOR} />
        {Array.from({ length: lineCount }).map((_, idx) => (
          <Line
            key={`line-${idx}`}
            p1={{ x: 0, y: idx * 28 }}
            p2={{ x: lineWidth, y: idx * 28 }}
            color={LINE_COLOR}
            strokeWidth={1}
          />
        ))}
        {renderStrokes.map((stroke) => (
          <Path
            key={stroke.id}
            path={stroke.path}
            color={stroke.color}
            style="stroke"
            strokeWidth={stroke.width}
            strokeCap="round"
            strokeJoin="round"
          />
        ))}
        {activeStrokeStyle && (
          <Path
            path={activePath}
            color={activeStrokeStyle.color}
            style="stroke"
            strokeWidth={activeStrokeStyle.width}
            strokeCap="round"
            strokeJoin="round"
          />
        )}
      </SkiaCanvas>
    );

    return (
      <View style={[styles.container, sizeStyle]}>
        {readOnly ? (
          canvas
        ) : (
          <GestureDetector gesture={combinedGesture}>
            <View
              ref={gestureSurfaceRef}
              style={styles.canvas}
              onLayout={measureGestureSurface}
            >
              {canvas}
            </View>
          </GestureDetector>
        )}
      </View>
    );
  },
);

HandwritingCanvas.displayName = "HandwritingCanvas";

const styles = StyleSheet.create({
  container: {
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: PAPER_COLOR,
    borderWidth: 1,
    borderColor: LINE_COLOR,
  },
  canvas: {
    flex: 1,
  },
});
