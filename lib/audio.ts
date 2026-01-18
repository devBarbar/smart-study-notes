import { Audio, AVPlaybackStatus, AVPlaybackStatusSuccess } from 'expo-av';
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

// Maximum text length for TTS (OpenAI limit is 4096)
const MAX_TTS_LENGTH = 4096;

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

/**
 * Streaming TTS player using OpenAI via Supabase edge function
 * Falls back to expo-speech if streaming fails
 */
export class StreamingTTSPlayer {
  private sound: Audio.Sound | null = null;
  private callbacks: TTSPlayerCallbacks;
  private state: TTSPlayerState = {
    isPlaying: false,
    isLoading: false,
    error: null,
    currentText: null,
  };
  private language: LanguageCode = 'en';

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

    this.updateState({
      isLoading: true,
      error: null,
      currentText: text,
    });

    try {
      // Truncate text if too long
      const truncatedText = text.length > MAX_TTS_LENGTH 
        ? text.slice(0, MAX_TTS_LENGTH - 3) + '...'
        : text;

      // Try streaming TTS first
      console.log('[StreamingTTS] Attempting OpenAI TTS via edge function...');
      const audioUri = await this.fetchStreamingTTS(truncatedText);
      
      if (audioUri) {
        console.log('[StreamingTTS] Got audio URI, playing via expo-av:', audioUri);
        await this.playAudioFile(audioUri);
      } else {
        // Fallback to native speech
        console.log('[StreamingTTS] No audio URI returned, falling back to expo-speech');
        await this.fallbackToNativeSpeech(truncatedText);
      }
    } catch (error) {
      console.warn('[StreamingTTS] Error in speak(), falling back to native:', error);
      this.updateState({ error: (error as Error).message });
      
      // Fallback to native speech on error
      try {
        console.log('[StreamingTTS] Attempting expo-speech fallback after error...');
        await this.fallbackToNativeSpeech(text.slice(0, MAX_TTS_LENGTH));
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
   * Play an audio file using expo-av
   */
  private async playAudioFile(uri: string): Promise<void> {
    console.log('[StreamingTTS] playAudioFile called:', uri);
    
    try {
      // Configure audio mode for playback
      console.log('[StreamingTTS] Setting audio mode...');
      await Audio.setAudioModeAsync({
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
        shouldDuckAndroid: true,
      });

      // Create and load the sound
      console.log('[StreamingTTS] Creating sound from URI...');
      const { sound, status } = await Audio.Sound.createAsync(
        { uri },
        { shouldPlay: true },
        this.onPlaybackStatusUpdate
      );

      console.log('[StreamingTTS] Sound created successfully', {
        isLoaded: status.isLoaded,
        durationMs: status.isLoaded ? (status as AVPlaybackStatusSuccess).durationMillis : 0,
      });

      this.sound = sound;
      this.updateState({ isLoading: false, isPlaying: true });
      this.callbacks.onPlaybackStart?.();
      console.log('[StreamingTTS] OpenAI TTS playback started successfully!');
    } catch (playError) {
      console.error('[StreamingTTS] Failed to play audio file:', playError);
      throw playError;
    }
  }

  private onPlaybackStatusUpdate = (status: AVPlaybackStatus) => {
    if (!status.isLoaded) return;
    
    const loadedStatus = status as AVPlaybackStatusSuccess;
    
    if (loadedStatus.didJustFinish) {
      this.handlePlaybackEnd();
    }
  };

  private handlePlaybackEnd() {
    this.updateState({ isPlaying: false, currentText: null });
    this.callbacks.onPlaybackEnd?.();
    this.cleanup();
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

    this.updateState({ isLoading: false, isPlaying: true });
    this.callbacks.onPlaybackStart?.();

    return new Promise((resolve) => {
      Speech.speak(text, {
        language: speechLocale,
        pitch: 1.0,
        rate: 0.9,
        onDone: () => {
          console.log('[StreamingTTS] expo-speech finished');
          this.updateState({ isPlaying: false, currentText: null });
          this.callbacks.onPlaybackEnd?.();
          resolve();
        },
        onError: (error) => {
          console.error('[StreamingTTS] expo-speech error:', error);
          this.updateState({ isPlaying: false, currentText: null, error: 'Speech synthesis failed' });
          this.callbacks.onPlaybackEnd?.();
          resolve();
        },
        onStopped: () => {
          console.log('[StreamingTTS] expo-speech stopped');
          this.updateState({ isPlaying: false, currentText: null });
          this.callbacks.onPlaybackEnd?.();
          resolve();
        },
      });
    });
  }

  /**
   * Stop current playback
   */
  async stop(): Promise<void> {
    // Stop expo-av sound
    if (this.sound) {
      try {
        await this.sound.stopAsync();
        await this.sound.unloadAsync();
      } catch {
        // Ignore cleanup errors
      }
      this.sound = null;
    }

    // Stop native speech
    await Speech.stop();

    this.updateState({ isPlaying: false, isLoading: false, currentText: null });
  }

  /**
   * Cleanup resources
   */
  private async cleanup() {
    if (this.sound) {
      try {
        await this.sound.unloadAsync();
      } catch {
        // Ignore cleanup errors
      }
      this.sound = null;
    }
  }

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

