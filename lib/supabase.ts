import { CanvasBounds, CanvasPage, LanguageCode, Lecture, LectureFile, MasteryData, Material, PlanStatus, PracticeExam, PracticeExamQuestion, PracticeExamResponse, PracticeExamStatus, ReviewEvent, RoadmapStep, SectionStatus, StreakInfo, StudyAnswerLink, StudyChatMessage, StudyPlanEntry, StudyReadiness, StudySession } from '@/types';
import { createClient, Session, SupabaseClient, User } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const MATERIALS_BUCKET = 'materials';

// Secure storage adapter for native platforms
const ExpoSecureStoreAdapter = {
  getItem: async (key: string): Promise<string | null> => {
    if (Platform.OS === 'web') {
      return localStorage.getItem(key);
    }
    return SecureStore.getItemAsync(key);
  },
  setItem: async (key: string, value: string): Promise<void> => {
    if (Platform.OS === 'web') {
      localStorage.setItem(key, value);
      return;
    }
    await SecureStore.setItemAsync(key, value);
  },
  removeItem: async (key: string): Promise<void> => {
    if (Platform.OS === 'web') {
      localStorage.removeItem(key);
      return;
    }
    await SecureStore.deleteItemAsync(key);
  },
};

let supabase: SupabaseClient | null = null;

if (SUPABASE_URL && SUPABASE_ANON_KEY) {
  supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      storage: ExpoSecureStoreAdapter,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  });
  console.log('[supabase] client created', {
    hasUrl: Boolean(SUPABASE_URL),
    hasKey: Boolean(SUPABASE_ANON_KEY),
    urlHost: (() => {
      try {
        return new URL(SUPABASE_URL).host;
      } catch {
        return 'invalid-url';
      }
    })(),
  });
} else {
  console.warn('[supabase] missing config', {
    hasUrl: Boolean(SUPABASE_URL),
    hasKey: Boolean(SUPABASE_ANON_KEY),
  });
}

const ensureClient = () => {
  if (!supabase) {
    throw new Error('Supabase is not configured. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.');
  }
  return supabase;
};

/**
 * Get the current authenticated user's ID
 * Returns null if not authenticated
 */
const getCurrentUserId = async (): Promise<string | null> => {
  const client = ensureClient();
  const { data: { user } } = await client.auth.getUser();
  return user?.id ?? null;
};

/**
 * Get the current authenticated user's ID or throw if not authenticated
 */
const requireUserId = async (): Promise<string> => {
  const userId = await getCurrentUserId();
  if (!userId) {
    throw new Error('User must be authenticated to perform this action');
  }
  return userId;
};

export type UserLanguagePreferences = {
  appLanguage: LanguageCode;
  agentLanguage: LanguageCode;
};

const DEFAULT_LANGUAGE_PREFS: UserLanguagePreferences = {
  appLanguage: 'en',
  agentLanguage: 'en',
};

export const getLanguagePreferences = async (): Promise<UserLanguagePreferences> => {
  const client = ensureClient();
  const userId = await requireUserId();
  const { data, error } = await client
    .from('user_profiles')
    .select('app_language, agent_language')
    .eq('user_id', userId)
    .single();

  if (error) {
    // Table or row might not exist yet
    if (error.code === 'PGRST116' || error.code === '42P01') {
      return DEFAULT_LANGUAGE_PREFS;
    }
    throw error;
  }

  return {
    appLanguage: (data?.app_language as LanguageCode) ?? DEFAULT_LANGUAGE_PREFS.appLanguage,
    agentLanguage: (data?.agent_language as LanguageCode) ?? DEFAULT_LANGUAGE_PREFS.agentLanguage,
  };
};

export const upsertLanguagePreferences = async (prefs: UserLanguagePreferences): Promise<void> => {
  const client = ensureClient();
  const userId = await requireUserId();
  const { error } = await client.from('user_profiles').upsert({
    user_id: userId,
    app_language: prefs.appLanguage,
    agent_language: prefs.agentLanguage,
  });

  if (error) {
    throw error;
  }
};

/**
 * Sanitize text for PostgreSQL storage - removes null characters and other problematic Unicode
 */
const sanitizeText = (text: string | null | undefined): string | null => {
  if (!text) return null;
  return text
    .replace(/\u0000/g, '') // Null character
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '') // Other control characters except \t, \n, \r
    .trim();
};

// Embedding chunk types
export type LectureFileChunk = {
  id: string;
  lectureId: string;
  lectureFileId: string;
  pageNumber: number;
  chunkIndex: number;
  content: string;
  similarity?: number;
  sourceBBox?: CanvasBounds;
};

type NewLectureChunkInput = {
  lectureId: string;
  lectureFileId: string;
  pageNumber: number;
  chunkIndex: number;
  content: string;
  embedding: number[];
  sourceBBox?: CanvasBounds;
  contentHash?: string;
};

export const deleteLectureChunksForLecture = async (lectureId: string) => {
  const client = ensureClient();
  await requireUserId();
  const { error } = await client.from('lecture_file_chunks').delete().eq('lecture_id', lectureId);
  if (error) throw error;
};

export const countLectureChunks = async (lectureId: string): Promise<number> => {
  const client = ensureClient();
  const { count, error } = await client
    .from('lecture_file_chunks')
    .select('id', { count: 'exact', head: true })
    .eq('lecture_id', lectureId);

  if (error) {
    if (error.code === '42P01') return 0;
    throw error;
  }
  return count ?? 0;
};

