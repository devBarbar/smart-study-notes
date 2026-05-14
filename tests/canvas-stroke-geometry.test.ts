import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  appendPoint,
  buildSmoothPathCommands,
  eraseStrokesAtPoint,
  getStrokeBounds,
  normalizeCanvasStrokes,
  pointsToSvgPolyline,
  shouldAppendPoint,
  strokeIntersectsPoint,
} from "../lib/canvas-stroke-geometry";

describe("canvas stroke geometry", () => {
  it("keeps legacy SVG point serialization compatible", () => {
    assert.equal(
      pointsToSvgPolyline([
        { x: 1, y: 2 },
        { x: 3.5, y: 4.25 },
      ]),
      "1,2 3.5,4.25",
    );
  });

  it("filters tiny point movements before appending", () => {
    const points = [{ x: 0, y: 0 }];

    assert.equal(shouldAppendPoint(points[0], { x: 0.5, y: 0.5 }), false);
    assert.equal(appendPoint(points, { x: 0.5, y: 0.5 }), false);
    assert.deepEqual(points, [{ x: 0, y: 0 }]);

    assert.equal(appendPoint(points, { x: 2, y: 0 }), true);
    assert.deepEqual(points, [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
    ]);
  });

  it("normalizes old stored strokes without changing the storage shape", () => {
    const strokes = normalizeCanvasStrokes([
      {
        points: [
          { x: 1, y: 2 },
          { x: Number.NaN, y: 3 },
        ],
        color: "#000",
        width: 3,
      },
    ]);

    assert.deepEqual(strokes, [
      { points: [{ x: 1, y: 2 }], color: "#000", width: 3 },
    ]);
  });

  it("builds smoothed paths from stored points", () => {
    assert.deepEqual(buildSmoothPathCommands([]), []);
    assert.deepEqual(buildSmoothPathCommands([{ x: 5, y: 6 }]), [
      { type: "move", x: 5, y: 6 },
      { type: "line", x: 5.01, y: 6 },
    ]);
    assert.deepEqual(
      buildSmoothPathCommands([
        { x: 0, y: 0 },
        { x: 10, y: 10 },
        { x: 20, y: 0 },
      ]),
      [
        { type: "move", x: 0, y: 0 },
        { type: "quad", cpx: 10, cpy: 10, x: 15, y: 5 },
        { type: "line", x: 20, y: 0 },
      ],
    );
  });

  it("calculates padded stroke bounds for hit-testing", () => {
    assert.deepEqual(
      getStrokeBounds({
        points: [
          { x: 10, y: 20 },
          { x: 30, y: 40 },
        ],
        color: "#000",
        width: 4,
      }),
      {
        minX: 8,
        minY: 18,
        maxX: 32,
        maxY: 42,
        x: 8,
        y: 18,
        width: 24,
        height: 24,
      },
    );
  });

  it("erases only strokes intersecting the eraser point", () => {
    const strokes = [
      {
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
        ],
        color: "#000",
        width: 4,
      },
      {
        points: [
          { x: 0, y: 100 },
          { x: 100, y: 100 },
        ],
        color: "#000",
        width: 4,
      },
    ];

    assert.equal(strokeIntersectsPoint({ x: 50, y: 8 }, strokes[0], 10), true);
    assert.equal(strokeIntersectsPoint({ x: 50, y: 60 }, strokes[0], 10), false);
    assert.deepEqual(eraseStrokesAtPoint(strokes, { x: 50, y: 8 }, 10), [
      strokes[1],
    ]);
  });
});
