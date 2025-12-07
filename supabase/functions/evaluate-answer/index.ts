import { corsHeaders } from "../_shared/cors.ts";
import { callChat, ChatCompletionContent } from "../_shared/openai.ts";
import { gradingPrompt } from "../_shared/prompts.ts";

type StudyQuestion = { id?: string; prompt: string };

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { question, answerText, answerImageDataUrl, language = "en" } = await req.json();

    if (!question || !question.prompt) {
      return new Response(
        JSON.stringify({ error: "question.prompt is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const content: ChatCompletionContent[] = [
      { type: "text", text: gradingPrompt(question as StudyQuestion, answerText, language) },
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
      feedback = JSON.parse(output);
    } catch {
      feedback = {
        summary: output,
        correctness: "unknown",
      };
    }

    const normalizedFeedback = {
      summary: feedback.summary ?? "No summary",
      correctness: feedback.correctness ?? "unknown",
      score: feedback.score ?? undefined,
      improvements: Array.isArray(feedback.improvements)
        ? feedback.improvements
        : [],
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
});

