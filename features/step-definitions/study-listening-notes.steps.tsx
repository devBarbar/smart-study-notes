import assert from 'node:assert/strict';

import { Given, Then, When } from '@cucumber/cucumber';
import { fireEvent, render } from '@testing-library/react-native/pure';
import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import {
  buildListeningNotesQuestion,
  getListeningNotesAudioText,
  shouldUseListeningNotesFlow,
} from '../../lib/study/listening-notes-flow';
import { AssessmentKind, TutorQuestionMetadata } from '../../types';
import { AppWorld } from '../support/world';

type HarnessPhase = 'chat' | 'guided_notes' | 'answer' | 'diagnostic' | 'final_quiz';

const TutorListeningHarness = ({
  tutorQuestion,
}: {
  tutorQuestion: TutorQuestionMetadata;
}) => {
  const [phase, setPhase] = useState<HarnessPhase>('chat');
  const [pendingQuestion, setPendingQuestion] =
    useState<TutorQuestionMetadata | null>(null);
  const [currentQuestion, setCurrentQuestion] =
    useState<TutorQuestionMetadata | null>(null);

  const receiveTutorResponse = () => {
    if (shouldUseListeningNotesFlow(tutorQuestion)) {
      setPendingQuestion(buildListeningNotesQuestion(tutorQuestion));
      setPhase('guided_notes');
      return;
    }

    setPhase(
      tutorQuestion.assessmentKind === 'final_quiz' ? 'final_quiz' : 'diagnostic',
    );
  };

  const finishAudio = () => {
    if (!pendingQuestion) return;
    setCurrentQuestion(pendingQuestion);
    setPendingQuestion(null);
    setPhase('answer');
  };

  const submitDisabled = phase !== 'answer';

  return (
    <View>
      <Text testID="phase">{phase}</Text>
      {phase === 'guided_notes' && (
        <Text testID="listening-notes-canvas">
          Listen and write notes on this page.
        </Text>
      )}
      {phase === 'answer' && (
        <View testID="answer-canvas">
          <Text>Clean answer canvas</Text>
          <Text testID="assessment-kind">
            {currentQuestion?.assessmentKind ?? 'depth'}
          </Text>
          <Text testID="required-for-pass">
            {String(currentQuestion?.requiredForPass ?? true)}
          </Text>
        </View>
      )}
      <Pressable accessibilityRole="button" onPress={receiveTutorResponse}>
        <Text>Receive tutor response</Text>
      </Pressable>
      <Pressable accessibilityRole="button" onPress={finishAudio}>
        <Text>Finish audio</Text>
      </Pressable>
      <Pressable
        testID="submit-answer"
        accessibilityRole="button"
        accessibilityState={{ disabled: submitDisabled }}
        disabled={submitDisabled}
      >
        <Text>Submit answer</Text>
      </Pressable>
    </View>
  );
};

const ListeningAudioPreview = ({
  tutorText,
  questionText,
}: {
  tutorText: string;
  questionText?: string | null;
}) => (
  <View>
    <Text testID="prepared-audio">
      {getListeningNotesAudioText(tutorText, questionText)}
    </Text>
  </View>
);

const ListeningEligibilityPreview = ({
  tutorQuestion,
}: {
  tutorQuestion?: TutorQuestionMetadata | null;
}) => (
  <View>
    <Text testID="listening-eligible">
      {String(shouldUseListeningNotesFlow(tutorQuestion))}
    </Text>
  </View>
);

const buildTutorQuestion = (
  assessmentKind: AssessmentKind,
): TutorQuestionMetadata => ({
  question: 'Explain the idea in your own words?',
  targetConcepts: ['core concept'],
  expectedAnswerPoints: ['definition', 'reason'],
  checkType: 'why',
  requiredForPass: true,
  difficulty: 'basic',
  assessmentKind,
});

Given(
  'a {word} tutor response with a check-in question',
  function (this: AppWorld, assessmentKind: AssessmentKind) {
    this.screen = render(
      <TutorListeningHarness
        tutorQuestion={buildTutorQuestion(assessmentKind)}
      />,
    );
  },
);

Given('no tutor question is available', function (this: AppWorld) {
  this.screen = render(<ListeningEligibilityPreview tutorQuestion={null} />);
});

Given(
  'the listening audio preset {word}',
  function (this: AppWorld, preset: string) {
    const presets: Record<
      string,
      { tutorText: string; questionText?: string | null }
    > = {
      no_question: {
        tutorText: '  Explanation only.  ',
        questionText: null,
      },
      missing_question: {
        tutorText: 'Explanation only.',
        questionText: 'What is missing?',
      },
      embedded_question: {
        tutorText: 'Prompt? More explanation.',
        questionText: 'Prompt?',
      },
      trailing_question: {
        tutorText: 'Explanation before question.\n\nPrompt?',
        questionText: 'Prompt?',
      },
    };
    const selected = presets[preset];
    assert.ok(selected, `Unknown listening audio preset: ${preset}`);
    this.screen = render(<ListeningAudioPreview {...selected} />);
  },
);

When('the tutor response arrives', function (this: AppWorld) {
  fireEvent.press(this.screen!.getByText('Receive tutor response'));
});

When('the explanation audio finishes', function (this: AppWorld) {
  fireEvent.press(this.screen!.getByText('Finish audio'));
});

Then('the student sees the listening notes canvas', function (this: AppWorld) {
  assert.equal(this.screen!.getByTestId('phase').props.children, 'guided_notes');
  assert.ok(this.screen!.getByTestId('listening-notes-canvas'));
});

Then(
  'the student does not see the listening notes canvas',
  function (this: AppWorld) {
    assert.notEqual(
      this.screen!.getByTestId('phase').props.children,
      'guided_notes',
    );
    assert.equal(this.screen!.queryByTestId('listening-notes-canvas'), null);
  },
);

Then(
  'the response is not eligible for listening notes',
  function (this: AppWorld) {
    assert.equal(
      this.screen!.getByTestId('listening-eligible').props.children,
      'false',
    );
  },
);

Then(
  'the prepared listening audio is {string}',
  function (this: AppWorld, audioText: string) {
    assert.equal(
      this.screen!.getByTestId('prepared-audio').props.children,
      audioText,
    );
  },
);

Then('the student sees a clean answer canvas', function (this: AppWorld) {
  assert.equal(this.screen!.getByTestId('phase').props.children, 'answer');
  assert.ok(this.screen!.getByTestId('answer-canvas'));
});

Then('answer submission is disabled', function (this: AppWorld) {
  const submitButton = this.screen!.getByTestId('submit-answer');
  assert.equal(submitButton.props.accessibilityState.disabled, true);
});

Then('answer submission is enabled', function (this: AppWorld) {
  const submitButton = this.screen!.getByTestId('submit-answer');
  assert.equal(submitButton.props.accessibilityState.disabled, false);
});

Then('the depth check still counts toward mastery', function (this: AppWorld) {
  assert.equal(this.screen!.getByTestId('assessment-kind').props.children, 'depth');
  assert.equal(this.screen!.getByTestId('required-for-pass').props.children, 'true');
});