export const upsertLectureChunks = async (chunks: NewLectureChunkInput[]) => {
  if (chunks.length === 0) return;
  const client = ensureClient();
  await requireUserId();
  const payload = chunks.map((chunk) => ({
    lecture_id: chunk.lectureId,
    lecture_file_id: chunk.lectureFileId,
    page_number: chunk.pageNumber,
    chunk_index: chunk.chunkIndex,
    content: chunk.content,
    content_hash: chunk.contentHash ?? null,
    embedding: chunk.embedding,
    source_bbox: chunk.sourceBBox ?? null,
  }));

  const { error } = await client
    .from('lecture_file_chunks')
    .upsert(payload, { onConflict: 'content_hash' });
  if (error) throw error;
};

export const searchLectureChunks = async (
  queryEmbedding: number[],
  lectureIds: string[],
  matchCount = 6,
  minSimilarity = 0.2
): Promise<LectureFileChunk[]> => {
  const client = ensureClient();
  const { data, error } = await client.rpc('match_lecture_chunks', {
    query_embedding: queryEmbedding,
    match_count: matchCount,
    min_similarity: minSimilarity,
    lecture_filter: lectureIds,
  });

  if (error) {
    if (error.code === '42P01') {
      console.warn('[supabase] lecture_file_chunks table missing, skipping retrieval');
      return [];
    }
    console.warn('[supabase] searchLectureChunks failed', error);
    throw error;
  }

  return (data ?? []).map((row: any) => ({
    id: row.id,
    lectureId: row.lecture_id,
    lectureFileId: row.lecture_file_id,
    pageNumber: row.page_number,
    chunkIndex: row.chunk_index,
    content: row.content,
    similarity: row.similarity ?? undefined,
  }));
};

export const listMaterials = async (): Promise<Material[]> => {
  const client = ensureClient();
  const { data, error } = await client.from('materials').select().order('created_at', { ascending: false });
  if (error) throw error;
  return data.map((row) => ({
    id: row.id,
    title: row.title,
    description: row.description ?? '',
    type: row.type,
    uri: row.uri,
    previewUri: row.preview_uri ?? undefined,
    createdAt: row.created_at,
  }));
};

export const saveMaterial = async (material: Omit<Material, 'createdAt'>) => {
  const client = ensureClient();
  const userId = await requireUserId();
  const { error } = await client.from('materials').upsert({
    id: material.id,
    title: material.title,
    description: material.description ?? '',
    type: material.type,
    uri: material.uri,
    preview_uri: material.previewUri ?? null,
    user_id: userId,
  });
  if (error) {
    console.warn('[supabase] saveMaterial error', { message: error.message, code: error.code });
    throw error;
  }
};

export const listSessions = async (): Promise<StudySession[]> => {
  const client = ensureClient();
  const { data, error } = await client.from('sessions').select().order('created_at', { ascending: false });
  if (error) throw error;
  return data.map((row) => ({
    id: row.id,
    materialId: row.material_id ?? undefined,
    lectureId: row.lecture_id ?? undefined,
    studyPlanEntryId: row.study_plan_entry_id ?? undefined,
    title: row.title,
    status: row.status,
    lastQuestionId: row.last_question_id ?? undefined,
    canvasData: row.canvas_data ?? undefined,
    canvasPages: (row.canvas_pages as CanvasPage[] | null) ?? undefined,
    notesText: row.notes_text ?? undefined,
    createdAt: row.created_at,
  }));
};

export const createSession = async (session: Omit<StudySession, 'createdAt'>) => {
  const client = ensureClient();
  const userId = await requireUserId();
  const { error } = await client.from('sessions').insert({
    id: session.id,
    material_id: session.materialId || null,
    lecture_id: session.lectureId || null,
    study_plan_entry_id: session.studyPlanEntryId || null,
    title: session.title,
    status: session.status,
    last_question_id: session.lastQuestionId || null,
    user_id: userId,
  });
  if (error) throw error;
};

export const updateSession = async (sessionId: string, patch: Partial<StudySession>) => {
  const client = ensureClient();
  
  // Build update object only with defined fields
  const updateData: Record<string, unknown> = {};
  if (patch.title !== undefined) updateData.title = patch.title;
  if (patch.status !== undefined) updateData.status = patch.status;
  if (patch.lastQuestionId !== undefined) updateData.last_question_id = patch.lastQuestionId;
  if (patch.lectureId !== undefined) updateData.lecture_id = patch.lectureId;
  if (patch.canvasData !== undefined) updateData.canvas_data = patch.canvasData;
  if (patch.canvasPages !== undefined) updateData.canvas_pages = patch.canvasPages;
  if (patch.notesText !== undefined) updateData.notes_text = patch.notesText;
  
  if (Object.keys(updateData).length === 0) return;
  
  const { error } = await client.from('sessions').update(updateData).eq('id', sessionId);
  if (error) throw error;
};

export const getSupabase = () => supabase;

const extractMaterialPath = (uri: string): string | null => {
  if (!uri) return null;
  if (uri.startsWith(`${MATERIALS_BUCKET}/`)) {
    return uri.slice(MATERIALS_BUCKET.length + 1);
  }

  const marker = `/storage/v1/object/public/${MATERIALS_BUCKET}/`;
  try {
    const url = new URL(uri);
    const idx = url.pathname.indexOf(marker);
    if (idx >= 0) {
      const path = url.pathname.slice(idx + marker.length);
      return path || null;
    }
  } catch {
    // uri is not a URL, ignore
  }

  return null;
};

