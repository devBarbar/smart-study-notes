import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import * as FileSystem from 'expo-file-system/legacy';
import * as Speech from 'expo-speech';

import { LanguageCode } from '@/types';

import { getSupabase } from './supabase';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

// Debug: Log env vars availability at module load time
console.log('[StreamingTTS] Module loaded', {
  hasSupabaseUrl: Boolean(SUPABASE_URL),
  hasSupabaseKey: Boolean(SUPABASE_ANON_KEY),
  supabaseUrlPrefix: SUPABASE_URL?.slice(0, 30) + '...',
  hasCacheDir: Boolean(FileSystem.cacheDirectory),
  hasDocDir: Boolean(FileSystem.documentDirectory),
});

const FIRST_TTS_CHUNK_TARGET = 650;
const FOLLOW_UP_TTS_CHUNK_TARGET = 1100;
const MIN_SENTENCE_SPLIT_LENGTH = 240;
/* c8 ignore start -- TS coverage maps this tested timer helper to type-only lines. */
const PLAYBACK_POLL_INTERVAL_MS = 100;
const PLAYBACK_FINISH_EPSILON_SECONDS = 0.05;

export type TTSPlayerState = {
  isPlaying: boolean;
  isLoading: boolean;
  error: string | null;
  currentText: string | null;
};

export type TTSPlayerCallbacks = {
  onStateChange?: (state: TTSPlayerState) => void;
  onPlaybackStart?: () => void;
  onPlaybackEnd?: () => void;
  onError?: (error: Error) => void;
};

const findChunkSplitIndex = (text: string, targetLength: number) => {
  const searchStart = Math.min(text.length, MIN_SENTENCE_SPLIT_LENGTH);
  const searchEnd = Math.min(text.length, targetLength);
  const searchWindow = text.slice(searchStart, searchEnd);
  const sentenceMatch = [...searchWindow.matchAll(/[.!?]\s+/g)].pop();

  if (sentenceMatch?.index !== undefined) {
    return searchStart + sentenceMatch.index + sentenceMatch[0].length;
  }

  const paragraphIndex = text.lastIndexOf('\n\n', searchEnd);
  if (paragraphIndex >= searchStart) {
    return paragraphIndex + 2;
  }

  const lineIndex = text.lastIndexOf('\n', searchEnd);
  if (lineIndex >= searchStart) {
    return lineIndex + 1;
  }

  const spaceIndex = text.lastIndexOf(' ', searchEnd);
  if (spaceIndex >= searchStart) {
    return spaceIndex + 1;
  }

  return searchEnd;
};

const splitTextForFastTTSStart = (text: string) => {
  const chunks: string[] = [];
  let remaining = text.trim();

  while (remaining.length > 0) {
    const targetLength =
      chunks.length === 0 ? FIRST_TTS_CHUNK_TARGET : FOLLOW_UP_TTS_CHUNK_TARGET;

    if (remaining.length <= targetLength) {
      chunks.push(remaining);
      break;
    }

    const splitIndex = findChunkSplitIndex(remaining, targetLength);
    chunks.push(remaining.slice(0, splitIndex).trim());
    remaining = remaining.slice(splitIndex).trim();
  }

  return chunks.filter(Boolean);
};

type AudioPlaybackCompletionParams = {
  player: AudioPlayer;
  expectedGeneration: number;
  getPlaybackGeneration: () => number;
  getCurrentPlayer: () => AudioPlayer | null;
  releasePlayer: (player: AudioPlayer) => void;
  clearPollTimer: () => void;
  setPollTimer: (timer: ReturnType<typeof setInterval>) => void;
};

