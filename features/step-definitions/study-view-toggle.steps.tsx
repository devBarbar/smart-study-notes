import assert from "node:assert/strict";

import { Given, Then, When } from "@cucumber/cucumber";
import { fireEvent, render } from "@testing-library/react-native/pure";
import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";

import {
  hasCanvasStudySurface,
  resolveStudySessionSurface,
  toggleStudySessionSurface,
  type StudySessionSurface,
  type StudySessionSurfacePreference,
} from "../../lib/study/study-view-toggle";
import { AppWorld } from "../support/world";

const StudyViewToggleHarness = () => {
  const [studyPhase, setStudyPhase] = useState<"answer" | "grading">("answer");
  const [grading, setGrading] = useState(false);
  const [preferredSurface, setPreferredSurface] =
    useState<StudySessionSurfacePreference>(null);
  const activeSurface = resolveStudySessionSurface({
    studyPhase,
    grading,
    preferredSurface,
  });
  const switchSurface = (currentSurface: StudySessionSurface) => {
    setPreferredSurface(
      toggleStudySessionSurface(
        currentSurface,
        hasCanvasStudySurface(studyPhase, grading),
      ),
    );
  };
  const submitAnswer = () => {
    setStudyPhase("grading");
    setGrading(true);
  };
  const finishGrading = () => {
    setGrading(false);
  };

  return (
    <View>
      <Text testID="study-phase">{studyPhase}</Text>
      {grading && <Text testID="canvas-grading-state">grading</Text>}
      {activeSurface === "canvas" ? (
        <View testID="answer-canvas-view">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open tutor chat"
            onPress={() => switchSurface("canvas")}
          >
            <Text>Open tutor chat</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Submit answer from canvas"
            onPress={submitAnswer}
          >
            <Text>Submit answer from canvas</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Finish grading"
            onPress={finishGrading}
          >
            <Text>Finish grading</Text>
          </Pressable>
        </View>
      ) : (
        <View testID="tutor-chat-view">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Return to canvas"
            onPress={() => switchSurface("chat")}
          >
            <Text>Return to canvas</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Submit answer"
            onPress={submitAnswer}
          >
            <Text>Submit answer</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
};

Given(
  "the study session view toggle harness is on the answer canvas",
  function (this: AppWorld) {
    this.screen = render(<StudyViewToggleHarness />);
    assert.ok(this.screen.getByTestId("answer-canvas-view"));
  },
);

Given(
  "the study session view toggle harness is on the tutor chat during answer mode",
  function (this: AppWorld) {
    this.screen = render(<StudyViewToggleHarness />);
    fireEvent.press(this.screen.getByText("Open tutor chat"));
    assert.ok(this.screen.getByTestId("tutor-chat-view"));
  },
);

When("the student opens the tutor chat from the canvas", function (this: AppWorld) {
  fireEvent.press(this.screen!.getByText("Open tutor chat"));
});

When("the student returns to the answer canvas", function (this: AppWorld) {
  fireEvent.press(this.screen!.getByText("Return to canvas"));
});

When("the student submits an answer from the chat", function (this: AppWorld) {
  fireEvent.press(this.screen!.getByText("Submit answer"));
});

When("the student submits an answer from the canvas", function (this: AppWorld) {
  fireEvent.press(this.screen!.getByText("Submit answer from canvas"));
});

When("the tutor finishes grading the answer", function (this: AppWorld) {
  fireEvent.press(this.screen!.getByText("Finish grading"));
});

Then("the tutor chat view is visible", function (this: AppWorld) {
  assert.ok(this.screen!.getByTestId("tutor-chat-view"));
});

Then(
  "the canvas grading state is no longer visible",
  function (this: AppWorld) {
    assert.equal(this.screen!.queryByTestId("canvas-grading-state"), null);
  },
);

Then("the answer canvas view is visible", function (this: AppWorld) {
  assert.ok(this.screen!.getByTestId("answer-canvas-view"));
});

Then("the answer phase is still active", function (this: AppWorld) {
  assert.equal(this.screen!.getByTestId("study-phase").props.children, "answer");
});

Then("the canvas grading state is visible", function (this: AppWorld) {
  assert.equal(
    this.screen!.getByTestId("canvas-grading-state").props.children,
    "grading",
  );
});
