import assert from 'node:assert/strict';
import test from 'node:test';

import { cheatSheetPrompt, feynmanSystemPrompt, gradingPrompt, lectureMetadataPrompt, practiceExamPrompt, questionPrompt, warmupQuestionPrompt } from '../lib/prompts';

test('questionPrompt includes title and count', () => {
  const prompt = questionPrompt('Biology', 'Cells and DNA', 3);
  assert.match(prompt, /Biology/);
  assert.match(prompt, /3 short, concrete questions/i);
});

test('warmupQuestionPrompt asks for beginner multiple-choice JSON', () => {
  const prompt = warmupQuestionPrompt('Biology', 'Cells and DNA', 10);
  assert.match(prompt, /10 multiple-choice questions/i);
  assert.match(prompt, /recognition warm-up/i);
  assert.match(prompt, /"options"/);
  assert.match(prompt, /"correctOptionIndex"/);
  assert.match(prompt, /exactly 4 options/i);
});

test('gradingPrompt mentions question text', () => {
  const prompt = gradingPrompt({ id: 'q1', prompt: 'Explain photosynthesis', checkType: 'why' });
  assert.match(prompt, /photosynthesis/);
  assert.match(prompt, /checkType: why/);
  assert.match(prompt, /canCountForPass/);
  assert.match(prompt, /scores at least 90/i);
  assert.match(prompt, /whatWentWrong/);
  assert.match(prompt, /correctAnswer/);
  assert.match(prompt, /rewriteExample/);
  assert.match(prompt, /sourceCitationIds/);
  assert.match(prompt, /be a tutor first and a grader second/i);
  assert.match(prompt, /enough detail to teach the gap/i);
  assert.doesNotMatch(prompt, /2-4 clear sentences/i);
});

test('feynmanSystemPrompt covers the full study session and hidden metadata', () => {
  const prompt = feynmanSystemPrompt('Learning objective: Limits\nKey Concepts to Master: epsilon, delta');
  assert.match(prompt, /systematically cover the learning objective/i);
  assert.match(prompt, /every listed key concept/i);
  assert.match(prompt, /not artificially short/i);
  assert.match(prompt, /```learning_question followed by a newline/i);
  assert.match(prompt, /source_citations/);
  assert.match(prompt, /"assessmentKind":"depth"/);
});

test('lectureMetadataPrompt references JSON shape', () => {
  const prompt = lectureMetadataPrompt('1. Chapter 1 - Optics');
  assert.match(prompt, /"title"/);
  assert.match(prompt, /"description"/);
});

test('practiceExamPrompt mentions passed topics and count', () => {
  const prompt = practiceExamPrompt({
    topics: '1. Derivatives',
    examText: 'Past exam question',
    worksheetText: 'Worksheet text',
    questionCount: 4,
  });
  assert.match(prompt, /practice exam/i);
  assert.match(prompt, /4 questions/i);
  assert.match(prompt, /Passed topics/i);
});

test('cheatSheetPrompt constrains output for DIN A4 JSON', () => {
  const prompt = cheatSheetPrompt({
    lectureTitle: 'Linear Algebra',
    evidenceSummary: 'score 45, eigenvalues confused with eigenvectors',
  });
  assert.match(prompt, /DIN A4/i);
  assert.match(prompt, /Return JSON only/i);
  assert.match(prompt, /Maximum 4 sections/i);
  assert.match(prompt, /priority/i);
});
