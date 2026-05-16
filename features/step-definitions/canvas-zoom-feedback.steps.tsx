import assert from "node:assert/strict";
import { join } from "node:path";
import Module from "node:module";

import { Given, Then, When } from "@cucumber/cucumber";
import { fireEvent, render } from "@testing-library/react-native/pure";
import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";
import TestRenderer, { act } from "react-test-renderer";

import {
  getCanvasZoomPercentLabel,
  getEndlessCanvasPaperSize,
  getNextCanvasZoom,
  scaleCanvasZoomByPinch,
} from "../../lib/canvas-zoom";
import {
  buildCanvasFeedbackData,
  estimateCanvasFeedbackBlockSize,
  getCanvasFeedbackToneColor,
  insertCanvasFeedbackBlockBelowAnswer,
} from "../../lib/study/canvas-feedback";
import { buildInitialCanvasPage } from "../../lib/study/study-canvas-pages";
import { StudyFeedback } from "../../types";
import { AppWorld } from "../support/world";

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

type NativeCanvasHarness = {
  getLastPanGesture: () => FakeGesture | null;
  renderer: TestRenderer.ReactTestRenderer;
  restore: () => void;
};

let nativeCanvasHarness: NativeCanvasHarness | null = null;

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
    _load: (
      request: string,
      parent: NodeModule | null,
      isMain: boolean,
    ) => unknown;
  };
  const originalLoad = moduleWithLoader._load;
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
  const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;
  let lastPanGesture: FakeGesture | null = null;

  globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  }) as typeof globalThis.requestAnimationFrame;
  globalThis.cancelAnimationFrame = (() => undefined) as typeof globalThis.cancelAnimationFrame;

  moduleWithLoader._load = function load(request, parent, isMain) {
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
      globalThis.requestAnimationFrame = originalRequestAnimationFrame;
      globalThis.cancelAnimationFrame = originalCancelAnimationFrame;
    },
  };
};

const CanvasZoomHarness = () => {
  const [zoom, setZoom] = useState(1);
  const [strokeCount, setStrokeCount] = useState(0);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const paperSize = getEndlessCanvasPaperSize(
    { width: 1400, height: 760 },
    zoom,
    { width: 900, height: 900 },
  );

  return (
    <View>
      <Text testID="zoom-label">{getCanvasZoomPercentLabel(zoom)}</Text>
      <Text testID="stroke-count">{strokeCount}</Text>
      <Text testID="paper-width">{paperSize.width}</Text>
      <Text testID="paper-height">{paperSize.height}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          detailsOpen ? "Hide study details" : "Show study details"
        }
        onPress={() => setDetailsOpen((current) => !current)}
      >
        <Text>{detailsOpen ? "Hide study details" : "Show study details"}</Text>
      </Pressable>
      {detailsOpen && (
        <View testID="study-details">
          <Text>Study outline</Text>
        </View>
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Zoom out"
        onPress={() => setZoom((current) => getNextCanvasZoom(current, "out"))}
      >
        <Text>Zoom out</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Zoom in"
        onPress={() => setZoom((current) => getNextCanvasZoom(current, "in"))}
      >
        <Text>Zoom in</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Reset zoom"
        onPress={() =>
          setZoom((current) => getNextCanvasZoom(current, "reset"))
        }
      >
        <Text>Reset zoom</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Pinch larger"
        onPress={() => {
          setZoom((current) => scaleCanvasZoomByPinch(current, 1.5));
          setStrokeCount((current) => current);
        }}
      >
        <Text>Pinch larger</Text>
      </Pressable>
    </View>
  );
};

const gradingPresets: Record<
  string,
  { feedback: StudyFeedback; passed: boolean }
> = {
  failed: {
    passed: false,
    feedback: {
      summary: "The answer misses a causal link.",
      correctness: "incorrect",
      score: 50,
      whatWentWrong: ["Missing the key cause"],
      correctAnswer: "Name the cause and explain why it changes the result.",
      rewriteExample: "The key cause is X, so the result changes because Y.",
    },
  },
  passed: {
    passed: true,
    feedback: {
      summary: "The answer is complete.",
      correctness: "correct",
      score: 94,
      whatWentRight: ["Named the key idea"],
      whatWentWrong: [],
    },
  },
};

const InlineFeedbackHarness = ({
  preset,
}: {
  preset: keyof typeof gradingPresets;
}) => {
  const [visible, setVisible] = useState(false);
  const selected = gradingPresets[preset];
  const data = buildCanvasFeedbackData(selected.feedback, selected.passed);
  const size = estimateCanvasFeedbackBlockSize(data);
  const inserted = insertCanvasFeedbackBlockBelowAnswer({
    pages: [buildInitialCanvasPage("page-1")],
    pageId: "page-1",
    messageId: `feedback-${preset}`,
    feedback: selected.feedback,
    isPassed: selected.passed,
    answerBounds: { x: 40, y: 620, width: 280, height: 90 },
    id: `feedback-block-${preset}`,
    createdAt: "2026-05-16T00:00:00.000Z",
  });
  const color = getCanvasFeedbackToneColor(data.status);

  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Write feedback"
        onPress={() => setVisible(true)}
      >
        <Text>Write feedback</Text>
      </Pressable>
      {visible && (
        <View testID="canvas-feedback" style={{ borderColor: color }}>
          <Text testID="feedback-color">{color}</Text>
          <Text testID="feedback-height">{size.height}</Text>
          <Text testID="feedback-page-height">{inserted.pages[0].height}</Text>
          <Text>{data.summary}</Text>
          {data.whatWentRight.map((item) => (
            <Text key={`right-${item}`}>{item}</Text>
          ))}
          {data.whatWentWrong.map((item) => (
            <Text key={`wrong-${item}`}>{item}</Text>
          ))}
        </View>
      )}
    </View>
  );
};

