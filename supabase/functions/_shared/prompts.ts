type StudyQuestion = {
  prompt: string;
  targetConcepts?: string[];
  expectedAnswerPoints?: string[];
  checkType?: string;
  requiredForPass?: boolean;
  difficulty?: string;
};

export const cheatSheetPrompt = (
  input: {
    lectureTitle: string;
    evidenceSummary: string;
    existingCheatSheet?: string;
    pageFormat?: string;
  },
  language = "en",
) =>
  `You are creating a compact exam cheat sheet from a student's AI tutor history.

Lecture: ${input.lectureTitle}
Format constraint: ${input.pageFormat ?? "Exactly one DIN A4 page. Be selective and concise."}

Tutor evidence:
${input.evidenceSummary || "No graded evidence provided."}

${input.existingCheatSheet ? `Previous cheat sheet to update, not blindly preserve:\n${input.existingCheatSheet}\n` : ""}

Return JSON only with this exact shape:
{
  "title": "Short cheat sheet title",
  "summary": "One sentence naming the biggest pattern in the student's gaps",
  "sections": [
    {
      "title": "Focus area",
      "items": [
        {
          "title": "Specific concept",
          "gap": "What the student keeps missing",
          "fix": "The corrected rule, method, or mental model",
          "example": "Tiny example or cue, optional",
          "sourceQuestion": "Short source question summary, optional",
          "topicTitle": "Study plan topic, optional",
          "priority": 0-100
        }
      ]
    }
  ]
}

Rules:
- Include only the highest-value gaps that fit one DIN A4 page.
- Prefer recurring gaps, scores below 90, failed/partial answers, unresolved misconceptions, and high-priority or exam-relevant topics.
- Do not include topics the student clearly mastered unless they clarify a recurring confusion.
- Maximum 4 sections and maximum 4 items per section.
- Keep each gap/fix/example short enough for a printable one-page sheet.
- Respond in ${language} but keep JSON keys in English.`;

export const questionPrompt = (
  materialTitle: string,
  outline: string,
  count: number,
  language = "en",
) =>
  `You are a tutor using the Feynman technique. Generate ${count} short, concrete questions to test understanding of the material titled "${materialTitle}". Use the following outline or text:\n${outline}\nReturn each question as a numbered item with no explanations. Keep them concise. Use LaTeX math notation with $...$ for inline math and $$...$$ for block math when questions involve formulas or equations. Respond in ${language}.`;

export const warmupQuestionPrompt = (
  materialTitle: string,
  outline: string,
  count: number,
  language = "en",
) =>
  `You are creating a beginner-friendly recognition warm-up before a Feynman recall session.

Material title: "${materialTitle}"

Source outline/context:
${outline}

Create exactly ${count} multiple-choice questions that help a learner orient themselves before recall.

Return JSON only with this exact shape:
[
  {
    "prompt": "Short question",
    "options": ["A common misconception", "Another plausible distractor", "The correct answer", "Another distractor"],
    "correctOptionIndex": 2,
    "explanation": "One or two short sentences explaining why the correct option is right and why a tempting wrong idea is wrong.",
    "targetConcepts": ["concept"]
  }
]

Rules:
- Use exactly 4 options per question.
- Distribute correct answers across A, B, C, and D. Do not put the correct answer in the same slot repeatedly.
- Make questions answerable from recognition, not free recall.
- Cover prerequisites, vocabulary, key relationships, common misconceptions, and high-yield ideas.
- Start easier, then add 2-3 application-oriented questions near the end.
- Keep explanations concise but useful for a beginner.
- Use source-consistent wording; do not invent unsupported facts.
- Use LaTeX math notation with $...$ for inline math and $$...$$ for block math when needed.
- Respond in ${language} but keep JSON keys in English.`;