export const listLectures = async (): Promise<Lecture[]> => {
  const client = ensureClient();
  const [
    { data: lectures, error: lectureError }, 
    { data: files, error: fileError },
    { data: studyPlanEntries, error: studyPlanError }
  ] = await Promise.all([
    client.from('lectures').select().order('created_at', { ascending: false }),
    client.from('lecture_files').select(),
    client.from('study_plan_entries').select().order('order_index', { ascending: true }),
  ]);
  if (lectureError) throw lectureError;
  if (fileError) throw fileError;
  if (studyPlanError) {
    console.warn('[supabase] study_plan_entries query failed (table may not exist yet):', studyPlanError.message);
  }

  return (lectures ?? []).map((row) => {
    const lectureFiles = (files ?? [])
      .filter((file) => file.lecture_id === row.id)
      .map<LectureFile>((file) => ({
        id: file.id,
        lectureId: file.lecture_id,
        name: file.name,
        uri: file.uri,
        mimeType: file.mime_type ?? 'application/pdf',
        extractedText: file.extracted_text ?? undefined,
        isExam: file.is_exam ?? false,
        createdAt: file.created_at,
      }));

    const studyPlan = (studyPlanEntries ?? [])
      .filter((entry) => entry.lecture_id === row.id)
      .map<StudyPlanEntry>((entry) => ({
        id: entry.id,
        lectureId: entry.lecture_id,
        title: entry.title,
        description: entry.description ?? undefined,
        keyConcepts: entry.key_concepts ?? [],
        orderIndex: entry.order_index ?? 0,
        category: entry.category ?? undefined,
        importanceTier: (entry.importance_tier as StudyPlanEntry['importanceTier']) ?? 'core',
        priorityScore: entry.priority_score ?? 0,
        status: (entry.status as SectionStatus | null) ?? 'not_started',
        statusScore: entry.status_score ?? undefined,
        statusUpdatedAt: entry.status_updated_at ?? undefined,
        masteryScore: entry.mastery_score ?? undefined,
        nextReviewAt: entry.next_review_at ?? undefined,
        reviewCount: entry.review_count ?? undefined,
        easeFactor: entry.ease_factor ?? undefined,
        fromExamSource: entry.from_exam_source ?? false,
        examRelevance: entry.exam_relevance as StudyPlanEntry['examRelevance'] ?? undefined,
        mentionedInNotes: entry.mentioned_in_notes ?? false,
        createdAt: entry.created_at,
      }));

    return {
      id: row.id,
      title: row.title,
      description: row.description ?? '',
      createdAt: row.created_at,
      additionalNotes: row.additional_notes ?? undefined,
      files: lectureFiles,
      studyPlan: studyPlan.length > 0 ? studyPlan : undefined,
      roadmap: (row.roadmap as RoadmapStep[] | null) ?? undefined,
      readiness: (row.readiness as StudyReadiness | null) ?? undefined,
      planStatus: (row.plan_status as PlanStatus | null) ?? 'ready',
      planGeneratedAt: row.plan_generated_at ?? undefined,
      planError: row.plan_error ?? undefined,
    };
  });
};

type SaveLectureInput = Pick<Lecture, 'id' | 'title' | 'description'> & {
  additionalNotes?: string | null;
  roadmap?: RoadmapStep[] | null;
  readiness?: StudyReadiness | null;
  planStatus?: PlanStatus;
  planGeneratedAt?: string | null;
  planError?: string | null;
};

export const saveLecture = async (lecture: SaveLectureInput) => {
  const client = ensureClient();
  const userId = await requireUserId();
  const payload: Record<string, unknown> = {
    id: lecture.id,
    title: lecture.title,
    description: lecture.description ?? '',
    user_id: userId,
  };

  if (lecture.additionalNotes !== undefined) {
    payload.additional_notes = sanitizeText(lecture.additionalNotes);
  }
  if (lecture.roadmap !== undefined) {
    payload.roadmap = lecture.roadmap ?? null;
  }
  if (lecture.readiness !== undefined) {
    payload.readiness = lecture.readiness ?? null;
  }
  if (lecture.planStatus !== undefined) payload.plan_status = lecture.planStatus;
  if (lecture.planGeneratedAt !== undefined) payload.plan_generated_at = lecture.planGeneratedAt;
  if (lecture.planError !== undefined) payload.plan_error = sanitizeText(lecture.planError);

  const { error } = await client.from('lectures').upsert(payload);
  if (error) throw error;
};

export const updateLectureNotes = async (lectureId: string, additionalNotes: string | null) => {
  const client = ensureClient();
  await requireUserId();
  const { error } = await client
    .from('lectures')
    .update({ additional_notes: sanitizeText(additionalNotes) })
    .eq('id', lectureId);
  if (error) throw error;
};

export const saveLectureInsights = async (
  lectureId: string,
  insights: { roadmap?: RoadmapStep[] | null; readiness?: StudyReadiness | null }
) => {
  const client = ensureClient();
  await requireUserId();
  const patch: Record<string, unknown> = {};

  if (insights.roadmap !== undefined) patch.roadmap = insights.roadmap ?? null;
  if (insights.readiness !== undefined) patch.readiness = insights.readiness ?? null;

  if (Object.keys(patch).length === 0) return;

  const { error } = await client.from('lectures').update(patch).eq('id', lectureId);
  if (error) throw error;
};

export const updateLecturePlanStatus = async (
  lectureId: string,
  patch: { planStatus?: PlanStatus; planGeneratedAt?: string | null; planError?: string | null }
) => {
  const client = ensureClient();
  const updateData: Record<string, unknown> = {};

  if (patch.planStatus !== undefined) updateData.plan_status = patch.planStatus;
  if (patch.planGeneratedAt !== undefined) updateData.plan_generated_at = patch.planGeneratedAt;
  if (patch.planError !== undefined) updateData.plan_error = sanitizeText(patch.planError);

  if (Object.keys(updateData).length === 0) return;

  const { error } = await client.from('lectures').update(updateData).eq('id', lectureId);
  if (error) throw error;
};

