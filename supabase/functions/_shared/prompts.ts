type StudyQuestion = {
  prompt: string;
};

export const gradingPrompt = (
  question: StudyQuestion,
  answerText?: string,
  language = "en",
) =>
  `You are grading a student's response for the question "${
    question.prompt
  }". Evaluate correctness and gaps. Return:
- summary (1-2 sentences)
- correctness (one of: correct / partially correct / incorrect)
- score 0-100
- improvements (bullet list of 2-4 short tips)
If answer is empty, say that no answer was provided. Use LaTeX math notation with $...$ for inline math and $$...$$ for block math when referencing formulas or equations. Answer in JSON. Respond in ${language} but keep JSON keys in English.`;

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

**Material Context:**
${materialContext}

**Guidelines:**
- Keep responses conversational and encouraging
- Keep each turn concise: 1-2 short paragraphs (about 4-8 sentences total)
- Cover one concept/step at a time; avoid full-topic dumps
- End every response with exactly ONE check-in question or prompt to teach back, then stop and wait for the student's reply
- Invite the student to jot or explain their answer on the canvas before continuing
- When asking questions, ask ONE at a time and do not answer it yourself
- If the student seems lost, offer to start from the beginning
- Adapt your explanations based on the student's level of understanding
- Be warm and supportive, but also intellectually rigorous
- Always respond in ${language}
- Use Markdown for formatting; render math with $...$ (inline) and $$...$$ (block).`;

