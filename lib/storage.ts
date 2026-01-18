import { decode } from 'base64-arraybuffer';
import * as FileSystem from 'expo-file-system/legacy';
import { v4 as uuid } from 'uuid';

import { getSupabase } from './supabase';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;

export const uploadToStorage = async (bucket: string, uri: string, contentType: string) => {
  const supabase = getSupabase();
  if (!supabase) {
    throw new Error('Supabase is not configured. Cannot upload file.');
  }

  console.log('[storage] upload start', { bucket, contentType, uri });
  if (SUPABASE_URL) {
    try {
      const ping = await fetch(SUPABASE_URL, { method: 'HEAD' });
      console.log('[storage] connectivity check', { status: ping.status });
    } catch (err) {
      console.warn('[storage] connectivity check failed', { message: (err as Error).message });
    }
  }

  const fileBase64 = await FileSystem.readAsStringAsync(uri, { encoding: 'base64' });
  const fileBytes = new Uint8Array(decode(fileBase64));
  const path = `${uuid()}`;
  const { data, error } = await supabase.storage.from(bucket).upload(path, fileBytes, {
    contentType,
    upsert: false,
  });
  if (error) {
    console.warn('[storage] upload error', { message: error.message, status: error, bucket, path });
    throw error;
  }

  const { data: publicUrl } = supabase.storage.from(bucket).getPublicUrl(data.path);
  console.log('[storage] upload success', { publicPath: data.path, publicUrl: publicUrl.publicUrl });
  return { path: data.path, publicUrl: publicUrl.publicUrl };
};

export const uploadCanvasImage = async (uri: string) => {
  return uploadToStorage('materials', uri, 'image/png');
};