export const saveLectureFiles = async (lectureId: string, files: Omit<LectureFile, 'lectureId' | 'createdAt'>[]) => {
  if (files.length === 0) return;
  const client = ensureClient();
  const userId = await requireUserId();
  const payload = files.map((file) => ({
    id: file.id,
    lecture_id: lectureId,
    name: file.name,
    uri: file.uri,
    mime_type: file.mimeType,
    extracted_text: sanitizeText(file.extractedText),
    is_exam: file.isExam ?? false,
    user_id: userId,
  }));
  const { error } = await client.from('lecture_files').upsert(payload);
  if (error) throw error;
};

export const deleteLecture = async (lectureId: string, files?: LectureFile[]) => {
  const client = ensureClient();
  await requireUserId();

  const { error } = await client.rpc('delete_lecture_cascade', { p_lecture_id: lectureId });
  if (error) {
    console.warn('[supabase] deleteLecture rpc failed', { message: error.message, code: error.code });
    throw error;
  }

  const materialPaths = Array.from(
    new Set(
      (files ?? [])
        .map((file) => extractMaterialPath(file.uri))
        .filter((path): path is string => Boolean(path))
    )
  );

  if (materialPaths.length > 0) {
    const { error: storageError } = await client.storage.from(MATERIALS_BUCKET).remove(materialPaths);
    if (storageError) {
      console.warn('[supabase] storage delete failed', { message: storageError.message, paths: materialPaths });
      throw storageError;
    }
  }
};

export const updateLectureFileText = async (fileId: string, extractedText: string) => {
  const client = ensureClient();
  const { error } = await client.from('lecture_files').update({
    extracted_text: sanitizeText(extractedText),
  }).eq('id', fileId);
  if (error) throw error;
};

export const saveAnswerLink = async (link: Omit<StudyAnswerLink, 'createdAt'>) => {
  const client = ensureClient();
  const userId = await requireUserId();
  const { error } = await client.from('answer_links').insert({
    id: link.id,
    session_id: link.sessionId,
    question_id: link.questionId,
    page_id: link.pageId ?? null,
    answer_text: link.answerText ?? null,
    answer_image_uri: link.answerImageUri ?? null,
    canvas_bounds: link.canvasBounds ?? null,
    user_id: userId,
  });
  if (error) throw error;
};

export const listAnswerLinks = async (sessionId: string): Promise<StudyAnswerLink[]> => {
  const client = ensureClient();
  const { data, error } = await client.from('answer_links').select().eq('session_id', sessionId).order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    sessionId: row.session_id,
    questionId: row.question_id,
    pageId: row.page_id ?? undefined,
    answerText: row.answer_text ?? undefined,
    answerImageUri: row.answer_image_uri ?? undefined,
    canvasBounds: row.canvas_bounds ?? undefined,
    createdAt: row.created_at,
  }));
};

// Study Plan CRUD functions

export const saveStudyPlanEntries = async (
  lectureId: string,
  entries: Omit<StudyPlanEntry, 'id' | 'lectureId' | 'createdAt'>[]
) => {
  if (entries.length === 0) return;
  const client = ensureClient();
  const userId = await requireUserId();
  
  const payload = entries.map((entry) => {
    const record: Record<string, unknown> = {
      lecture_id: lectureId,
      title: entry.title,
      description: entry.description ?? null,
      key_concepts: entry.keyConcepts ?? [],
      order_index: entry.orderIndex,
      category: entry.category ?? null,
      importance_tier: entry.importanceTier ?? 'core',
      priority_score: entry.priorityScore ?? 0,
      status: entry.status ?? 'not_started',
      user_id: userId,
      from_exam_source: entry.fromExamSource ?? false,
      exam_relevance: entry.examRelevance ?? null,
      mentioned_in_notes: entry.mentionedInNotes ?? false,
    };

    if (entry.statusScore !== undefined) record.status_score = entry.statusScore;
    if (entry.statusUpdatedAt !== undefined) record.status_updated_at = entry.statusUpdatedAt;
    if (entry.masteryScore !== undefined) record.mastery_score = entry.masteryScore;
    if (entry.nextReviewAt !== undefined) record.next_review_at = entry.nextReviewAt;
    if (entry.reviewCount !== undefined) record.review_count = entry.reviewCount;
    if (entry.easeFactor !== undefined) record.ease_factor = entry.easeFactor;

    return record;
  });

  const { error } = await client.from('study_plan_entries').insert(payload);
  if (error) throw error;
};

export const getStudyPlanEntries = async (lectureId: string): Promise<StudyPlanEntry[]> => {
  const client = ensureClient();
  const { data, error } = await client
    .from('study_plan_entries')
    .select()
    .eq('lecture_id', lectureId)
    .order('order_index', { ascending: true });
  
  if (error) throw error;
  
  return (data ?? []).map((row) => ({
    id: row.id,
    lectureId: row.lecture_id,
    title: row.title,
    description: row.description ?? undefined,
    keyConcepts: row.key_concepts ?? [],
    orderIndex: row.order_index ?? 0,
    category: row.category ?? undefined,
    importanceTier: (row.importance_tier as StudyPlanEntry['importanceTier']) ?? 'core',
    priorityScore: row.priority_score ?? 0,
    status: (row.status as SectionStatus | null) ?? 'not_started',
    statusScore: row.status_score ?? undefined,
    statusUpdatedAt: row.status_updated_at ?? undefined,
    masteryScore: row.mastery_score ?? undefined,
    nextReviewAt: row.next_review_at ?? undefined,
    reviewCount: row.review_count ?? undefined,
    easeFactor: row.ease_factor ?? undefined,
    fromExamSource: row.from_exam_source ?? false,
    examRelevance: row.exam_relevance as StudyPlanEntry['examRelevance'] ?? undefined,
    mentionedInNotes: row.mentioned_in_notes ?? false,
    createdAt: row.created_at,
  }));
};

