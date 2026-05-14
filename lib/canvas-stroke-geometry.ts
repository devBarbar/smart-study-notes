export type CanvasPoint = { x: number; y: number };

export type CanvasStrokeLike = {
  points: CanvasPoint[];
  color: string;
  width: number;
};

export type StrokeBounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type PathCommand =
  | { type: "move"; x: number; y: number }
  | { type: "line"; x: number; y: number }
  | { type: "quad"; cpx: number; cpy: number; x: number; y: number };

export const MIN_POINT_DISTANCE = 1.25;
export const DEFAULT_ERASER_RADIUS = 20;

const isFinitePoint = (point: CanvasPoint) =>
  Number.isFinite(point.x) && Number.isFinite(point.y);

export const toSvgPoint = (point: CanvasPoint) => `${point.x},${point.y}`;

export const pointsToSvgPolyline = (points: CanvasPoint[]) =>
  points.map(toSvgPoint).join(" ");

export const normalizeCanvasStrokes = <T extends CanvasStrokeLike>(
  strokes: T[] = [],
): CanvasStrokeLike[] =>
  strokes
    .map((stroke) => ({
      points: stroke.points.filter(isFinitePoint).map((point) => ({
        x: point.x,
        y: point.y,
      })),
      color: stroke.color,
      width: stroke.width,
    }))
    .filter((stroke) => stroke.points.length > 0);

export const shouldAppendPoint = (
  lastPoint: CanvasPoint | undefined,
  point: CanvasPoint,
  minDistance = MIN_POINT_DISTANCE,
) => {
  if (!lastPoint) return true;
  return (
    Math.hypot(point.x - lastPoint.x, point.y - lastPoint.y) >= minDistance
  );
};

export const appendPoint = (
  points: CanvasPoint[],
  point: CanvasPoint,
  minDistance = MIN_POINT_DISTANCE,
) => {
  if (!shouldAppendPoint(points[points.length - 1], point, minDistance)) {
    return false;
  }

  points.push(point);
  return true;
};

export const buildSmoothPathCommands = (
  points: CanvasPoint[],
): PathCommand[] => {
  if (points.length === 0) return [];

  const commands: PathCommand[] = [
    { type: "move", x: points[0].x, y: points[0].y },
  ];

  if (points.length === 1) {
    commands.push({ type: "line", x: points[0].x + 0.01, y: points[0].y });
    return commands;
  }

  if (points.length === 2) {
    commands.push({ type: "line", x: points[1].x, y: points[1].y });
    return commands;
  }

  for (let i = 1; i < points.length - 1; i += 1) {
    const current = points[i];
    const next = points[i + 1];
    commands.push({
      type: "quad",
      cpx: current.x,
      cpy: current.y,
      x: (current.x + next.x) / 2,
      y: (current.y + next.y) / 2,
    });
  }

  const last = points[points.length - 1];
  commands.push({ type: "line", x: last.x, y: last.y });
  return commands;
};

export const getStrokeBounds = (
  stroke: CanvasStrokeLike,
  extraPadding = 0,
): StrokeBounds => {
  if (stroke.points.length === 0) {
    return {
      minX: 0,
      minY: 0,
      maxX: 0,
      maxY: 0,
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    };
  }

  let minX = stroke.points[0].x;
  let minY = stroke.points[0].y;
  let maxX = stroke.points[0].x;
  let maxY = stroke.points[0].y;

  stroke.points.forEach((point) => {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  });

  const padding = stroke.width / 2 + extraPadding;
  const paddedMinX = minX - padding;
  const paddedMinY = minY - padding;
  const paddedMaxX = maxX + padding;
  const paddedMaxY = maxY + padding;

  return {
    minX: paddedMinX,
    minY: paddedMinY,
    maxX: paddedMaxX,
    maxY: paddedMaxY,
    x: paddedMinX,
    y: paddedMinY,
    width: paddedMaxX - paddedMinX,
    height: paddedMaxY - paddedMinY,
  };
};

export const boundsContainPoint = (
  bounds: StrokeBounds,
  point: CanvasPoint,
  radius = 0,
) =>
  point.x >= bounds.minX - radius &&
  point.x <= bounds.maxX + radius &&
  point.y >= bounds.minY - radius &&
  point.y <= bounds.maxY + radius;

export const pointToSegmentDistance = (
  point: CanvasPoint,
  p1: CanvasPoint,
  p2: CanvasPoint,
) => {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const lengthSquared = dx * dx + dy * dy;

  if (lengthSquared === 0) {
    return Math.hypot(point.x - p1.x, point.y - p1.y);
  }

  let t = ((point.x - p1.x) * dx + (point.y - p1.y) * dy) / lengthSquared;
  t = Math.max(0, Math.min(1, t));

  return Math.hypot(point.x - (p1.x + t * dx), point.y - (p1.y + t * dy));
};

export const strokeIntersectsPoint = (
  point: CanvasPoint,
  stroke: CanvasStrokeLike,
  eraserRadius = DEFAULT_ERASER_RADIUS,
) => {
  if (
    !boundsContainPoint(getStrokeBounds(stroke), point, eraserRadius) ||
    stroke.points.length === 0
  ) {
    return false;
  }

  if (stroke.points.length === 1) {
    return (
      Math.hypot(point.x - stroke.points[0].x, point.y - stroke.points[0].y) <
      eraserRadius + stroke.width / 2
    );
  }

  for (let i = 0; i < stroke.points.length - 1; i += 1) {
    const distance = pointToSegmentDistance(
      point,
      stroke.points[i],
      stroke.points[i + 1],
    );
    if (distance < eraserRadius + stroke.width / 2) {
      return true;
    }
  }

  return false;
};

export const eraseStrokesAtPoint = <T extends CanvasStrokeLike>(
  strokes: T[],
  point: CanvasPoint,
  eraserRadius = DEFAULT_ERASER_RADIUS,
) => strokes.filter((stroke) => !strokeIntersectsPoint(point, stroke, eraserRadius));