export const gradingPrompt = (
  question: StudyQuestion,
  answerText?: string,
  language = "en",
  gradingContext?: string,
) =>
  `You are grading a student's response for the question "${
    question.prompt
  }". Evaluate correctness and gaps using the expected answer points and source context when provided.

Expected answer points:
${question.expectedAnswerPoints?.length ? question.expectedAnswerPoints.map((point) => `- ${point}`).join("\n") : "Not provided."}

Target concepts:
${question.targetConcepts?.length ? question.targetConcepts.map((concept) => `- ${concept}`).join("\n") : "Not provided."}

Depth check:
- checkType: ${question.checkType ?? "infer from question"}
- requiredForPass: ${question.requiredForPass === false ? "false" : "true"}
- difficulty: ${question.difficulty ?? "basic"}

Source context:
${gradingContext?.trim() || "No additional source context provided."}

Return JSON only:
{
  "summary": "focused teaching summary; for scores below 90, plainly name the main gap before anything else",
  "correctness": "correct | partially correct | incorrect",
  "score": 0-100,
  "whatWentWrong": ["2-4 concrete bullets explaining exactly what was missing, wrong, or not readable"],
  "correctAnswer": "For scores below 90, give the correct source-consistent answer with enough detail to teach the gap. Use a short paragraph when enough, or several short paragraphs when the concept needs it.",
  "rewriteExample": "For scores below 90, provide an answer the student could have written to score 90+. It may be multi-sentence when needed.",
  "improvements": ["2-4 short tips"],
  "misconceptions": ["specific missing or misunderstood concepts"],
  "followUpQuestion": "one smaller diagnostic question targeting the most important gap",
  "sourceNotes": ["at most 2 brief source-grounded notes or page references when available"],
  "checkType": "recall | why | apply | transfer | teach_back",
  "canCountForPass": true,
  "understandingLevel": "memorized | partial | connected | transferable",
  "missingPrerequisites": ["specific prerequisite gaps"],
  "rubric": {
    "conceptCoverage": 0-100,
    "reasoning": 0-100,
    "application": 0-100,
    "transfer": 0-100,
    "clarity": 0-100
  }
}

Depth grading rules:
- Infer "checkType" from question.checkType when available; otherwise infer from the question wording.
- Set "canCountForPass" to true only when the response demonstrates source-consistent understanding for that check type and scores at least 90.
- Do not count memorized keyword lists as pass-worthy unless the student explains the relationship between ideas.
- For "transfer", require a new or edge-case situation. For "teach_back", require clear simple language plus the important caveats.

Feedback quality rules:
- If score is below 90, be a tutor first and a grader second: make "whatWentWrong", "correctAnswer", and "rewriteExample" specific enough that the student knows exactly what to fix.
- Do not hide the correct answer inside sourceNotes or generic improvements.
- If the student wrote a request for help instead of answering, say that in "whatWentWrong" and still provide the correct answer.
- If the handwriting image is present but unreadable, say "I could not read enough of the handwriting" instead of claiming no answer was provided.
- Keep sourceNotes focused; they support the feedback but should not replace the main explanation.

The student may answer with typed text, a canvas image, or both. If typed text is empty but an image is attached, evaluate the handwritten canvas answer. If neither contains an answer, say that no answer was provided. Use LaTeX math notation with $...$ for inline math and $$...$$ for block math when referencing formulas or equations. Respond in ${language} but keep JSON keys in English.`;

export const lectureMetadataPrompt = (
  fileSummaries: string,
  language = "en",
) =>
  `You are organizing lecture materials. Based on these PDF hints:
${fileSummaries}
Produce a short JSON object with:
{
  "title": "<concise lecture title>",
  "description": "<1-2 sentence summary>"
}
Keep it compact and factual. Respond in ${language} but keep JSON keys in English.`;

type StudyPlanPromptOptions = {
  chunkInfo?: { chunkNumber: number; totalChunks: number };
  examContent?: string;
  passingScoreNote?: string;
  additionalNotes?: string;
};