export const getStudyPlanEntry = async (entryId: string): Promise<StudyPlanEntry | null> => {
  const client = ensureClient();
  const { data, error } = await client
    .from('study_plan_entries')
    .select()
    .eq('id', entryId)
    .single();
  
  if (error) {
    if (error.code === 'PGRST116') return null; // Not found
    throw error;
  }
  
  return {
    id: data.id,
    lectureId: data.lecture_id,
    title: data.title,
    description: data.description ?? undefined,
    keyConcepts: data.key_concepts ?? [],
    orderIndex: data.order_index ?? 0,
    category: data.category ?? undefined,
    importanceTier: (data.importance_tier as StudyPlanEntry['importanceTier']) ?? 'core',
    priorityScore: data.priority_score ?? 0,
    status: (data.status as SectionStatus | null) ?? 'not_started',
    statusScore: data.status_score ?? undefined,
    statusUpdatedAt: data.status_updated_at ?? undefined,
    masteryScore: data.mastery_score ?? undefined,
    nextReviewAt: data.next_review_at ?? undefined,
    reviewCount: data.review_count ?? undefined,
    easeFactor: data.ease_factor ?? undefined,
    fromExamSource: data.from_exam_source ?? false,
    examRelevance: data.exam_relevance as StudyPlanEntry['examRelevance'] ?? undefined,
    mentionedInNotes: data.mentioned_in_notes ?? false,
    createdAt: data.created_at,
  };
};

export const updateStudyPlanEntryStatus = async (
  entryId: string,
  update: { status: SectionStatus; statusScore?: number; statusUpdatedAt?: string }
) => {
  const client = ensureClient();
  const userId = await requireUserId();

  const patch: Record<string, unknown> = {
    status: update.status,
    status_score: update.statusScore ?? null,
    status_updated_at: update.statusUpdatedAt ?? new Date().toISOString(),
  };

  const { error } = await client
    .from('study_plan_entries')
    .update(patch)
    .eq('id', entryId)
    .eq('user_id', userId);

  if (error) throw error;
};

export const updateStudyPlanEntryMastery = async (
  entryId: string,
  update: Partial<MasteryData> & { status?: SectionStatus; statusScore?: number; statusUpdatedAt?: string }
): Promise<void> => {
  const client = ensureClient();
  const userId = await requireUserId();

  const patch: Record<string, unknown> = {};
  if (update.masteryScore !== undefined) patch.mastery_score = update.masteryScore;
  if (update.nextReviewAt !== undefined) patch.next_review_at = update.nextReviewAt;
  if (update.reviewCount !== undefined) patch.review_count = update.reviewCount;
  if (update.easeFactor !== undefined) patch.ease_factor = update.easeFactor;
  if (update.status !== undefined) patch.status = update.status;
  if (update.statusScore !== undefined) patch.status_score = update.statusScore;
  if (update.statusUpdatedAt !== undefined) patch.status_updated_at = update.statusUpdatedAt ?? new Date().toISOString();

  if (Object.keys(patch).length === 0) return;

  const { error } = await client
    .from('study_plan_entries')
    .update(patch)
    .eq('id', entryId)
    .eq('user_id', userId);

  if (error) throw error;
};

// Review history
export const addReviewEvent = async (
  event: Omit<ReviewEvent, 'id' | 'reviewedAt'> & { reviewedAt?: string }
): Promise<void> => {
  const client = ensureClient();
  const userId = await requireUserId();

  const { error } = await client.from('review_history').insert({
    study_plan_entry_id: event.studyPlanEntryId,
    user_id: userId,
    score: event.score ?? null,
    response_quality: event.responseQuality ?? null,
    reviewed_at: event.reviewedAt ?? new Date().toISOString(),
  });
  if (error) throw error;
};

export const listReviewEvents = async (studyPlanEntryId: string, limit = 20): Promise<ReviewEvent[]> => {
  const client = ensureClient();
  const { data, error } = await client
    .from('review_history')
    .select()
    .eq('study_plan_entry_id', studyPlanEntryId)
    .order('reviewed_at', { ascending: false })
    .limit(limit);

  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row.id,
    studyPlanEntryId: row.study_plan_entry_id,
    score: row.score ?? undefined,
    responseQuality: row.response_quality ?? undefined,
    reviewedAt: row.reviewed_at,
  }));
};

// Streaks
export const getUserStreak = async (): Promise<StreakInfo> => {
  const client = ensureClient();
  const userId = await requireUserId();
  const { data, error } = await client
    .from('user_profiles')
    .select('current_streak, longest_streak, last_review_date')
    .eq('user_id', userId)
    .single();

  if (error) throw error;

  return {
    current: data?.current_streak ?? 0,
    longest: data?.longest_streak ?? 0,
    lastReviewDate: data?.last_review_date ?? undefined,
  };
};

export const updateUserStreak = async (patch: Partial<StreakInfo>): Promise<void> => {
  const client = ensureClient();
  const userId = await requireUserId();
  const update: Record<string, unknown> = {};
  if (patch.current !== undefined) update.current_streak = patch.current;
  if (patch.longest !== undefined) update.longest_streak = patch.longest;
  if (patch.lastReviewDate !== undefined) update.last_review_date = patch.lastReviewDate;

  if (Object.keys(update).length === 0) return;

  const { error } = await client
    .from('user_profiles')
    .update(update)
    .eq('user_id', userId);
  if (error) throw error;
};

