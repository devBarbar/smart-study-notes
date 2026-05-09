import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildLearningPathPrompt,
  findUndercoveredSources,
  parseLearningPath,
  sortLearningPathEntries,
  type ParsedPlanEntry,
} from '../supabase/functions/_shared/study-plan-v2';

test('learning path prompt asks for modules, prerequisites, and source refs', () => {
  const prompt = buildLearningPathPrompt(
    JSON.stringify({ concepts: [{ id: 'limits', title: 'Limits' }] }),
    {
      preferredSessionMinutes: 45,
      currentLevel: 'beginner',
      weakAreas: ['proofs'],
      additionalNotes: 'Professor emphasized definitions.',
    },
    'en',
    {
      sourceFiles: ['lecture-01.pdf', 'exam.pdf'],
      sourceCoverageRequirements: [
        {
          fileName: 'exam.pdf',
          currentRefs: 0,
          requiredRefs: 2,
          reason: 'practice or exam material needs dedicated review coverage',
        },
      ],
      minEntries: 28,
      maxEntries: 45,
    },
  );

  assert.match(prompt, /"modules"/);
  assert.match(prompt, /"prerequisites"/);
  assert.match(prompt, /"sourceRefs"/);
  assert.match(prompt, /Professor emphasized definitions/);
  assert.match(prompt, /28-45 entries/);
  assert.match(prompt, /lecture-01\.pdf/);
  assert.match(prompt, /exam\.pdf: at least 2 distinct entries/);
  assert.match(prompt, /Every uploaded source file/);
  assert.match(prompt, /dedicated practice\/review sessions/);
});

test('parseLearningPath preserves source flags and path fields', () => {
  const parsed = parseLearningPath(JSON.stringify({
    modules: [
      { id: 'm1', title: 'Foundations', summary: 'Start here', estimatedMinutes: 90 },
    ],
    entries: [
      {
        id: 'limits',
        moduleId: 'm1',
        title: 'Limits',
        description: 'Understand limits.',
        learningObjective: 'Compute basic limits.',
        keyConcepts: ['epsilon delta'],
        category: 'Analysis',
        importanceTier: 'core',
        priorityScore: 95,
        difficulty: 'intro',
        estimatedMinutes: 45,
        prerequisites: [],
        sequenceReason: 'Needed before derivatives.',
        fromExamSource: true,
        examRelevance: 'high',
        mentionedInNotes: true,
        sourceRefs: [{ fileName: 'exam.pdf', pageNumber: 2, reason: 'Past exam topic' }],
      },
    ],
  }));

  assert.equal(parsed.modules[0].title, 'Foundations');
  assert.equal(parsed.entries[0].fromExamSource, true);
  assert.equal(parsed.entries[0].examRelevance, 'high');
  assert.equal(parsed.entries[0].mentionedInNotes, true);
  assert.deepEqual(parsed.entries[0].prerequisiteClientIds, []);
  assert.equal(parsed.entries[0].learningObjective, 'Compute basic limits.');
  assert.equal(parsed.entries[0].estimatedMinutes, 45);
  assert.equal(parsed.entries[0].difficulty, 'intro');
  assert.equal(parsed.entries[0].sourceRefs?.[0].fileName, 'exam.pdf');
});

test('sortLearningPathEntries keeps prerequisites before high-priority dependents', () => {
  const entries: ParsedPlanEntry[] = [
    {
      clientId: 'advanced-topic',
      moduleClientId: 'm1',
      title: 'Advanced Topic',
      keyConcepts: [],
      importanceTier: 'core',
      priorityScore: 100,
      orderIndex: 0,
      fromExamSource: true,
      examRelevance: 'high',
      mentionedInNotes: true,
      prerequisiteClientIds: ['foundation'],
      difficulty: 'advanced',
    },
    {
      clientId: 'foundation',
      moduleClientId: 'm1',
      title: 'Foundation',
      keyConcepts: [],
      importanceTier: 'core',
      priorityScore: 60,
      orderIndex: 1,
      prerequisiteClientIds: [],
      difficulty: 'intro',
    },
  ];

  const sorted = sortLearningPathEntries(entries);
  assert.equal(sorted[0].clientId, 'foundation');
  assert.equal(sorted[1].clientId, 'advanced-topic');
});

test('findUndercoveredSources requires extra references for dense and practice PDFs', () => {
  const parsed = parseLearningPath(JSON.stringify({
    modules: [
      { id: 'm1', title: 'Foundations' },
    ],
    entries: [
      {
        id: 'storage',
        moduleId: 'm1',
        title: 'Storage overview',
        keyConcepts: ['SSD'],
        prerequisites: [],
        sourceRefs: [{ fileName: 'storage.pdf' }],
      },
      {
        id: 'exam-review',
        moduleId: 'm1',
        title: 'Mock exam review',
        keyConcepts: ['practice'],
        prerequisites: [],
        sourceRefs: [{ fileName: 'mockexam.pdf' }],
      },
    ],
  }));

  const gaps = findUndercoveredSources(parsed, [
    { fileName: 'storage.pdf', textLength: 70000 },
    { fileName: 'mockexam.pdf', textLength: 8000, isExam: true },
    { fileName: 'short.pdf', textLength: 1000 },
  ]);

  assert.deepEqual(
    gaps.map((gap) => [gap.fileName, gap.currentRefs, gap.requiredRefs]),
    [
      ['storage.pdf', 1, 3],
      ['mockexam.pdf', 1, 2],
      ['short.pdf', 0, 1],
    ],
  );
});