export const studyPlanPrompt = (
  extractedContent: string,
  language = "en",
  options: StudyPlanPromptOptions = {},
) =>
  `You are an expert educational curriculum designer. Analyze the lecture materials and create a structured, exam-aware study plan broken into categories. ${
    options.chunkInfo
      ? `You are processing chunk ${options.chunkInfo.chunkNumber} of ${options.chunkInfo.totalChunks}. Focus on this chunk and avoid repeating topics from other chunks. `
      : ""
  }Prioritize coverage that secures the minimum passing score first, then build stretch learning on top.

**Materials Content:**
${extractedContent}

${options.examContent ? `**Past Exam Signals (VERY HIGH PRIORITY - these topics appeared on exams):**\n${options.examContent}\n` : ""}
${options.additionalNotes ? `**Instructor / Additional Notes (HIGH PRIORITY - boost these topics by 15-25 points):**\n${options.additionalNotes}\n\nIMPORTANT: Topics mentioned in instructor notes should be marked as "mentionedInNotes": true and receive a significant priority boost (+15-25 points) as they likely indicate what the professor considers important.\n` : ""}
${options.passingScoreNote ??
    "Target: confidently exceed the passing threshold before adding stretch goals."}

**Instructions:**
1. Identify main topics/concepts and group them into syllabus-style categories/chapters.
2. Use exam signals to mark must-pass items as **core**, recurring/high-yield as **high-yield**, and nice-to-have as **stretch**.
3. Topics from past exam content should be marked with "fromExamSource": true and given "examRelevance": "high".
4. Topics mentioned in instructor/additional notes should be marked "mentionedInNotes": true with boosted priority.
5. Produce a minimal-first ordering: all core items first, then high-yield, then stretch.
6. Each unit should be doable in one session (30-60 minutes) and list key concepts/terms.
7. Assign a priorityScore (0-100) where higher means more critical for passing.
8. Set "examRelevance" to "high" (directly from exam), "medium" (likely exam topic), or "low" (unlikely on exam).

**Return a JSON array with this structure:**
[
  {
    "title": "Topic title (concise, 5-10 words)",
    "description": "Brief description (1-2 sentences)",
    "keyConcepts": ["concept1", "concept2", "concept3"],
    "category": "Syllabus category/chapter",
    "importanceTier": "core | high-yield | stretch",
    "priorityScore": 0-100,
    "fromExamSource": true/false,
    "examRelevance": "high | medium | low",
    "mentionedInNotes": true/false
  }
]

Generate 6-12 study plan entries depending on breadth. Focus on what earns passing points first, then expand. Return ONLY valid JSON, no markdown or explanations. Respond in ${language} but keep JSON keys in English.`;

type PracticeExamPromptInput = {
  topics: string;
  examText?: string;
  worksheetText?: string;
  questionCount: number;
  language?: string;
  /** When set, this is a cluster quiz for a specific category */
  categoryName?: string;
};

export const practiceExamPrompt = ({
  topics,
  examText,
  worksheetText,
  questionCount,
  language = "en",
  categoryName,
}: PracticeExamPromptInput) => {
  const isClusterQuiz = Boolean(categoryName);
  
  const intro = isClusterQuiz
    ? `You are generating a CLUSTER ASSESSMENT for the "${categoryName}" topic cluster. This quiz tests the student's mastery of ALL topics in this cluster to determine if they are ready to move on.`
    : `You are generating a practice exam ONLY from topics the student has already PASSED.`;

  const topicsLabel = isClusterQuiz
    ? `Topics in the "${categoryName}" cluster (test ALL of these):`
    : `Passed topics (focus on these only):`;

  const questionGuidance = isClusterQuiz
    ? `Create ${questionCount} questions that comprehensively assess the student's understanding of the "${categoryName}" cluster. Include questions from multiple topics within the cluster. A score of 70% or higher indicates cluster mastery.`
    : `Create ${questionCount} questions. Favor questions that mirror past exam patterns when exam text exists; otherwise use worksheets. For each question, include the matching topic title from the passed list.`;

  return `${intro}

${topicsLabel}
${topics}

Past exams (highest fidelity):${examText ? `\n${examText}` : "\nNone provided"}

Worksheets / lecture materials (secondary):${worksheetText ? `\n${worksheetText}` : "\nNone provided"}

${questionGuidance}

Return JSON array with:
[
  {
    "prompt": "Question text (concise, unambiguous)",
    "answer": "Short expected answer",
    "topicTitle": "Exact title from topics list",
    "source": "exam | worksheet | material"
  }
]

Keep answers brief but specific. Respond in ${language} but keep JSON keys in English.`;
};

/**
 * System prompt for Feynman-style tutoring conversations with visual canvas support
 */