export const getLectureWithFiles = async (lectureId: string): Promise<Lecture | null> => {
  const client = ensureClient();
  
  const [
    { data: lecture, error: lectureError },
    { data: files, error: filesError },
    { data: studyPlanEntries, error: studyPlanError }
  ] = await Promise.all([
    client.from('lectures').select().eq('id', lectureId).single(),
    client.from('lecture_files').select().eq('lecture_id', lectureId),
    client.from('study_plan_entries').select().eq('lecture_id', lectureId).order('order_index', { ascending: true }),
  ]);
  
  if (lectureError) {
    if (lectureError.code === 'PGRST116') return null;
    throw lectureError;
  }
  if (filesError) throw filesError;
  if (studyPlanError) {
    console.warn('[supabase] study_plan_entries query failed:', studyPlanError.message);
  }
  
  const lectureFiles = (files ?? []).map<LectureFile>((file) => ({
    id: file.id,
    lectureId: file.lecture_id,
    name: file.name,
    uri: file.uri,
    mimeType: file.mime_type ?? 'application/pdf',
    extractedText: file.extracted_text ?? undefined,
    isExam: file.is_exam ?? false,
    createdAt: file.created_at,
  }));

  const studyPlan = (studyPlanEntries ?? []).map<StudyPlanEntry>((entry) => ({
    id: entry.id,
    lectureId: entry.lecture_id,
    title: entry.title,
    description: entry.description ?? undefined,
    keyConcepts: entry.key_concepts ?? [],
    orderIndex: entry.order_index ?? 0,
    category: entry.category ?? undefined,
    importanceTier: (entry.importance_tier as StudyPlanEntry['importanceTier']) ?? 'core',
    priorityScore: entry.priority_score ?? 0,
    status: (entry.status as SectionStatus | null) ?? 'not_started',
    statusScore: entry.status_score ?? undefined,
    statusUpdatedAt: entry.status_updated_at ?? undefined,
    masteryScore: entry.mastery_score ?? undefined,
    nextReviewAt: entry.next_review_at ?? undefined,
    reviewCount: entry.review_count ?? undefined,
    easeFactor: entry.ease_factor ?? undefined,
    fromExamSource: entry.from_exam_source ?? false,
    examRelevance: entry.exam_relevance as StudyPlanEntry['examRelevance'] ?? undefined,
    mentionedInNotes: entry.mentioned_in_notes ?? false,
    createdAt: entry.created_at,
  }));
  
  return {
    id: lecture.id,
    title: lecture.title,
    description: lecture.description ?? '',
    createdAt: lecture.created_at,
    additionalNotes: lecture.additional_notes ?? undefined,
    files: lectureFiles,
    studyPlan: studyPlan.length > 0 ? studyPlan : undefined,
    roadmap: (lecture.roadmap as RoadmapStep[] | null) ?? undefined,
    readiness: (lecture.readiness as StudyReadiness | null) ?? undefined,
    planStatus: (lecture.plan_status as PlanStatus | null) ?? 'ready',
    planGeneratedAt: lecture.plan_generated_at ?? undefined,
    planError: lecture.plan_error ?? undefined,
  };
};

// Session Messages CRUD functions

export const saveSessionMessage = async (
  sessionId: string,
  message: Omit<StudyChatMessage, 'id'> & { id?: string }
) => {
  const client = ensureClient();
  const userId = await requireUserId();
  const { error } = await client
    .from('session_messages')
    .upsert(
      {
        id: message.id,
        session_id: sessionId,
        role: message.role,
        text: sanitizeText(message.text) ?? '',
        question_id: message.questionId ?? null,
        answer_link_id: message.answerLinkId ?? null,
        citations: message.citations ?? null,
        user_id: userId,
      },
      { onConflict: 'id' }
    );
  if (error) {
    console.warn('[supabase] saveSessionMessage error', { message: error.message, code: error.code });
    throw error;
  }
};

export const listSessionMessages = async (sessionId: string): Promise<StudyChatMessage[]> => {
  const client = ensureClient();
  const { data, error } = await client
    .from('session_messages')
    .select()
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true });
  
  if (error) {
    // Table might not exist yet
    if (error.code === '42P01') {
      console.warn('[supabase] session_messages table does not exist yet');
      return [];
    }
    throw error;
  }
  
  return (data ?? []).map((row) => ({
    id: row.id,
    role: row.role as 'ai' | 'user' | 'system',
    text: row.text,
    questionId: row.question_id ?? undefined,
    answerLinkId: row.answer_link_id ?? undefined,
    citations: row.citations ?? undefined,
  }));
};

// Session lookup functions

