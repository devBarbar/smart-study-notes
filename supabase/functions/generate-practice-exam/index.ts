import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

Deno.serve(async (req: Request) => {
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
    const authHeader = req.headers.get("Authorization") ?? `Bearer ${Deno.env.get("SUPABASE_ANON_KEY") ?? ""}`;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      global: { fetch, headers: { Authorization: authHeader } },
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: userResult, error: userError } = await supabase.auth.getUser();
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
    const title = (body?.title ?? "").toString().trim() || `Practice Exam - ${new Date().toISOString().slice(0, 10)}`;

    if (!lectureId) {
      return new Response(
        JSON.stringify({ error: "lectureId is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data: exam, error: insertError } = await supabase
      .from("practice_exams")
      .insert({
        user_id: userResult.user.id,
        lecture_id: lectureId,
        title,
        status: "pending",
        question_count: questionCount,
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
    };

    const { data: job, error: jobError } = await supabase
      .from("jobs")
      .insert({
        type: "practice_exam",
        payload,
        status: "pending",
        user_id: userResult.user.id,
      })
      .select("id")
      .single();

    if (jobError || !job?.id) {
      await supabase
        .from("practice_exams")
        .update({ status: "failed", error: jobError?.message ?? "Failed to enqueue job" })
        .eq("id", exam.id);
      throw jobError ?? new Error("Failed to enqueue practice exam job");
    }

    await supabase.from("practice_exams").update({ job_id: job.id }).eq("id", exam.id);

    return new Response(
      JSON.stringify({ practiceExamId: exam.id, jobId: job.id }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("[generate-practice-exam] Error:", error);
    return new Response(
      JSON.stringify({ error: error?.message || "Failed to start practice exam" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});