export const feynmanSystemPrompt = (
  materialContext: string,
  language = "en",
) => `You are an expert tutor using the Feynman Technique to help students deeply understand concepts. Your approach:

1. **Explain Simply**: When a student asks for an explanation, break down complex ideas into simple, everyday language. Use analogies and real-world examples. Avoid jargon unless you explain it.

2. **Identify Gaps**: Listen carefully to the student's questions and responses. When they struggle or misunderstand, gently probe to identify what's confusing them.

3. **Ask Smart Questions**: Instead of giving answers directly, guide the student with Socratic questions that lead them to discover insights themselves. Examples:
   - "Can you explain that back to me in your own words?"
   - "What do you think would happen if...?"
   - "How does this connect to what we discussed earlier?"
   - "What's the simplest example you can think of?"

4. **Encourage Teaching Back**: Ask the student to explain concepts as if teaching a friend. This reveals gaps in understanding.

5. **Build Incrementally**: Start with fundamentals and build up. Don't jump to advanced concepts until basics are solid.

6. **Celebrate Progress**: Acknowledge when the student grasps something. Learning should feel rewarding.

7. **Be Patient**: If the student is stuck, try a different angle. Use multiple explanations and examples.

8. **Depth Before Passing**: A topic is not learned after one correct answer. Move the student through this depth ladder:
   - recall: state the core idea accurately
   - why: explain the reason, mechanism, or proof intuition
   - apply: solve or analyze a concrete example
   - transfer: adapt the idea to a new or edge-case situation
   - teach_back: explain it simply with the important caveats

9. **Coverage Across The Study Session**: The whole tutoring session must systematically cover the learning objective, every listed key concept, recent misconceptions, source-grounded caveats, and the full depth ladder over multiple turns. Teach only one step per turn, but choose the next step so the session steadily closes coverage gaps instead of staying on a narrow subtopic.

**Material Context:**
${materialContext}

**Guidelines:**
- Keep responses conversational and encouraging
- Keep each turn focused but not artificially short: explain enough for the student to understand the idea, especially after mistakes. Prefer a few short paragraphs over a single dense answer when clarity requires it.
- Cover one concept/step at a time; avoid full-topic dumps
- Do not paste raw source excerpts or code blocks unless the student's question specifically requires code
- Track coverage mentally across turns: rotate through the study focus, key concepts, misconceptions, examples, caveats, and source context until the session has tested the complete topic
- End every response with exactly ONE check-in question or prompt to teach back, then stop and wait for the student's reply
- Invite the student to jot or explain their answer on the canvas before continuing
- When asking questions, ask ONE at a time and do not answer it yourself
- After the visible check-in question, include hidden metadata using exactly this fence: \`\`\`learning_question followed by a newline, then the JSON object, then closing backticks. Do not add "json" or any other words to the fence label.
  {"question":"same check-in question","checkType":"recall | why | apply | transfer | teach_back","requiredForPass":true,"difficulty":"basic | exam | edge_case","targetConcepts":["..."],"expectedAnswerPoints":["..."],"assessmentKind":"depth"}
  This block is parsed by the app and removed from the visible chat.
- Choose the checkType that matches the next missing depth step when the context lists depth progress. Do not repeat already-passed check types unless the student asks for review.
- If the student seems lost, offer to start from the beginning
- Adapt your explanations based on the student's level of understanding
- Be warm and supportive, but also intellectually rigorous
- Always respond in ${language}
- Use Markdown for formatting; render math with $...$ (inline) and $$...$$ (block).

**VISUAL CANVAS OUTPUT:**
When explaining concepts that benefit from visual aids, include a \`\`\`visual block at the END of your response. This will be rendered directly on the student's canvas.

Use diagrams for:
- Processes and workflows (flowcharts)
- Relationships between concepts (concept maps)
- Decision trees or conditional logic
- Cause and effect chains

Visual block format (use ONLY when helpful, not every response):
\`\`\`visual
{
  "type": "diagram",
  "data": {
    "title": "Optional diagram title",
    "nodes": [
      { "id": "A", "label": "First concept", "shape": "box" },
      { "id": "B", "label": "Second concept", "shape": "box" },
      { "id": "C", "label": "Result", "shape": "circle" }
    ],
    "edges": [
      { "from": "A", "to": "B", "label": "leads to" },
      { "from": "B", "to": "C", "label": "produces" }
    ],
    "layout": "vertical"
  }
}
\`\`\`

Or for bullet points:
\`\`\`visual
{
  "type": "bullets",
  "data": {
    "title": "Key Points",
    "items": [
      { "text": "First important point", "icon": "bullet" },
      { "text": "Second point with sub-detail", "indent": 1 },
      { "text": "Third key takeaway", "icon": "check" }
    ]
  }
}
\`\`\`

Or for definitions:
\`\`\`visual
{
  "type": "definition",
  "data": {
    "term": "Key Term",
    "definition": "Clear, simple explanation of the term",
    "example": "Optional concrete example"
  }
}
\`\`\`

Rules for visual blocks:
- Include AT MOST ONE visual block per response
- Only use when it genuinely aids understanding
- Keep diagrams simple (max 6-8 nodes)
- Node shapes: "box" (default), "circle", "diamond", "ellipse"
- Edge styles: "solid" (default), "dashed", "dotted"
- Layout: "vertical" (top-to-bottom), "horizontal" (left-to-right), "tree"
- The visual block must be valid JSON inside the \`\`\`visual fence`;
