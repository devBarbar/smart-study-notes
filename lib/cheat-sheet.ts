import { CheatSheetContent, TutorAnswerEvaluation } from '@/types';

const MAX_SECTIONS = 4;
const MAX_ITEMS_PER_SECTION = 4;

export const stripJsonCodeFences = (text: string) => {
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```$/i);
  return fenceMatch ? fenceMatch[1].trim() : trimmed;
};

const clampText = (value: unknown, maxLength: number) => {
  const text = typeof value === 'string' ? value.trim() : '';
  return text.length > maxLength ? `${text.slice(0, maxLength - 3).trim()}...` : text;
};

export const parseCheatSheetContent = (raw: string): CheatSheetContent => {
  const parsed = JSON.parse(stripJsonCodeFences(raw));
  const fallbackTitle = clampText(parsed?.title, 80) || 'Cheat Sheet';
  const sectionsSource = Array.isArray(parsed?.sections) ? parsed.sections : [];
  const sections = sectionsSource
    .slice(0, MAX_SECTIONS)
    .map((section: any) => ({
      title: clampText(section?.title, 70) || 'Focus area',
      items: (Array.isArray(section?.items) ? section.items : [])
        .slice(0, MAX_ITEMS_PER_SECTION)
        .map((item: any) => ({
          title: clampText(item?.title, 80) || 'Gap',
          gap: clampText(item?.gap, 220),
          fix: clampText(item?.fix, 280),
          example: clampText(item?.example, 220) || undefined,
          sourceQuestion: clampText(item?.sourceQuestion, 180) || undefined,
          priority: Number.isFinite(Number(item?.priority))
            ? Math.max(0, Math.min(100, Math.round(Number(item.priority))))
            : undefined,
          topicTitle: clampText(item?.topicTitle, 80) || undefined,
        }))
        .filter((item: any) => item.gap || item.fix),
    }))
    .filter((section: any) => section.items.length > 0);

  return {
    title: fallbackTitle,
    summary: clampText(parsed?.summary, 260) || undefined,
    sections,
  };
};

export const buildCheatSheetEvidenceHash = (
  evidence: Pick<
    TutorAnswerEvaluation,
    'questionText' | 'answerText' | 'score' | 'correctness' | 'checkType' | 'misconceptions' | 'studyPlanEntryId'
  >[],
) => {
  const stable = evidence
    .map((item) => ({
      questionText: item.questionText,
      answerText: item.answerText ?? '',
      score: item.score ?? null,
      correctness: item.correctness ?? '',
      checkType: item.checkType ?? '',
      misconceptions: [...(item.misconceptions ?? [])].sort(),
      studyPlanEntryId: item.studyPlanEntryId ?? '',
    }))
    .sort((a, b) =>
      `${a.studyPlanEntryId}:${a.questionText}:${a.answerText}`.localeCompare(
        `${b.studyPlanEntryId}:${b.questionText}:${b.answerText}`,
      ),
    );
  return hashString(JSON.stringify(stable));
};

export const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

export const buildCheatSheetHtml = (
  content: CheatSheetContent,
  options: { lectureTitle?: string; generatedAt?: string } = {},
) => {
  const generatedAt = options.generatedAt
    ? new Date(options.generatedAt).toLocaleDateString()
    : new Date().toLocaleDateString();
  const sections = content.sections.slice(0, MAX_SECTIONS);

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    @page { size: A4; margin: 12mm; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: #111827;
      line-height: 1.25;
      font-size: 10px;
    }
    header {
      border-bottom: 1px solid #cbd5e1;
      padding-bottom: 6px;
      margin-bottom: 8px;
    }
    .eyebrow {
      color: #64748b;
      font-size: 8px;
      text-transform: uppercase;
      letter-spacing: .08em;
    }
    h1 {
      font-size: 18px;
      margin: 2px 0 3px;
    }
    .summary {
      font-size: 10px;
      color: #334155;
      margin: 0;
    }
    .grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 7px;
    }
    section {
      break-inside: avoid;
      border: 1px solid #dbe4ee;
      border-radius: 6px;
      padding: 7px;
    }
    h2 {
      font-size: 11px;
      margin: 0 0 5px;
      color: #0f766e;
    }
    article {
      margin-bottom: 6px;
      padding-bottom: 6px;
      border-bottom: 1px solid #eef2f7;
    }
    article:last-child {
      margin-bottom: 0;
      padding-bottom: 0;
      border-bottom: 0;
    }
    h3 {
      font-size: 10px;
      margin: 0 0 2px;
    }
    p {
      margin: 1px 0;
    }
    .label {
      font-weight: 700;
      color: #475569;
    }
    .example {
      color: #334155;
      font-style: italic;
    }
  </style>
</head>
<body>
  <header>
    <div class="eyebrow">${escapeHtml(options.lectureTitle ?? 'Lecture')} · DIN A4 · ${escapeHtml(generatedAt)}</div>
    <h1>${escapeHtml(content.title)}</h1>
    ${content.summary ? `<p class="summary">${escapeHtml(content.summary)}</p>` : ''}
  </header>
  <main class="grid">
    ${sections
      .map(
        (section) => `<section>
      <h2>${escapeHtml(section.title)}</h2>
      ${section.items
        .slice(0, MAX_ITEMS_PER_SECTION)
        .map(
          (item) => `<article>
        <h3>${escapeHtml(item.title)}</h3>
        <p><span class="label">Gap:</span> ${escapeHtml(item.gap)}</p>
        <p><span class="label">Fix:</span> ${escapeHtml(item.fix)}</p>
        ${item.example ? `<p class="example">${escapeHtml(item.example)}</p>` : ''}
      </article>`,
        )
        .join('')}
    </section>`,
      )
      .join('')}
  </main>
</body>
</html>`;
};

const hashString = (value: string) => {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33) ^ value.charCodeAt(index);
  }
  return (hash >>> 0).toString(16);
};
