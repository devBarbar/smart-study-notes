import { AI_PLATFORM_LABELS, AIPlatform } from './ai-model-options';

export const formatAIModelBadge = (
  model?: string | null,
  platform?: AIPlatform | null,
) => {
  const cleanModel = model?.trim();
  if (!cleanModel) return null;

  const providerLabel = platform ? AI_PLATFORM_LABELS[platform] : undefined;
  return providerLabel ? `${providerLabel} / ${cleanModel}` : cleanModel;
};