export const getSessionByStudyPlanEntryId = async (
  studyPlanEntryId: string
): Promise<StudySession | null> => {
  const client = ensureClient();
  const { data, error } = await client
    .from('sessions')
    .select()
    .eq('study_plan_entry_id', studyPlanEntryId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
  
  if (error) {
    if (error.code === 'PGRST116') return null; // Not found
    throw error;
  }
  
  return {
    id: data.id,
    materialId: data.material_id ?? undefined,
    lectureId: data.lecture_id ?? undefined,
    studyPlanEntryId: data.study_plan_entry_id ?? undefined,
    title: data.title,
    status: data.status,
    lastQuestionId: data.last_question_id ?? undefined,
    canvasData: data.canvas_data ?? undefined,
    notesText: data.notes_text ?? undefined,
    createdAt: data.created_at,
  };
};

export const getSessionByLectureId = async (
  lectureId: string,
  excludeEntryId?: boolean
): Promise<StudySession | null> => {
  const client = ensureClient();
  
  let query = client
    .from('sessions')
    .select()
    .eq('lecture_id', lectureId);
  
  // If excludeEntryId is true, only get "full study" sessions (no study plan entry)
  if (excludeEntryId) {
    query = query.is('study_plan_entry_id', null);
  }
  
  const { data, error } = await query
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
  
  if (error) {
    if (error.code === 'PGRST116') return null; // Not found
    throw error;
  }
  
  return {
    id: data.id,
    materialId: data.material_id ?? undefined,
    lectureId: data.lecture_id ?? undefined,
    studyPlanEntryId: data.study_plan_entry_id ?? undefined,
    title: data.title,
    status: data.status,
    lastQuestionId: data.last_question_id ?? undefined,
    canvasData: data.canvas_data ?? undefined,
    notesText: data.notes_text ?? undefined,
    createdAt: data.created_at,
  };
};

export const getSessionById = async (sessionId: string): Promise<StudySession | null> => {
  const client = ensureClient();
  const { data, error } = await client
    .from('sessions')
    .select()
    .eq('id', sessionId)
    .single();
  
  if (error) {
    if (error.code === 'PGRST116') return null; // Not found
    throw error;
  }
  
  return {
    id: data.id,
    materialId: data.material_id ?? undefined,
    lectureId: data.lecture_id ?? undefined,
    studyPlanEntryId: data.study_plan_entry_id ?? undefined,
    title: data.title,
    status: data.status,
    lastQuestionId: data.last_question_id ?? undefined,
    canvasData: data.canvas_data ?? undefined,
    canvasPages: (data.canvas_pages as CanvasPage[] | null) ?? undefined,
    notesText: data.notes_text ?? undefined,
    createdAt: data.created_at,
  };
};

// ============================================================================
// Practice Exams
// ============================================================================

const mapPracticeExam = (row: any): PracticeExam => ({
  id: row.id,
  lectureId: row.lecture_id,
  title: row.title,
  status: (row.status as PracticeExamStatus) ?? 'pending',
  questionCount: row.question_count ?? 0,
  score: typeof row.score === 'number' ? row.score : row.score ? Number(row.score) : undefined,
  error: row.error ?? undefined,
  createdAt: row.created_at,
  completedAt: row.completed_at ?? undefined,
  category: row.category ?? undefined,
});

export const listPracticeExams = async (lectureId: string): Promise<PracticeExam[]> => {
  const client = ensureClient();
  const { data, error } = await client
    .from('practice_exams')
    .select()
    .eq('lecture_id', lectureId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data ?? []).map(mapPracticeExam);
};

/**
 * List cluster quizzes (practice exams with a category) for a specific lecture
 */
export const listClusterQuizzes = async (lectureId: string): Promise<PracticeExam[]> => {
  const client = ensureClient();
  const { data, error } = await client
    .from('practice_exams')
    .select()
    .eq('lecture_id', lectureId)
    .not('category', 'is', null)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data ?? []).map(mapPracticeExam);
};

/**
 * Get the most recent cluster quiz for a specific category
 */
export const getClusterQuizForCategory = async (lectureId: string, category: string): Promise<PracticeExam | null> => {
  const client = ensureClient();
  const { data, error } = await client
    .from('practice_exams')
    .select()
    .eq('lecture_id', lectureId)
    .eq('category', category)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data ? mapPracticeExam(data) : null;
};

export const getPracticeExam = async (examId: string): Promise<PracticeExam | null> => {
  const client = ensureClient();
  const { data, error } = await client.from('practice_exams').select().eq('id', examId).single();
  if (error) {
    if (error.code === 'PGRST116') return null;
    throw error;
  }
  return mapPracticeExam(data);
};

export const getPracticeExamQuestions = async (examId: string): Promise<PracticeExamQuestion[]> => {
  const client = ensureClient();
  const { data, error } = await client
    .from('practice_exam_questions')
    .select()
    .eq('practice_exam_id', examId)
    .order('order_index', { ascending: true });

  if (error) throw error;

  return (data ?? []).map((row: any) => ({
    id: row.id,
    practiceExamId: row.practice_exam_id,
    studyPlanEntryId: row.study_plan_entry_id ?? undefined,
    orderIndex: row.order_index ?? 0,
    prompt: row.prompt,
    answerKey: row.answer_key ?? undefined,
    sourceType: row.source_type ?? undefined,
    sourceFileId: row.source_file_id ?? undefined,
    createdAt: row.created_at,
  }));
};

export const listPracticeExamResponses = async (examId: string): Promise<PracticeExamResponse[]> => {
  const client = ensureClient();
  const { data, error } = await client
    .from('practice_exam_responses')
    .select()
    .eq('practice_exam_id', examId)
    .order('created_at', { ascending: true });

  if (error) throw error;

  return (data ?? []).map((row: any) => ({
    id: row.id,
    practiceExamId: row.practice_exam_id,
    questionId: row.question_id,
    userAnswer: row.user_answer ?? undefined,
    feedback: row.feedback ?? undefined,
    score: row.score ?? undefined,
    createdAt: row.created_at,
  }));
};

export const savePracticeExamResponse = async (
  response: Omit<PracticeExamResponse, 'createdAt'> & { id?: string }
): Promise<void> => {
  const client = ensureClient();
  const userId = await requireUserId();
  const { error } = await client.from('practice_exam_responses').upsert(
    {
      id: response.id,
      practice_exam_id: response.practiceExamId,
      question_id: response.questionId,
      user_answer: response.userAnswer ?? null,
      feedback: response.feedback ?? null,
      score: response.score ?? null,
      user_id: userId,
    },
    { onConflict: 'question_id' }
  );
  if (error) throw error;
};

