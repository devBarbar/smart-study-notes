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
import { Gesture, GestureDetector } from "react-native-gesture-handler";
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

const PAPER_COLOR = "#f8fafc";
const LINE_COLOR = "#e2e8f0";

const makeEmptyPath = () => Skia.Path.Make();

const makePathFromPoints = (points: CanvasPoint[], smoothed: boolean) => {
  const path = Skia.Path.Make();
  const commands = smoothed
    ? buildSmoothPathCommands(points)
    : points.map((point, index) =>
        index === 0
          ? ({ type: "move", x: point.x, y: point.y } as const)
          : ({ type: "line", x: point.x, y: point.y } as const),
      );

  if (!smoothed && points.length === 1) {
    commands.push({ type: "line", x: points[0].x + 0.01, y: points[0].y });
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
    },
    ref,
  ) => {
    const skiaCanvasRef = useCanvasRef();
    const nextStrokeIdRef = useRef(1);
    const renderStroke = useCallback((stroke: CanvasStroke): RenderStroke => {
      const id = nextStrokeIdRef.current;
      nextStrokeIdRef.current += 1;
      return {
        ...stroke,
        points: stroke.points.map((point) => ({ x: point.x, y: point.y })),
        id,
        path: makePathFromPoints(stroke.points, true),
        bounds: getStrokeBounds(stroke),
      };
    }, []);

    const initialRenderStrokes = useMemo(
      () =>
        normalizeCanvasStrokes(initialStrokes).map((stroke) =>
          renderStroke(stroke),
        ),
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
    const activeMutablePathRef = useRef<SkPath>(makeEmptyPath());
    const activePath = useSharedValue<SkPath>(makeEmptyPath());
    const lineCount = Math.floor(height / 28);
    const lineWidth = width ?? 4096;
    const isStylusActiveRef = useRef(false);
    const isDrawingRef = useRef(false);
    const lastDrawingPositionRef = useRef<{ x: number; y: number } | null>(
      null,
    );
    const hasLoadedInitialRef = useRef(false);

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

    const commitRenderStrokes = useCallback((strokes: RenderStroke[]) => {
      strokesRef.current = strokes;
      setRenderStrokes(strokes);
    }, []);

    const setCanvasStrokes = useCallback(
      (nextStrokes: CanvasStroke[]) => {
        const normalized = normalizeCanvasStrokes(nextStrokes).map((stroke) =>
          renderStroke(stroke),
        );
        commitRenderStrokes(normalized);
        activeStrokeRef.current = null;
        activeMutablePathRef.current = makeEmptyPath();
        activePath.value = makeEmptyPath();
        setActiveStrokeStyle(null);
      },
      [activePath, commitRenderStrokes, renderStroke],
    );

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
      const stroke = {
        points: [point],
        color: colorRef.current,
        width: strokeWidthRef.current,
      };
      const path = makePathFromPoints(stroke.points, false);
      activeStrokeRef.current = stroke;
      activeMutablePathRef.current = path;
      activePath.value = path;
      setActiveStrokeStyle({ color: stroke.color, width: stroke.width });
    }, [activePath]);

    const appendPointToCurrentStroke = useCallback(
      (point: CanvasPoint) => {
        const current = activeStrokeRef.current;
        if (!current || !appendPoint(current.points, point)) return;

        activeMutablePathRef.current.lineTo(point.x, point.y);
        activePath.modify(undefined, true);
      },
      [activePath],
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

      activeMutablePathRef.current = makeEmptyPath();
      activePath.value = makeEmptyPath();
      setActiveStrokeStyle(null);
      onDrawingEndRef.current?.(lastDrawingPositionRef.current || undefined);
      onStrokesChangeRef.current?.(serializeStrokes(strokesRef.current));
    }, [activePath, commitRenderStrokes, renderStroke]);

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

    const panGesture = Gesture.Pan()
      .enabled(!readOnly)
      .minDistance(0)
      .minPointers(1)
      .maxPointers(1)
      .onBegin((event) => {
        const evt = event as any;
        const isLikelyStylus =
          isStylusActiveRef.current ||
          evt.stylusData !== undefined ||
          (typeof evt.force === "number" && evt.force > 0);

        if (!isLikelyStylus) return;

        const point = { x: event.x, y: event.y };
        isDrawingRef.current = true;
        lastDrawingPositionRef.current = point;
        onDrawingStartRef.current?.();

        if (modeRef.current === "eraser") {
          eraseAtPoint(point);
        } else {
          startStrokeAtPoint(point);
        }
      })
      .onUpdate((event) => {
        if (!isDrawingRef.current) return;

        const point = { x: event.x, y: event.y };
        lastDrawingPositionRef.current = point;

        if (modeRef.current === "eraser") {
          eraseAtPoint(point);
        } else {
          appendPointToCurrentStroke(point);
        }
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
            <View style={styles.canvas}>{canvas}</View>
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
