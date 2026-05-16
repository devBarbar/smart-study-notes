export const CANVAS_ZOOM_MIN = 0.5;
export const CANVAS_ZOOM_MAX = 2;
export const CANVAS_ZOOM_STEP = 0.25;
export const CANVAS_ZOOM_DEFAULT = 1;

export type CanvasZoomAction = "in" | "out" | "reset";

type Point = { x: number; y: number };
type Size = { width: number; height: number };

export const clampCanvasZoom = (zoom: number) =>
  Math.min(CANVAS_ZOOM_MAX, Math.max(CANVAS_ZOOM_MIN, zoom));

export const getNextCanvasZoom = (
  currentZoom: number,
  action: CanvasZoomAction,
) => {
  if (action === "reset") return CANVAS_ZOOM_DEFAULT;
  return clampCanvasZoom(
    currentZoom + (action === "in" ? CANVAS_ZOOM_STEP : -CANVAS_ZOOM_STEP),
  );
};

export const scaleCanvasZoomByPinch = (
  currentZoom: number,
  pinchScale: number,
) => clampCanvasZoom(currentZoom * pinchScale);

export const getCanvasZoomPercentLabel = (zoom: number) =>
  `${Math.round(clampCanvasZoom(zoom) * 100)}%`;

export const toCanvasPoint = (point: Point, zoom: number): Point => ({
  x: point.x / clampCanvasZoom(zoom),
  y: point.y / clampCanvasZoom(zoom),
});

export const toScreenPoint = (point: Point, zoom: number): Point => ({
  x: point.x * clampCanvasZoom(zoom),
  y: point.y * clampCanvasZoom(zoom),
});

export const getScaledCanvasSize = (size: Size, zoom: number): Size => ({
  width: size.width * clampCanvasZoom(zoom),
  height: size.height * clampCanvasZoom(zoom),
});

export const getEndlessCanvasPaperSize = (
  size: Size,
  zoom: number,
  minimumViewportSize: Size,
): Size => {
  const clampedZoom = clampCanvasZoom(zoom);
  return {
    width: Math.max(size.width, minimumViewportSize.width / clampedZoom),
    height: Math.max(size.height, minimumViewportSize.height / clampedZoom),
  };
};