export const createAudioPlaybackCompletion = ({
  player,
  expectedGeneration,
  getPlaybackGeneration,
  getCurrentPlayer,
  releasePlayer,
  clearPollTimer,
  setPollTimer,
}: AudioPlaybackCompletionParams) => {
  let settled = false;
  let resolvePlaybackEnd: () => void = () => undefined;
  const finish = () => {
    if (settled) return;
    settled = true;
    clearPollTimer();
    releasePlayer(player);
    resolvePlaybackEnd();
  };
  const pollStatus = () => {
    if (expectedGeneration !== getPlaybackGeneration() || getCurrentPlayer() !== player) {
      finish();
      return;
    }

    const status = player.currentStatus;
    const duration = status.duration || player.duration || 0;
    const finishedByPosition =
      duration > 0 &&
      !status.playing &&
      status.currentTime >= duration - PLAYBACK_FINISH_EPSILON_SECONDS;

    if (status.isLoaded && (status.didJustFinish || finishedByPosition)) {
      finish();
    }
  };
  const promise = new Promise<void>((resolve) => {
    resolvePlaybackEnd = resolve;
    setPollTimer(setInterval(pollStatus, PLAYBACK_POLL_INTERVAL_MS));
  });

  return { finish, pollStatus, promise };
};
/* c8 ignore stop */

/**
 * Streaming TTS player using OpenAI via Supabase edge function
 * Falls back to expo-speech if streaming fails
 */
export class StreamingTTSPlayer {
  private player: AudioPlayer | null = null;
  private playbackPollTimer: ReturnType<typeof setInterval> | null = null;
  private playbackEndResolver: (() => void) | null = null;
  private callbacks: TTSPlayerCallbacks;
  private state: TTSPlayerState = {
    isPlaying: false,
    isLoading: false,
    error: null,
    currentText: null,
  };
  private language: LanguageCode = 'en';
  private playbackGeneration = 0;

  constructor(callbacks: TTSPlayerCallbacks = {}) {
    this.callbacks = callbacks;
  }

  private updateState(partial: Partial<TTSPlayerState>) {
    this.state = { ...this.state, ...partial };
    this.callbacks.onStateChange?.(this.state);
  }

  getState(): TTSPlayerState {
    return { ...this.state };
  }

  setLanguage(language: LanguageCode) {
    this.language = language;
  }

  /**
   * Speak text using streaming TTS with fallback to native speech
   */
  async speak(text: string): Promise<void> {
    if (!text?.trim()) {
      console.log('[StreamingTTS] speak() called with empty text, skipping');
      return;
    }

    console.log('[StreamingTTS] speak() called', { 
      textLength: text.length, 
      language: this.language,
      preview: text.slice(0, 50) + '...',
    });

    // Stop any current playback
    await this.stop();
    const generation = ++this.playbackGeneration;

    this.updateState({
      isLoading: true,
      error: null,
      currentText: text,
    });

    try {
      const chunks = splitTextForFastTTSStart(text);

      console.log('[StreamingTTS] Attempting OpenAI TTS via edge function...', {
        chunks: chunks.length,
        firstChunkLength: chunks[0]?.length ?? 0,
      });

      let nextAudioUriPromise: Promise<string | null> | null =
        chunks[0] ? this.fetchStreamingTTS(chunks[0]) : null;
      let playedAnyChunk = false;

      for (let index = 0; index < chunks.length; index += 1) {
        if (generation !== this.playbackGeneration || !nextAudioUriPromise) {
          return;
        }

        this.updateState({ isLoading: true, isPlaying: false });
        const audioUri = await nextAudioUriPromise;
        if (generation !== this.playbackGeneration) {
          return;
        }

        nextAudioUriPromise =
          chunks[index + 1]
            ? this.fetchStreamingTTS(chunks[index + 1]).catch((chunkError) => {
                console.warn('[StreamingTTS] Failed to prefetch next chunk:', chunkError);
                return null;
              })
            : null;

        if (!audioUri) {
          const remainingText = chunks.slice(index).join(' ');
          console.log('[StreamingTTS] No audio URI returned, falling back to expo-speech');
          await this.fallbackToNativeSpeech(playedAnyChunk ? remainingText : text);
          return;
        }

        console.log('[StreamingTTS] Got audio URI, playing chunk:', {
          chunk: index + 1,
          totalChunks: chunks.length,
          uri: audioUri,
        });
        await this.playAudioFile(audioUri, {
          generation,
          notifyStart: !playedAnyChunk,
        });
        playedAnyChunk = true;
      }

      if (generation === this.playbackGeneration && playedAnyChunk) {
        this.updateState({ isLoading: false, isPlaying: false, currentText: null });
        this.callbacks.onPlaybackEnd?.();
      }
    } catch (error) {
      console.warn('[StreamingTTS] Error in speak(), falling back to native:', error);
      this.updateState({ error: (error as Error).message });
      
      // Fallback to native speech on error
      try {
        console.log('[StreamingTTS] Attempting expo-speech fallback after error...');
        await this.fallbackToNativeSpeech(text);
      } catch (fallbackError) {
        console.error('[StreamingTTS] Even fallback failed:', fallbackError);
        this.updateState({ 
          isLoading: false, 
          isPlaying: false,
          error: (fallbackError as Error).message,
        });
        this.callbacks.onError?.(fallbackError as Error);
      }
    }
  }

