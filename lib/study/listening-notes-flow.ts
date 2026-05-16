import { StudyChatMessage, TutorQuestionMetadata } from "../../types";

const NON_LISTENING_ASSESSMENT_KINDS = new Set(["diagnostic", "final_quiz"]);

export const shouldUseListeningNotesFlow = (
  tutorQuestion?: TutorQuestionMetadata | null,
) => {
  if (!tutorQuestion?.question?.trim()) return false;
  return !NON_LISTENING_ASSESSMENT_KINDS.has(
    tutorQuestion.assessmentKind ?? "depth",
  );
};

export const buildListeningNotesQuestion = (
  tutorQuestion: TutorQuestionMetadata,
): TutorQuestionMetadata => ({
  ...tutorQuestion,
});

export const getListeningNotesAudioText = (
  tutorText: string,
  questionText?: string | null,
) => {
  const text = tutorText.trim();
  const question = questionText?.trim();
  if (!question) return text;

  const questionIndex = text.lastIndexOf(question);
  if (questionIndex === -1) return text;

  const afterQuestion = text.slice(questionIndex + question.length).trim();
  if (afterQuestion.length > 0) return text;

  return text
    .slice(0, questionIndex)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
};

export const buildGuidedAudioReplayFromMessage = (
  message?: StudyChatMessage | null,
) => {
  if (
    message?.role !== "ai" ||
    !shouldUseListeningNotesFlow(message.tutorQuestion)
  ) {
    return null;
  }

  const questionText = message.tutorQuestion?.question.trim();
  if (!questionText) return null;

  const audioText = getListeningNotesAudioText(message.text, questionText);
  if (!audioText) return null;

  return {
    messageId: message.id,
    text: audioText,
  };
};
