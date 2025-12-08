import { Audio, AVPlaybackStatus, AVPlaybackStatusSuccess } from 'expo-av';
import * as FileSystem from 'expo-file-system';
import * as Speech from 'expo-speech';

import { LanguageCode } from '@/types';

import { getSupabase } from './supabase';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

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
    if (!text?.trim()) return;

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
      const audioUri = await this.fetchStreamingTTS(truncatedText);
      
      if (audioUri) {
        await this.playAudioFile(audioUri);
      } else {
        // Fallback to native speech
        await this.fallbackToNativeSpeech(truncatedText);
      }
    } catch (error) {
      console.warn('[StreamingTTS] Error, falling back to native:', error);
      this.updateState({ error: (error as Error).message });
      
      // Fallback to native speech on error
      try {
        await this.fallbackToNativeSpeech(text.slice(0, MAX_TTS_LENGTH));
      } catch (fallbackError) {
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
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      console.warn('[StreamingTTS] Supabase not configured');
      return null;
    }

    const supabase = getSupabase();
    let accessToken: string | null = null;
    
    try {
      const { data } = await supabase?.auth.getSession() ?? { data: null };
      accessToken = data?.session?.access_token ?? null;
    } catch {
      // Continue without auth token
    }

    const response = await fetch(`${SUPABASE_URL}/functions/v1/stream-tts`, {
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

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`TTS request failed: ${errorText}`);
    }

    // Save the audio stream to a temp file
    const arrayBuffer = await response.arrayBuffer();
    const base64 = this.arrayBufferToBase64(arrayBuffer);
    
    const tempUri = `${FileSystem.cacheDirectory}tts_${Date.now()}.mp3`;
    await FileSystem.writeAsStringAsync(tempUri, base64, {
      encoding: FileSystem.EncodingType.Base64,
    });

    return tempUri;
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
    // Configure audio mode for playback
    await Audio.setAudioModeAsync({
      playsInSilentModeIOS: true,
      staysActiveInBackground: false,
      shouldDuckAndroid: true,
    });

    // Create and load the sound
    const { sound } = await Audio.Sound.createAsync(
      { uri },
      { shouldPlay: true },
      this.onPlaybackStatusUpdate
    );

    this.sound = sound;
    this.updateState({ isLoading: false, isPlaying: true });
    this.callbacks.onPlaybackStart?.();
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

    this.updateState({ isLoading: false, isPlaying: true });
    this.callbacks.onPlaybackStart?.();

    return new Promise((resolve) => {
      Speech.speak(text, {
        language: speechLocale,
        pitch: 1.0,
        rate: 0.9,
        onDone: () => {
          this.updateState({ isPlaying: false, currentText: null });
          this.callbacks.onPlaybackEnd?.();
          resolve();
        },
        onError: () => {
          this.updateState({ isPlaying: false, currentText: null, error: 'Speech synthesis failed' });
          this.callbacks.onPlaybackEnd?.();
          resolve();
        },
        onStopped: () => {
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

