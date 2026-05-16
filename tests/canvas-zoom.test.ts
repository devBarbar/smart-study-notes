import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CANVAS_ZOOM_DEFAULT,
  CANVAS_ZOOM_MAX,
  CANVAS_ZOOM_MIN,
  CANVAS_ZOOM_STEP,
  clampCanvasZoom,
  getCanvasZoomPercentLabel,
  getNextCanvasZoom,
  getScaledCanvasSize,
  scaleCanvasZoomByPinch,
  toCanvasPoint,
  toScreenPoint,
} from '../lib/canvas-zoom';

test('canvas zoom clamps to the supported range', () => {
  assert.equal(CANVAS_ZOOM_MIN, 0.5);
  assert.equal(CANVAS_ZOOM_MAX, 2);
  assert.equal(CANVAS_ZOOM_STEP, 0.25);
  assert.equal(CANVAS_ZOOM_DEFAULT, 1);
  assert.equal(clampCanvasZoom(0.25), CANVAS_ZOOM_MIN);
  assert.equal(clampCanvasZoom(1.25), 1.25);
  assert.equal(clampCanvasZoom(3), CANVAS_ZOOM_MAX);
});

test('canvas zoom buttons move by fixed steps and reset to 100 percent', () => {
  assert.equal(getNextCanvasZoom(1, 'in'), 1.25);
  assert.equal(getNextCanvasZoom(1, 'out'), 0.75);
  assert.equal(getNextCanvasZoom(1.9, 'in'), CANVAS_ZOOM_MAX);
  assert.equal(getNextCanvasZoom(0.55, 'out'), CANVAS_ZOOM_MIN);
  assert.equal(getNextCanvasZoom(1.5, 'reset'), CANVAS_ZOOM_DEFAULT);
  assert.equal(scaleCanvasZoomByPinch(1, 1.5), 1.5);
  assert.equal(scaleCanvasZoomByPinch(1.5, 2), CANVAS_ZOOM_MAX);
  assert.equal(scaleCanvasZoomByPinch(0.75, 0.5), CANVAS_ZOOM_MIN);
  assert.equal(getCanvasZoomPercentLabel(1.25), '125%');
  assert.equal(getCanvasZoomPercentLabel(5), '200%');
});

test('canvas zoom converts screen and logical canvas coordinates', () => {
  assert.deepEqual(toCanvasPoint({ x: 200, y: 100 }, 2), { x: 100, y: 50 });
  assert.deepEqual(toCanvasPoint({ x: 200, y: 100 }, 0.5), { x: 400, y: 200 });
  assert.deepEqual(toCanvasPoint({ x: 120, y: 80 }, 1), { x: 120, y: 80 });

  assert.deepEqual(toScreenPoint({ x: 100, y: 50 }, 2), { x: 200, y: 100 });
  assert.deepEqual(toScreenPoint({ x: 400, y: 200 }, 0.5), { x: 200, y: 100 });
  assert.deepEqual(toScreenPoint({ x: 120, y: 80 }, 1), { x: 120, y: 80 });
  assert.deepEqual(getScaledCanvasSize({ width: 1400, height: 760 }, 0.5), {
    width: 700,
    height: 380,
  });
  assert.deepEqual(getScaledCanvasSize({ width: 1400, height: 760 }, 2), {
    width: 2800,
    height: 1520,
  });
});
