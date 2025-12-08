import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { OpenAIUsage } from "./openai.ts";

type UsageLogParams = {
  supabase: SupabaseClient;
  userId: string | null;
  lectureId?: string | null;
  jobId?: string | null;
  feature: string;
  model?: string | null;
  usage?: OpenAIUsage;
  costUsd?: number;
  inputCostUsd?: number;
  outputCostUsd?: number;
  audioDurationSeconds?: number;
  metadata?: Record<string, unknown> | null;
};

export const insertUsageLog = async ({
  supabase,
  userId,
  lectureId = null,
  jobId = null,
  feature,
  model = null,
  usage,
  costUsd,
  inputCostUsd,
  outputCostUsd,
  audioDurationSeconds,
  metadata = null,
}: UsageLogParams) => {
  const promptTokens =
    usage?.promptTokens ??
    (usage?.totalTokens !== undefined && usage.completionTokens !== undefined
      ? Math.max(0, usage.totalTokens - usage.completionTokens)
      : usage?.totalTokens);

  const completionTokens = usage?.completionTokens;
  const totalTokens = usage?.totalTokens ?? (promptTokens ?? 0) + (completionTokens ?? 0);

  const resolvedInputCost = typeof inputCostUsd === "number" ? inputCostUsd : null;
  const resolvedOutputCost = typeof outputCostUsd === "number" ? outputCostUsd : null;
  const resolvedCost =
    typeof costUsd === "number"
      ? costUsd
      : (resolvedInputCost ?? 0) + (resolvedOutputCost ?? 0);

  const { error } = await supabase.from("ai_usage_logs").insert({
    user_id: userId,
    lecture_id: lectureId,
    job_id: jobId,
    feature,
    model,
    prompt_tokens: promptTokens ?? null,
    completion_tokens: completionTokens ?? null,
    total_tokens: totalTokens ?? null,
    audio_duration_seconds: audioDurationSeconds ?? null,
    input_cost_usd: resolvedInputCost,
    output_cost_usd: resolvedOutputCost,
    cost_usd: resolvedCost,
    metadata: metadata ?? null,
  });

  if (error) {
    console.warn("[usage] failed to log ai usage", { feature, error: error.message });
  }
};
