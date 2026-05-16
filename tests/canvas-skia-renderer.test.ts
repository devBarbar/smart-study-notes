import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Module from "node:module";
import { describe, it } from "node:test";
import { join } from "node:path";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";

const nativeRenderer = () =>
  readFileSync(join(process.cwd(), "components/handwriting-canvas.native.tsx"), "utf8");

type FakeGesture = {
  handlers: Record<string, (...args: any[]) => unknown>;
  enabled: () => FakeGesture;
  manualActivation: () => FakeGesture;
  minDistance: () => FakeGesture;
  minPointers: () => FakeGesture;
  maxPointers: () => FakeGesture;
  onTouchesDown: (handler: (...args: any[]) => unknown) => FakeGesture;
  onBegin: (handler: (...args: any[]) => unknown) => FakeGesture;
  onUpdate: (handler: (...args: any[]) => unknown) => FakeGesture;
  onEnd: (handler: (...args: any[]) => unknown) => FakeGesture;
  onFinalize: (handler: (...args: any[]) => unknown) => FakeGesture;
  runOnJS: () => FakeGesture;
};

const createGesture = (): FakeGesture => {
  const handlers: Record<string, (...args: any[]) => unknown> = {};
  const gesture: FakeGesture = {
    handlers,
    enabled: () => gesture,
    manualActivation: () => gesture,
    minDistance: () => gesture,
    minPointers: () => gesture,
    maxPointers: () => gesture,
    onTouchesDown: (handler: (...args: any[]) => unknown) => {
      handlers.onTouchesDown = handler;
      return gesture;
    },
    onBegin: (handler: (...args: any[]) => unknown) => {
      handlers.onBegin = handler;
      return gesture;
    },
    onUpdate: (handler: (...args: any[]) => unknown) => {
      handlers.onUpdate = handler;
      return gesture;
    },
    onEnd: (handler: (...args: any[]) => unknown) => {
      handlers.onEnd = handler;
      return gesture;
    },
    onFinalize: (handler: (...args: any[]) => unknown) => {
      handlers.onFinalize = handler;
      return gesture;
    },
    runOnJS: () => gesture,
  };
  return gesture;
};

const hostComponent = (name: string) =>
  React.forwardRef(({ children, ...props }: any, ref) =>
    React.createElement(name, { ...props, ref }, children),
  );

const createFakePath = (commands: string[] = []) => ({
  commands,
  moveTo(x: number, y: number) {
    commands.push(`M${x},${y}`);
    return this;
  },
  lineTo(x: number, y: number) {
    commands.push(`L${x},${y}`);
    return this;
  },
  quadTo(cpx: number, cpy: number, x: number, y: number) {
    commands.push(`Q${cpx},${cpy},${x},${y}`);
    return this;
  },
  setIsVolatile() {
    return this;
  },
  copy() {
    return createFakePath([...commands]);
  },
});

