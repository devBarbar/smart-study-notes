export type MaterialType = 'pdf' | 'image';

export type LanguageCode = 'en' | 'de';

export type Material = {
  id: string;
  title: string;
  description?: string;
  type: MaterialType;
  uri: string;
  previewUri?: string;
  createdAt: string;
};

export type LectureFile = {
  id: string;
  lectureId: string;
  name: string;
  uri: string;
  mimeType: string;
  extractedText?: string;
  isExam?: boolean;
  createdAt: string;
};

export type ImportanceTier = 'core' | 'high-yield' | 'stretch';

export type SectionStatus = 'not_started' | 'in_progress' | 'passed' | 'failed';

export type RoadmapTarget = 'pass' | 'good' | 'ace';

export type RoadmapStep = {
  order: number;
  title: string;
  action: string;
  target: RoadmapTarget;
  reason?: string;
  category?: string;
  estimatedMinutes?: number;
  examTopics?: string[];
};

export type StudyReadiness = {
  pass: number;
  good: number;
  ace: number;
  summary?: string;
  focusAreas?: string[];
  priorityExplanation?: string;
  updatedAt?: string;
};

export type ExamRelevance = 'high' | 'medium' | 'low';

export type StudyPlanEntry = {
  id: string;
  lectureId: string;
  title: string;
  description?: string;
  keyConcepts: string[];
  orderIndex: number;
  category?: string;
  importanceTier?: ImportanceTier;
  priorityScore?: number;
  status?: SectionStatus;
  statusScore?: number;
  statusUpdatedAt?: string;
  masteryScore?: number;
  nextReviewAt?: string;
  reviewCount?: number;
  easeFactor?: number;
  fromExamSource?: boolean;
  examRelevance?: ExamRelevance;
  mentionedInNotes?: boolean;
  createdAt: string;
};

export type PlanStatus = 'pending' | 'ready' | 'failed';

export type Lecture = {
  id: string;
  title: string;
  description: string;
  createdAt: string;
  additionalNotes?: string;
  files: LectureFile[];
  studyPlan?: StudyPlanEntry[];
  roadmap?: RoadmapStep[];
  readiness?: StudyReadiness;
  planStatus?: PlanStatus;
  planGeneratedAt?: string;
  planError?: string;
};

export type StudySessionStatus = 'idle' | 'active' | 'completed';

export type CanvasBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type CanvasStrokeData = {
  points: { x: number; y: number }[];
  color: string;
  width: number;
};

export type CanvasPage = {
  id: string;
  titleStrokes: CanvasStrokeData[];
  strokes: CanvasStrokeData[];
  width: number;
  height: number;
};

export type StudySession = {
  id: string;
  materialId?: string;
  lectureId?: string;
  studyPlanEntryId?: string;
  title: string;
  status: StudySessionStatus;
  lastQuestionId?: string;
  /** @deprecated Use canvasPages instead */
  canvasData?: CanvasStrokeData[];
  canvasPages?: CanvasPage[];
  notesText?: string;
  createdAt: string;
};

export type StudyQuestion = {
  id: string;
  prompt: string;
  sectionTitle?: string;
};

export type StudyFeedback = {
  summary: string;
  correctness: string;
  score?: number;
  improvements?: string[];
};

export type StudyAnswerLink = {
  id: string;
  sessionId: string;
  questionId: string;
  pageId?: string;
  answerText?: string;
  answerImageUri?: string;
  canvasBounds?: CanvasBounds;
  createdAt: string;
};

export type StudyChatMessage = {
  id: string;
  role: 'ai' | 'user' | 'system';
  text: string;
  questionId?: string;
  answerLinkId?: string;
  citations?: StudyCitation[];
};

export type PracticeExamStatus = 'pending' | 'ready' | 'in_progress' | 'completed' | 'failed';

export type PracticeExam = {
  id: string;
  lectureId: string;
  title: string;
  status: PracticeExamStatus;
  questionCount: number;
  score?: number;
  error?: string;
  createdAt: string;
  completedAt?: string;
};

export type PracticeExamQuestion = {
  id: string;
  practiceExamId: string;
  studyPlanEntryId?: string;
  orderIndex: number;
  prompt: string;
  answerKey?: string;
  sourceType?: 'exam' | 'worksheet' | 'material';
  sourceFileId?: string;
  createdAt: string;
};

export type PracticeExamResponse = {
  id: string;
  practiceExamId: string;
  questionId: string;
  userAnswer?: string;
  feedback?: StudyFeedback;
  score?: number;
  createdAt: string;
};

export type CanvasAnswerMarker = {
  questionId: string;
  questionIndex: number;
  messageId: string;
  answerLinkId: string;
  pageId?: string;
  canvasBounds?: CanvasBounds;
};

export type StudyCitation = {
  chunkId: string;
  lectureId?: string;
  lectureFileId?: string;
  pageNumber?: number;
  similarity?: number;
  sourceBBox?: CanvasBounds;
};

export type ReviewQuality = 'correct' | 'incorrect' | 'partial' | 'skipped';

export type ReviewEvent = {
  id?: string;
  studyPlanEntryId: string;
  score?: number;
  responseQuality?: ReviewQuality;
  reviewedAt: string;
};

export type MasteryData = {
  masteryScore: number;
  nextReviewAt?: string;
  reviewCount: number;
  easeFactor: number;
};

export type StreakInfo = {
  current: number;
  longest: number;
  lastReviewDate?: string;
};

