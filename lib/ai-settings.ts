import { getSupabase } from './supabase';
import type { AIPlatform, AISettingsResponse, AISettingsUpdate } from './ai-model-options';

export * from './ai-model-options';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

const getAccessToken = async (): Promise<string | null> => {
  const supabase = getSupabase();
  try {
    const { data } = await supabase?.auth.getSession() ?? { data: null };
    return data?.session?.access_token ?? null;
  } catch {
    return null;
  }
};

const callAISettingsFunction = async <T>(
  payload: Record<string, unknown>,
): Promise<T> => {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error('Supabase functions are not configured.');
  }
  const accessToken = await getAccessToken();
  const response = await fetch(`${SUPABASE_URL}/functions/v1/ai-settings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken ?? SUPABASE_ANON_KEY}`,
      apikey: SUPABASE_ANON_KEY,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || 'AI settings request failed.');
  }
  return (await response.json()) as T;
};

export const getAISettings = async () =>
  callAISettingsFunction<AISettingsResponse>({ action: 'get' });

export const updateAISettings = async (settings: AISettingsUpdate) =>
  callAISettingsFunction<AISettingsResponse>({
    action: 'update',
    modelConfig: settings.modelConfig,
    apiKeys: settings.apiKeys,
  });
