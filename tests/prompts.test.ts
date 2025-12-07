import assert from 'node:assert/strict';
import test from 'node:test';

import { gradingPrompt, lectureMetadataPrompt, questionPrompt } from '../lib/prompts';

test('questionPrompt includes title and count', () => {
  const prompt = questionPrompt('Biology', 'Cells and DNA', 3);
  assert.match(prompt, /Biology/);
  assert.match(prompt, /3 short, concrete questions/i);
});

test('gradingPrompt mentions question text', () => {
  const prompt = gradingPrompt({ id: 'q1', prompt: 'Explain photosynthesis' });
  assert.match(prompt, /photosynthesis/);
});

test('lectureMetadataPrompt references JSON shape', () => {
  const prompt = lectureMetadataPrompt('1. Chapter 1 - Optics');
  assert.match(prompt, /"title"/);
  assert.match(prompt, /"description"/);
});