Given("the study canvas zoom harness is open", function (this: AppWorld) {
  this.screen = render(<CanvasZoomHarness />);
});

Given(
  "the inline grading harness has a {word} answer",
  function (this: AppWorld, preset: keyof typeof gradingPresets) {
    assert.ok(gradingPresets[preset], `Unknown grading preset: ${preset}`);
    this.screen = render(<InlineFeedbackHarness preset={preset} />);
  },
);

Given("the native Skia handwriting canvas is open", async function () {
  const mocks = installNativeCanvasMocks();
  const nativeCanvasPath = "../../components/handwriting-canvas.native";
  delete require.cache[require.resolve(nativeCanvasPath)];
  const { HandwritingCanvas } = require(nativeCanvasPath);
  let renderer!: TestRenderer.ReactTestRenderer;

  await act(async () => {
    renderer = TestRenderer.create(
      <HandwritingCanvas width={320} height={240} />,
    );
  });

  nativeCanvasHarness = {
    ...mocks,
    renderer,
  };
});

When("the student zooms out", function (this: AppWorld) {
  fireEvent.press(this.screen!.getByText("Zoom out"));
});

When("the student zooms in", function (this: AppWorld) {
  fireEvent.press(this.screen!.getByText("Zoom in"));
});

When("the student resets zoom", function (this: AppWorld) {
  fireEvent.press(this.screen!.getByText("Reset zoom"));
});

When("the student pinches the canvas larger", function (this: AppWorld) {
  fireEvent.press(this.screen!.getByText("Pinch larger"));
});

When("the student expands the study details", function (this: AppWorld) {
  fireEvent.press(this.screen!.getByText("Show study details"));
});

When("the student collapses the study details", function (this: AppWorld) {
  fireEvent.press(this.screen!.getByText("Hide study details"));
});

When("the tutor writes feedback below the answer", function (this: AppWorld) {
  fireEvent.press(this.screen!.getByText("Write feedback"));
});

When("the student writes a short stylus stroke", async function () {
  assert.ok(nativeCanvasHarness, "Native Skia canvas harness is not open");
  const pan = nativeCanvasHarness.getLastPanGesture();
  assert.ok(pan, "Skia canvas did not register a pan gesture");

  await act(async () => {
    pan.handlers.onTouchesDown(
      { numberOfTouches: 1, pointerType: "stylus" },
      { activate: () => undefined, fail: () => undefined },
    );
    pan.handlers.onBegin({ pointerType: "stylus", x: 10, y: 20 });
    pan.handlers.onUpdate({ pointerType: "stylus", x: 14, y: 22 });
  });
});

Then(
  "the canvas zoom reads {string}",
  function (this: AppWorld, label: string) {
    assert.equal(this.screen!.getByTestId("zoom-label").props.children, label);
  },
);

Then("no handwriting stroke is created", function (this: AppWorld) {
  assert.equal(this.screen!.getByTestId("stroke-count").props.children, 0);
});

Then("the paper still fills the canvas viewport", function (this: AppWorld) {
  assert.equal(this.screen!.getByTestId("paper-width").props.children, 1400);
  assert.equal(this.screen!.getByTestId("paper-height").props.children, 1200);
});

Then("the study details are hidden", function (this: AppWorld) {
  assert.equal(this.screen!.queryByTestId("study-details"), null);
});

Then("the study details are visible", function (this: AppWorld) {
  assert.ok(this.screen!.getByTestId("study-details"));
});

Then("the canvas feedback is red", function (this: AppWorld) {
  assert.equal(
    this.screen!.getByTestId("feedback-color").props.children,
    "#dc2626",
  );
});

Then("the canvas feedback is green", function (this: AppWorld) {
  assert.equal(
    this.screen!.getByTestId("feedback-color").props.children,
    "#16a34a",
  );
});

Then(
  "the canvas feedback includes {string}",
  function (this: AppWorld, text: string) {
    assert.ok(this.screen!.getByText(text));
  },
);

Then("the live ink uses a copied Skia path snapshot", async function () {
  assert.ok(nativeCanvasHarness, "Native Skia canvas harness is not open");
  const paths = nativeCanvasHarness.renderer.root.findAll(
    (node) => (node.type as unknown) === "SkiaPath",
  );

  assert.equal(paths.length, 1);
  assert.deepEqual(paths[0].props.path.commands, [
    "M10,20",
    "L10.01,20",
    "L14,22",
  ]);
  assert.equal(paths[0].props.path._isReanimatedSharedValue, undefined);

  const pan = nativeCanvasHarness.getLastPanGesture();
  assert.ok(pan, "Skia canvas did not register a pan gesture");
  await act(async () => {
    pan.handlers.onEnd();
    nativeCanvasHarness?.renderer.unmount();
  });
  nativeCanvasHarness.restore();
  nativeCanvasHarness = null;
});
