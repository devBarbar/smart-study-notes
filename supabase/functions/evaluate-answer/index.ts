import { corsHeaders } from "../_shared/cors.ts";
import { withSentry } from "../_shared/sentry.ts";
import { callChat, ChatCompletionContent, stripCodeFences } from "../_shared/openai.ts";
import { gradingPrompt } from "../_shared/prompts.ts";

type StudyQuestion = {
  id?: string;
  prompt: string;
  targetConcepts?: string[];
  expectedAnswerPoints?: string[];
  checkType?: string;
  requiredForPass?: boolean;
  difficulty?: string;
};

Deno.serve(withSentry("evaluate-answer", async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const {
      question,
      answerText,
      answerImageDataUrl,
      answerCanvasBounds,
      language = "en",
      passScoreThreshold,
    } = await req.json();

    if (!question || !question.prompt) {
      return new Response(
        JSON.stringify({ error: "question.prompt is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const content: ChatCompletionContent[] = [
      {
        type: "text",
        text: gradingPrompt(
          question as StudyQuestion,
          answerText,
          language,
          undefined,
          answerCanvasBounds,
          passScoreThreshold,
        ),
      },
    ];

    if (answerText) {
      content.push({ type: "text", text: `Student answer:\n${answerText}` });
    }

    if (answerImageDataUrl) {
      content.push({
        type: "image_url",
        image_url: { url: String(answerImageDataUrl) },
      });
    }

    const output = await callChat(content);

    let feedback: any = null;
    try {
      feedback = JSON.parse(stripCodeFences(output.message));
    } catch {
      feedback = {
        summary: output.message,
        correctness: "unknown",
      };
    }

    const normalizedFeedback = {
      summary: feedback.summary ?? "No summary",
      correctness: feedback.correctness ?? "unknown",
      score: feedback.score ?? undefined,
      whatWentRight: Array.isArray(feedback.whatWentRight)
        ? feedback.whatWentRight
        : [],
      whatWentWrong: Array.isArray(feedback.whatWentWrong)
        ? feedback.whatWentWrong
        : [],
      correctAnswer: typeof feedback.correctAnswer === "string"
        ? feedback.correctAnswer
        : undefined,
      rewriteExample: typeof feedback.rewriteExample === "string"
        ? feedback.rewriteExample
        : undefined,
      improvements: Array.isArray(feedback.improvements)
        ? feedback.improvements
        : [],
      misconceptions: Array.isArray(feedback.misconceptions)
        ? feedback.misconceptions
        : [],
      followUpQuestion: typeof feedback.followUpQuestion === "string"
        ? feedback.followUpQuestion
        : undefined,
      sourceNotes: Array.isArray(feedback.sourceNotes)
        ? feedback.sourceNotes
        : [],
      checkType: typeof feedback.checkType === "string" ? feedback.checkType : undefined,
      canCountForPass: typeof feedback.canCountForPass === "boolean"
        ? feedback.canCountForPass
        : undefined,
      missingPrerequisites: Array.isArray(feedback.missingPrerequisites)
        ? feedback.missingPrerequisites
        : [],
      understandingLevel: typeof feedback.understandingLevel === "string"
        ? feedback.understandingLevel
        : undefined,
      rubric: feedback.rubric && typeof feedback.rubric === "object" ? feedback.rubric : undefined,
    };

    return new Response(
      JSON.stringify({ feedback: normalizedFeedback }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("[evaluate-answer] Error:", error);
    return new Response(
      JSON.stringify({ error: error?.message || "Failed to evaluate answer" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
}));