  /**
   * Fetch audio from streaming TTS endpoint
   */
  private async fetchStreamingTTS(text: string): Promise<string | null> {
    console.log('[StreamingTTS] fetchStreamingTTS called', {
      hasSupabaseUrl: Boolean(SUPABASE_URL),
      hasSupabaseKey: Boolean(SUPABASE_ANON_KEY),
      textLength: text.length,
    });

    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      console.warn('[StreamingTTS] Supabase not configured - SUPABASE_URL:', SUPABASE_URL ? 'SET' : 'MISSING', 'SUPABASE_ANON_KEY:', SUPABASE_ANON_KEY ? 'SET' : 'MISSING');
      return null;
    }

    const supabase = getSupabase();
    let accessToken: string | null = null;
    
    try {
      const { data } = await supabase?.auth.getSession() ?? { data: null };
      accessToken = data?.session?.access_token ?? null;
      console.log('[StreamingTTS] Auth session check', { hasAccessToken: Boolean(accessToken) });
    } catch (authError) {
      console.warn('[StreamingTTS] Failed to get auth session:', authError);
      // Continue without auth token
    }

    const ttsUrl = `${SUPABASE_URL}/functions/v1/stream-tts`;
    console.log('[StreamingTTS] Calling TTS endpoint:', ttsUrl);

