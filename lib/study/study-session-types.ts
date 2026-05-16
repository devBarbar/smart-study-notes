import {
  CanvasStageKind,
  ReviewQuality,
  StudyChatMessage,
  StudyMode,
  StudyQuestion,
  StudyWarmupQuestion,
  TutorCheckType,
} from '../../types';

export type StudyPhase =
  | 'setup'
  | 'warmup'
  | 'diagnostic'
  | 'tutor'
  | 'guided_notes'
  | 'memorize'
  | 'answer'
  | 'grading'
  | 'final_quiz';

export type CanvasStageInfo = {
  stageKind: CanvasStageKind;
  stageId: string;
  stageLabel: string;
};

export type PendingGuidedQuestion = {
  messageId: string;
  questionText: string;
  tutorQuestion: NonNullable<StudyChatMessage['tutorQuestion']>;
};

export type GuidedAudioReplay = {
  messageId: string;
  text: string;
};

export type FinalQuizAnswer = {
  questionId: string;
  prompt: string;
  score?: number;
  checkType?: StudyQuestion['checkType'];
  summary: string;
};

export type FinalQuizState = {
  status: 'idle' | 'generating' | 'active' | 'passed' | 'failed';
  questions: StudyQuestion[];
  currentIndex: number;
  answers: FinalQuizAnswer[];
  averageScore?: number;
};

export type WarmupAnswer = {
  questionId: string;
  prompt: string;
  selectedOptionIndex: number;
  correctOptionIndex: number;
  correct: boolean;
  targetConcepts?: string[];
  explanation: string;
};

export type WarmupState = {
  status: 'idle' | 'generating' | 'active' | 'complete' | 'failed';
  questions: StudyWarmupQuestion[];
  currentIndex: number;
  answers: WarmupAnswer[];
  selectedOptionIndex: number | null;
};

export type FeynmanSendOptions = {
  displayText?: string;
  questionId?: string;
};

export type StudyModeLabel = StudyMode;

export type StudyReviewQuality = ReviewQuality;
export type StudyTutorCheckType = TutorCheckType;
