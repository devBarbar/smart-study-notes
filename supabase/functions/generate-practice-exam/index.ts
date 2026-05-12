import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { withSentry } from "../_shared/sentry.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");

const getErrorMessage = (error: unknown, fallback: string) => {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return fallback;
  }
};

const kickProcessJob = (jobId?: string) => {
  if (!SUPABASE_URL) return;
  const token = SUPABASE_ANON_KEY ?? SUPABASE_SERVICE_ROLE_KEY;
  if (!token) return;

  return fetch(`${SUPABASE_URL}/functions/v1/process-job`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ source: "generate-practice-exam", jobId }),
  }).catch((error) => {
    console.error("[generate-practice-exam] process-job kick failed:", error);
  });
};

Deno.serve(withSentry("generate-practice-exam", async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return new Response(
      JSON.stringify({ error: "Missing Supabase service configuration." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  try {
    const authHeader = req.headers.get("Authorization");
    const authClient = createClient(
      SUPABASE_URL,
      SUPABASE_ANON_KEY ?? SUPABASE_SERVICE_ROLE_KEY,
      {
        global: { fetch, headers: authHeader ? { Authorization: authHeader } : {} },
        auth: { autoRefreshToken: false, persistSession: false },
      },
    );
    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: userResult, error: userError } = await authClient.auth.getUser();
    if (userError || !userResult?.user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const body = await req.json();
    const lectureId = body?.lectureId;
    const requestedCount = Number(body?.questionCount ?? 5);
    const questionCount = Number.isFinite(requestedCount) ? Math.max(1, Math.min(20, requestedCount)) : 5;
    const language = (body?.language ?? "en") as string;
    const category = (body?.category ?? "").toString().trim() || null;
    const defaultTitle = category 
      ? `${category} - Cluster Quiz`
      : `Practice Exam - ${new Date().toISOString().slice(0, 10)}`;
    const title = (body?.title ?? "").toString().trim() || defaultTitle;

    if (!lectureId) {
      return new Response(
        JSON.stringify({ error: "lectureId is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const userId = userResult.user.id;

    const { data: lecture, error: lectureError } = await adminClient
      .from("lectures")
      .select("id")
      .eq("id", lectureId)
      .eq("user_id", userId)
      .maybeSingle();

    if (lectureError) throw lectureError;
    if (!lecture) {
      return new Response(
        JSON.stringify({ error: "Lecture not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data: exam, error: insertError } = await adminClient
      .from("practice_exams")
      .insert({
        user_id: userId,
        lecture_id: lectureId,
        title,
        status: "pending",
        question_count: questionCount,
        category,
      })
      .select("id")
      .single();

    if (insertError || !exam?.id) {
      throw insertError ?? new Error("Failed to create practice exam");
    }

    const payload = {
      practiceExamId: exam.id,
      lectureId,
      questionCount,
      language,
      category,
    };

    const { data: job, error: jobError } = await adminClient
      .from("jobs")
      .insert({
        type: "practice_exam",
        payload,
        status: "pending",
        user_id: userId,
      })
      .select("id")
      .single();

    if (jobError || !job?.id) {
      await adminClient
        .from("practice_exams")
        .update({ status: "failed", error: jobError?.message ?? "Failed to enqueue job" })
        .eq("id", exam.id);
      throw jobError ?? new Error("Failed to enqueue practice exam job");
    }

    await adminClient.from("practice_exams").update({ job_id: job.id }).eq("id", exam.id);
    await kickProcessJob(job.id);

    return new Response(
      JSON.stringify({ practiceExamId: exam.id, jobId: job.id }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("[generate-practice-exam] Error:", error);
    const message = getErrorMessage(error, "Failed to start practice exam");
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
}));