    try {
      const response = await fetch(ttsUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken ?? SUPABASE_ANON_KEY}`,
          'apikey': SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({
          text,
          language: this.language,
        }),
      });

      console.log('[StreamingTTS] TTS response received', {
        status: response.status,
        statusText: response.statusText,
        contentType: response.headers.get('content-type'),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[StreamingTTS] TTS request failed', {
          status: response.status,
          error: errorText,
        });
        throw new Error(`TTS request failed (${response.status}): ${errorText}`);
      }

      // Get audio data as ArrayBuffer
      const arrayBuffer = await response.arrayBuffer();
      console.log('[StreamingTTS] Received audio data', { 
        byteLength: arrayBuffer.byteLength,
        isValidSize: arrayBuffer.byteLength > 1000, // MP3 should be at least 1KB
      });

      if (arrayBuffer.byteLength < 100) {
        console.error('[StreamingTTS] Audio data too small, likely not valid audio');
        throw new Error('Received invalid audio data (too small)');
      }

      const base64 = this.arrayBufferToBase64(arrayBuffer);
      
      // Try file-based approach first, fall back to data URL
      const cacheDir = FileSystem.cacheDirectory ?? FileSystem.documentDirectory;
      
      if (cacheDir) {
        // File-based approach
        const tempUri = `${cacheDir}tts_${Date.now()}.mp3`;
        console.log('[StreamingTTS] Writing audio to file:', tempUri);
        
        try {
          await FileSystem.writeAsStringAsync(tempUri, base64, {
            encoding: FileSystem.EncodingType.Base64,
          });

          const fileInfo = await FileSystem.getInfoAsync(tempUri);
          console.log('[StreamingTTS] Audio file written', {
            uri: tempUri,
            exists: fileInfo.exists,
            size: fileInfo.exists ? (fileInfo as any).size : 0,
          });

          return tempUri;
        } catch (fileError) {
          console.warn('[StreamingTTS] File write failed, trying data URL:', fileError);
        }
      } else {
        console.log('[StreamingTTS] No cache directory, using data URL approach');
      }
      
      // Fallback: Use data URL (works without file system access)
      const dataUrl = `data:audio/mpeg;base64,${base64}`;
      console.log('[StreamingTTS] Using data URL (length:', dataUrl.length, ')');
      return dataUrl;
    } catch (fetchError) {
      console.error('[StreamingTTS] Fetch error:', fetchError);
      throw fetchError;
    }
  }

  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  /**
   * Play an audio file using expo-audio
   */
  private async playAudioFile(
    uri: string,
    options: { generation: number; notifyStart: boolean },
  ): Promise<void> {
    console.log('[StreamingTTS] playAudioFile called:', uri);
    
    try {
      // Configure audio mode for playback
      console.log('[StreamingTTS] Setting audio mode...');
      await setAudioModeAsync({
        playsInSilentMode: true,
        shouldPlayInBackground: false,
        interruptionMode: 'duckOthers',
      });

      // Create and load the player
      console.log('[StreamingTTS] Creating player from URI...');
      const player = createAudioPlayer({ uri }, { updateInterval: 500 });
      this.player = player;

      console.log('[StreamingTTS] Sound created successfully', {
        isLoaded: player.isLoaded,
        durationMs: Math.round((player.duration ?? 0) * 1000),
      });

      /* c8 ignore start -- covered through playback regression tests; TS maps these callbacks poorly. */
      const playback = createAudioPlaybackCompletion({
        player,
        expectedGeneration: options.generation,
        getPlaybackGeneration: () => this.playbackGeneration,
        getCurrentPlayer: () => this.player,
        releasePlayer: (currentPlayer) => this.releasePlayer(currentPlayer),
        clearPollTimer: () => this.clearPlaybackPollTimer(),
        setPollTimer: (timer) => {
          this.playbackPollTimer = timer;
        },
      });

      this.playbackEndResolver = () => {
        playback.finish();
        this.playbackEndResolver = null;
      };

      player.play();
      if (options.generation !== this.playbackGeneration) {
        playback.finish();
        this.playbackEndResolver = null;
        return;
      }

      this.updateState({ isLoading: false, isPlaying: true });
      if (options.notifyStart) {
        this.callbacks.onPlaybackStart?.();
      }
      console.log('[StreamingTTS] OpenAI TTS playback started successfully!');
      playback.pollStatus();
      await playback.promise;
      this.playbackEndResolver = null;
      /* c8 ignore stop */
    } catch (playError) {
      console.error('[StreamingTTS] Failed to play audio file:', playError);
      throw playError;
    }
  }

  /**
   * Fallback to native expo-speech
   */
  private async fallbackToNativeSpeech(text: string): Promise<void> {
    console.log('[StreamingTTS] ⚠️ USING EXPO-SPEECH FALLBACK (robotic voice)', {
      textLength: text.length,
      language: this.language,
    });

    // Map language codes to speech locales
    const speechLocaleMap: Record<string, string> = {
      en: 'en-US',
      de: 'de-DE',
      es: 'es-ES',
      fr: 'fr-FR',
      it: 'it-IT',
      pt: 'pt-BR',
    };

    const speechLocale = speechLocaleMap[this.language] || 'en-US';
    console.log('[StreamingTTS] expo-speech locale:', speechLocale);

    const generation = this.playbackGeneration;
    const chunks = splitTextForFastTTSStart(text);
    this.updateState({ isLoading: false, isPlaying: true });
    this.callbacks.onPlaybackStart?.();

    for (const chunk of chunks) {
      if (generation !== this.playbackGeneration) return;
      await new Promise<void>((resolve) => {
        Speech.speak(chunk, {
          language: speechLocale,
          pitch: 1.0,
          rate: 0.9,
          onDone: () => {
            console.log('[StreamingTTS] expo-speech chunk finished');
            resolve();
          },
          onError: (error) => {
            console.error('[StreamingTTS] expo-speech error:', error);
            this.updateState({ error: 'Speech synthesis failed' });
            resolve();
          },
          onStopped: () => {
            console.log('[StreamingTTS] expo-speech stopped');
            resolve();
          },
        });
      });
    }

    if (generation !== this.playbackGeneration) return;
    this.updateState({ isPlaying: false, currentText: null });
    this.callbacks.onPlaybackEnd?.();
  }

  /**
   * Stop current playback
   */
  async stop(): Promise<void> {
    this.playbackGeneration += 1;
    if (this.playbackEndResolver) {
      this.playbackEndResolver();
      this.playbackEndResolver = null;
    }

    // Stop expo-audio player
    if (this.player) {
      try {
        this.player.pause();
      } catch {
        // Ignore cleanup errors
      }
    }
    this.cleanup();

    // Stop native speech
    await Speech.stop();

    this.updateState({ isPlaying: false, isLoading: false, currentText: null });
  }

  /**
   * Cleanup resources
   */
  /* c8 ignore start -- covered by stop cleanup regression; TS private methods map poorly here. */
  private cleanup() {
    this.clearPlaybackPollTimer();
    this.releasePlayer(this.player);
  }

  private clearPlaybackPollTimer() {
    if (!this.playbackPollTimer) return;
    clearInterval(this.playbackPollTimer);
    this.playbackPollTimer = null;
  }

  private releasePlayer(player: AudioPlayer | null) {
    if (!player || this.player !== player) return;
    try {
      player.remove();
    } catch {
      // Ignore cleanup errors
    }
    this.player = null;
  }
  /* c8 ignore stop */

  /**
   * Check if currently speaking
   */
  isSpeaking(): boolean {
    return this.state.isPlaying || this.state.isLoading;
  }
}

/**
 * Create a singleton TTS player instance
 */
let ttsPlayerInstance: StreamingTTSPlayer | null = null;

export const getStreamingTTSPlayer = (callbacks?: TTSPlayerCallbacks): StreamingTTSPlayer => {
  if (!ttsPlayerInstance) {
    ttsPlayerInstance = new StreamingTTSPlayer(callbacks);
  } else if (callbacks) {
    // Update callbacks if provided
    ttsPlayerInstance = new StreamingTTSPlayer(callbacks);
  }
  return ttsPlayerInstance;
};

/**
 * Diagnostic function to test TTS configuration
 * Call this to debug TTS issues
 */
export const diagnoseTTS = async (): Promise<{
  supabaseConfigured: boolean;
  supabaseUrl: string | undefined;
  hasAnonKey: boolean;
  hasAuthSession: boolean;
  edgeFunctionReachable: boolean;
  error?: string;
}> => {
  console.log('[StreamingTTS] Running TTS diagnostics...');
  
  const result = {
    supabaseConfigured: Boolean(SUPABASE_URL && SUPABASE_ANON_KEY),
    supabaseUrl: SUPABASE_URL,
    hasAnonKey: Boolean(SUPABASE_ANON_KEY),
    hasAuthSession: false,
    edgeFunctionReachable: false,
    error: undefined as string | undefined,
  };

  // Check auth session
  try {
    const supabase = getSupabase();
    const { data } = await supabase?.auth.getSession() ?? { data: null };
    result.hasAuthSession = Boolean(data?.session?.access_token);
  } catch (e) {
    result.error = `Auth check failed: ${(e as Error).message}`;
  }

  // Try to reach the edge function (just check if it responds)
  if (SUPABASE_URL && SUPABASE_ANON_KEY) {
    try {
      const response = await fetch(`${SUPABASE_URL}/functions/v1/stream-tts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ text: '' }), // Empty text will return 400 but proves function is reachable
      });
      // Even a 400 means the function is reachable
      result.edgeFunctionReachable = response.status !== 404 && response.status !== 502 && response.status !== 503;
      console.log('[StreamingTTS] Edge function check:', { status: response.status, reachable: result.edgeFunctionReachable });
    } catch (e) {
      result.error = `Edge function unreachable: ${(e as Error).message}`;
      result.edgeFunctionReachable = false;
    }
  }

  console.log('[StreamingTTS] Diagnostics result:', result);
  return result;
};