const installNativeCanvasMocks = () => {
  const moduleWithLoader = Module as unknown as {
    _load: (request: string, parent: NodeModule | null, isMain: boolean) => unknown;
  };
  const originalLoad = moduleWithLoader._load;
  let lastPanGesture: FakeGesture | null = null;

  (globalThis as any).requestAnimationFrame = (callback: (time: number) => void) => {
    callback(0);
    return 1;
  };
  (globalThis as any).cancelAnimationFrame = () => undefined;

  moduleWithLoader._load = function load(request, parent, isMain) {
    if (request === "react-native") {
      return {
        StyleSheet: { create: (styles: unknown) => styles },
        View: hostComponent("View"),
      };
    }
    if (request === "react-native-gesture-handler") {
      return {
        Gesture: {
          Hover: createGesture,
          Pan: () => {
            lastPanGesture = createGesture();
            return lastPanGesture;
          },
          Simultaneous: (...gestures: FakeGesture[]) => ({ gestures }),
        },
        GestureDetector: hostComponent("GestureDetector"),
        PointerType: { STYLUS: "stylus" },
      };
    }
    if (request === "@shopify/react-native-skia") {
      return {
        Canvas: hostComponent("SkiaCanvas"),
        Fill: hostComponent("SkiaFill"),
        Line: hostComponent("SkiaLine"),
        Path: hostComponent("SkiaPath"),
        Skia: { Path: { Make: () => createFakePath() } },
        useCanvasRef: () => React.useRef({ makeImageSnapshot: () => null }),
      };
    }
    if (request === "expo-file-system/legacy") {
      return {
        cacheDirectory: "/tmp/",
        EncodingType: { Base64: "base64" },
        writeAsStringAsync: async () => undefined,
      };
    }
    if (request.startsWith("@/")) {
      return originalLoad.call(
        this,
        join(process.cwd(), request.slice(2)),
        parent,
        isMain,
      );
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  return {
    getLastPanGesture: () => lastPanGesture,
    restore: () => {
      moduleWithLoader._load = originalLoad;
    },
  };
};

const loadNativeCanvas = () => {
  const nativeCanvasPath = "../components/handwriting-canvas.native";
  delete require.cache[require.resolve(nativeCanvasPath)];
  return require(nativeCanvasPath);
};

const createMeasuredNodeMock =
  (frame: { x: number; y: number; width: number; height: number }) => () => ({
    measureInWindow: (
      callback: (
        x: number,
        y: number,
        width: number,
        height: number,
      ) => void,
    ) => callback(frame.x, frame.y, frame.width, frame.height),
  });

const measureCanvasLayout = async (renderer: TestRenderer.ReactTestRenderer) => {
  const layoutViews = renderer.root.findAll(
    (node) =>
      (node.type as unknown) === "View" &&
      typeof node.props.onLayout === "function",
  );
  assert.ok(layoutViews.length > 0);
  await act(async () => {
    layoutViews[0].props.onLayout();
  });
};

describe("Skia handwriting renderer", () => {
  it("keeps native handwriting on Skia without passing shared values into Path", () => {
    const source = nativeRenderer();

    assert.match(source, /@shopify\/react-native-skia/);
    assert.doesNotMatch(source, /useSharedValue/);
    assert.doesNotMatch(source, /path=\{activePath\}/);
    assert.match(source, /activePathSnapshot/);
  });

  it("renders live ink through copied Skia path snapshots", async () => {
    const mocks = installNativeCanvasMocks();
    const { HandwritingCanvas } = loadNativeCanvas();
    let renderer!: TestRenderer.ReactTestRenderer;

    await act(async () => {
      renderer = TestRenderer.create(
        React.createElement(HandwritingCanvas, { width: 320, height: 240 }),
        {
          createNodeMock: createMeasuredNodeMock({
            x: 0,
            y: 0,
            width: 320,
            height: 240,
          }),
        },
      );
    });
    await measureCanvasLayout(renderer);

    const pan = mocks.getLastPanGesture();
    assert.ok(pan);

    await act(async () => {
      pan.handlers.onTouchesDown(
        { numberOfTouches: 1, pointerType: "stylus" },
        { activate: () => undefined, fail: () => undefined },
      );
      pan.handlers.onBegin({ pointerType: "stylus", x: 10, y: 20 });
      pan.handlers.onUpdate({ pointerType: "stylus", x: 14, y: 22 });
    });

    const paths = renderer.root.findAll(
      (node) => (node.type as unknown) === "SkiaPath",
    );
    assert.equal(paths.length, 1);
    assert.deepEqual(paths[0].props.path.commands, ["M10,20", "L10.01,20", "L14,22"]);
    assert.equal(paths[0].props.path._isReanimatedSharedValue, undefined);

    await act(async () => {
      pan.handlers.onEnd();
    });

    assert.equal(
      renderer.root.findAll((node) => (node.type as unknown) === "SkiaPath")
        .length,
      1,
    );
    await act(async () => {
      renderer.unmount();
    });
    mocks.restore();
  });

  it("maps transformed absolute stylus coordinates into zoomed canvas space", async () => {
    const mocks = installNativeCanvasMocks();
    const { HandwritingCanvas } = loadNativeCanvas();
    let renderer!: TestRenderer.ReactTestRenderer;

    await act(async () => {
      renderer = TestRenderer.create(
        React.createElement(HandwritingCanvas, {
          width: 320,
          height: 240,
          coordinateScale: 2,
        }),
        {
          createNodeMock: createMeasuredNodeMock({
            x: 30,
            y: 40,
            width: 640,
            height: 480,
          }),
        },
      );
    });
    await measureCanvasLayout(renderer);

    const pan = mocks.getLastPanGesture();
    assert.ok(pan);

    await act(async () => {
      pan.handlers.onTouchesDown(
        { numberOfTouches: 1, pointerType: "stylus" },
        { activate: () => undefined, fail: () => undefined },
      );
      pan.handlers.onBegin({
        pointerType: "stylus",
        x: 10,
        y: 20,
        absoluteX: 130,
        absoluteY: 240,
      });
      pan.handlers.onUpdate({
        pointerType: "stylus",
        x: 12,
        y: 22,
        absoluteX: 150,
        absoluteY: 260,
      });
    });

    const paths = renderer.root.findAll(
      (node) => (node.type as unknown) === "SkiaPath",
    );
    assert.equal(paths.length, 1);
    assert.deepEqual(paths[0].props.path.commands, [
      "M50,100",
      "L50.01,100",
      "L60,110",
    ]);

    await act(async () => {
      pan.handlers.onEnd();
      renderer.unmount();
    });
    mocks.restore();
  });
});