export const updatePracticeExamStatus = async (
  examId: string,
  patch: { status?: PracticeExamStatus; score?: number | null; completedAt?: string | null; error?: string | null }
) => {
  const client = ensureClient();
  const updateData: Record<string, unknown> = {};
  if (patch.status !== undefined) updateData.status = patch.status;
  if (patch.score !== undefined) updateData.score = patch.score;
  if (patch.completedAt !== undefined) updateData.completed_at = patch.completedAt;
  if (patch.error !== undefined) updateData.error = sanitizeText(patch.error);

  if (Object.keys(updateData).length === 0) return;

  const { error } = await client.from('practice_exams').update(updateData).eq('id', examId);
  if (error) throw error;
};


// ============================================================================
// Authentication Functions
// ============================================================================

/**
 * Sign in with Apple using the ID token from Apple Sign-In
 */
export const signInWithApple = async (identityToken: string): Promise<{ user: User; session: Session }> => {
  const client = ensureClient();
  const { data, error } = await client.auth.signInWithIdToken({
    provider: 'apple',
    token: identityToken,
  });
  
  if (error) {
    console.error('[supabase] signInWithApple error', { message: error.message });
    throw error;
  }
  
  if (!data.user || !data.session) {
    throw new Error('Sign in failed: No user or session returned');
  }
  
  console.log('[supabase] signInWithApple success', { userId: data.user.id });
  return { user: data.user, session: data.session };
};

/**
 * Sign up with email and password
 */
export const signUpWithEmail = async (
  email: string,
  password: string
): Promise<{ user: User | null; session: Session | null; needsEmailConfirmation: boolean }> => {
  const client = ensureClient();
  const { data, error } = await client.auth.signUp({
    email,
    password,
  });
  
  if (error) {
    console.error('[supabase] signUpWithEmail error', { message: error.message });
    throw error;
  }
  
  // If email confirmation is required, user will be returned but session will be null
  const needsEmailConfirmation = !data.session && !!data.user;
  
  console.log('[supabase] signUpWithEmail success', { 
    userId: data.user?.id, 
    needsEmailConfirmation 
  });
  
  return { 
    user: data.user, 
    session: data.session, 
    needsEmailConfirmation 
  };
};

/**
 * Sign in with email and password
 */
export const signInWithEmail = async (
  email: string,
  password: string
): Promise<{ user: User; session: Session }> => {
  const client = ensureClient();
  const { data, error } = await client.auth.signInWithPassword({
    email,
    password,
  });
  
  if (error) {
    console.error('[supabase] signInWithEmail error', { message: error.message });
    throw error;
  }
  
  if (!data.user || !data.session) {
    throw new Error('Sign in failed: No user or session returned');
  }
  
  console.log('[supabase] signInWithEmail success', { userId: data.user.id });
  return { user: data.user, session: data.session };
};

/**
 * Send password reset email
 */
export const resetPassword = async (email: string): Promise<void> => {
  const client = ensureClient();
  const { error } = await client.auth.resetPasswordForEmail(email);
  
  if (error) {
    console.error('[supabase] resetPassword error', { message: error.message });
    throw error;
  }
  
  console.log('[supabase] resetPassword email sent');
};

/**
 * Sign out the current user
 */
export const signOut = async (): Promise<void> => {
  const client = ensureClient();
  const { error } = await client.auth.signOut();
  
  if (error) {
    console.error('[supabase] signOut error', { message: error.message });
    throw error;
  }
  
  console.log('[supabase] signOut success');
};

/**
 * Get the current session
 */
export const getSession = async (): Promise<Session | null> => {
  const client = ensureClient();
  const { data, error } = await client.auth.getSession();
  
  if (error) {
    console.error('[supabase] getSession error', { message: error.message });
    throw error;
  }
  
  return data.session;
};

/**
 * Get the current user
 */
export const getCurrentUser = async (): Promise<User | null> => {
  const client = ensureClient();
  const { data, error } = await client.auth.getUser();
  
  if (error) {
    // Not signed in is not an error
    if (error.message.includes('not authenticated')) {
      return null;
    }
    console.error('[supabase] getCurrentUser error', { message: error.message });
    throw error;
  }
  
  return data.user;
};

/**
 * Subscribe to auth state changes
 */
export const onAuthStateChange = (callback: (event: string, session: Session | null) => void) => {
  const client = ensureClient();
  return client.auth.onAuthStateChange((event, session) => {
    console.log('[supabase] auth state change', { event, hasSession: !!session });
    callback(event, session);
  });
};

// ============================================================================
// AI Usage Cost Functions
// ============================================================================

/**
 * Get total AI usage cost for the current user (lifetime)
 */
export const getUserTotalCost = async (): Promise<number> => {
  const client = ensureClient();
  const userId = await requireUserId();
  const { data, error } = await client
    .from('ai_usage_logs')
    .select('cost_usd')
    .eq('user_id', userId);

  if (error) {
    if (error.code === '42P01') return 0; // Table doesn't exist
    throw error;
  }

  return (data ?? []).reduce((sum, row) => sum + (Number(row.cost_usd) || 0), 0);
};

/**
 * Get total AI usage cost for a specific lecture
 */
export const getLectureTotalCost = async (lectureId: string): Promise<number> => {
  const client = ensureClient();
  await requireUserId();
  const { data, error } = await client
    .from('ai_usage_logs')
    .select('cost_usd')
    .eq('lecture_id', lectureId);

  if (error) {
    if (error.code === '42P01') return 0; // Table doesn't exist
    throw error;
  }

  return (data ?? []).reduce((sum, row) => sum + (Number(row.cost_usd) || 0), 0);
};

export type { Session, User };

