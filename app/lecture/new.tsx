import * as DocumentPicker from 'expo-document-picker';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { v4 as uuid } from 'uuid';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors, Radii, Spacing } from '@/constants/theme';
import { useLanguage } from '@/contexts/language-context';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useLectures } from '@/hooks/use-lectures';
import { buildLectureChunks, ExtractedPdfPage, extractPdfText, generateLectureMetadata, generateStudyPlan } from '@/lib/openai';
import { uploadToStorage } from '@/lib/storage';
import { deleteLectureChunksForLecture, saveLecture, saveLectureFiles, saveStudyPlanEntries, updateLecturePlanStatus, upsertLectureChunks } from '@/lib/supabase';
import { LectureFile } from '@/types';
import { useQueryClient } from '@tanstack/react-query';

type PendingFile = {
  uri: string;
  name: string;
  mimeType: string;
  isExam?: boolean;
};

type UploadStatus = 
  | 'idle'
  | 'uploading'
  | 'extracting'
  | 'generating-metadata'
  | 'generating-plan'
  | 'saving';

export default function NewLectureScreen() {
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [additionalNotes, setAdditionalNotes] = useState('');
  const [status, setStatus] = useState<UploadStatus>('idle');
  const [currentStep, setCurrentStep] = useState('');
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: lectures = [] } = useLectures();
  const { agentLanguage, t } = useLanguage();
  const colorScheme = useColorScheme();
  const palette = Colors[colorScheme ?? 'light'];
  const styles = useMemo(() => createStyles(palette), [palette]);

  const isProcessing = status !== 'idle';

  const pickDocuments = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      type: 'application/pdf',
      multiple: true,
      copyToCacheDirectory: true,
    });
    if (result.assets?.length) {
      const next = result.assets.map((asset) => ({
        uri: asset.uri,
        name: asset.name ?? 'PDF',
        mimeType: asset.mimeType ?? 'application/pdf',
        isExam: false,
      }));
      setFiles(next);
    }
  };

  const toggleExamFlag = (uri: string) => {
    setFiles((prev) =>
      prev.map((file) =>
        file.uri === uri ? { ...file, isExam: !file.isExam } : file
      )
    );
  };

  const startUpload = async () => {
    if (files.length === 0 || isProcessing) return;
    
    const lectureId = uuid();
    const trimmedNotes = additionalNotes.trim();
    
    try {
      // Step 1: Upload files to storage
      setStatus('uploading');
      setCurrentStep(t('lectureNew.status.uploadingCount', { count: files.length }));
      
      const uploaded: LectureFile[] = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        setCurrentStep(
          t('lectureNew.status.uploadingFile', { current: i + 1, total: files.length, name: file.name })
        );
        const result = await uploadToStorage('materials', file.uri, file.mimeType);
        uploaded.push({
          id: uuid(),
          lectureId,
          name: file.name,
          uri: result.publicUrl,
          mimeType: file.mimeType,
          isExam: Boolean(file.isExam),
          createdAt: new Date().toISOString(),
        });
      }

      // Step 2: Try to extract text from PDFs (optional - may fail if edge function not deployed)
      setStatus('extracting');
      const extractedTexts: { fileName: string; text: string; isExam?: boolean }[] = [];
      const extractedPages: Record<string, ExtractedPdfPage[] | undefined> = {};
      let extractionSucceeded = false;
      const extractionStartedAt = Date.now();
      
      for (let i = 0; i < uploaded.length; i++) {
        const file = uploaded[i];
        setCurrentStep(
          t('lectureNew.status.extractingFile', { current: i + 1, total: uploaded.length, name: file.name })
        );
        try {
          const extraction = await extractPdfText(file.uri);
          const text = extraction.text;
          extractedTexts.push({ fileName: file.name, text, isExam: Boolean(file.isExam) });
          extractedPages[file.id] = extraction.pages;
          // Update the uploaded file with extracted text
          uploaded[i] = { ...file, extractedText: text, isExam: Boolean(file.isExam) };
          if (text.length > 0) extractionSucceeded = true;
        } catch (err) {
          console.warn(`[lecture] Failed to extract text from ${file.name}:`, err);
          // Continue with other files even if one fails
          extractedTexts.push({ fileName: file.name, text: '', isExam: Boolean(file.isExam) });
        }
      }
      console.log('[lecture-new] extraction complete', {
        lectureId,
        files: uploaded.length,
        extractionSucceeded,
        durationMs: Date.now() - extractionStartedAt,
      });

      // Step 3: Generate lecture metadata using file names + extracted content
      setStatus('generating-metadata');
      setCurrentStep(t('lectureNew.status.metadata'));
      
      const metadata = await generateLectureMetadata(
        files.map((f, idx) => ({ 
          name: f.name,
          notes: extractedTexts[idx]?.text?.slice(0, 500) // Include first 500 chars as context
        })),
        agentLanguage
      );

      // Step 4: Save lecture and files, mark plan generation pending, then navigate
      setStatus('saving');
      setCurrentStep(t('lectureNew.status.saving'));
      
      await saveLecture({
        id: lectureId,
        title: metadata.title,
        description: metadata.description,
        additionalNotes: trimmedNotes || null,
        planStatus: 'pending',
        planGeneratedAt: null,
        planError: null,
      });
      
      await saveLectureFiles(lectureId, uploaded);

      // Update local cache with pending status (plan will be added via realtime/invalidations)
      queryClient.setQueryData(['lectures'], (prev: typeof lectures) => [
        { 
          id: lectureId, 
          title: metadata.title, 
          description: metadata.description, 
          createdAt: new Date().toISOString(), 
          additionalNotes: trimmedNotes || undefined,
          files: uploaded,
          studyPlan: undefined,
          planStatus: 'pending',
          planGeneratedAt: null,
          planError: null,
        },
        ...(prev ?? []),
      ]);

      router.replace(`/lecture/${lectureId}`);

      // Kick off study plan generation in the background
      const runPlanGeneration = async () => {
        const generationStartedAt = Date.now();
        console.log('[lecture-new] study plan generation started', {
          lectureId,
          files: uploaded.length,
          extractionSucceeded,
        });

      const indexEmbeddings = async () => {
        try {
          const allChunks: {
            lectureId: string;
            lectureFileId: string;
            pageNumber: number;
            chunkIndex: number;
            content: string;
            embedding: number[];
            contentHash?: string;
          }[] = [];
          for (const file of uploaded) {
            const chunks = await buildLectureChunks(lectureId, file, extractedPages[file.id]);
            chunks.forEach((chunk) =>
              allChunks.push({
                lectureId,
                lectureFileId: file.id,
                pageNumber: chunk.pageNumber,
                chunkIndex: chunk.chunkIndex,
                content: chunk.content,
                embedding: chunk.embedding,
                contentHash: chunk.contentHash,
              })
            );
          }

          if (allChunks.length > 0) {
            await deleteLectureChunksForLecture(lectureId);
            await upsertLectureChunks(allChunks);
            console.log('[lecture-new] embeddings indexed', { chunks: allChunks.length });
          }
        } catch (err) {
          console.warn('[lecture-new] embedding indexing failed', err);
        }
      };

      const embeddingsPromise = indexEmbeddings();

        let studyPlanEntries: Awaited<ReturnType<typeof generateStudyPlan>>['entries'] = [];
        let planCostUsd: number | undefined;
        try {
          if (extractionSucceeded) {
            const planResult = await generateStudyPlan(extractedTexts, agentLanguage, {
              additionalNotes: trimmedNotes || undefined,
              thresholds: { pass: 50, good: 70, ace: 80 },
              lectureId,
            });
            studyPlanEntries = planResult.entries;
            planCostUsd = planResult.costUsd;
          } else {
            console.log('[lecture-new] PDF extraction failed, generating study plan from file names');
            const planResult = await generateStudyPlan(
              files.map(f => ({ fileName: f.name, text: `File: ${f.name}`, isExam: Boolean(f.isExam) })),
              agentLanguage,
              { additionalNotes: trimmedNotes || undefined, thresholds: { pass: 50, good: 70, ace: 80 }, lectureId }
            );
            studyPlanEntries = planResult.entries;
            planCostUsd = planResult.costUsd;
          }
          console.log('[lecture-new] study plan generation succeeded', {
            lectureId,
            entries: studyPlanEntries.length,
            costUsd: planCostUsd,
            durationMs: Date.now() - generationStartedAt,
          });

          if (studyPlanEntries.length > 0) {
            await saveStudyPlanEntries(lectureId, studyPlanEntries);
          }

          await updateLecturePlanStatus(lectureId, {
            planStatus: 'ready',
            planGeneratedAt: new Date().toISOString(),
            planError: null,
          });

          await embeddingsPromise;
        } catch (planError: any) {
          const message = planError?.message ?? String(planError);
          console.warn('[lecture-new] study plan generation failed', {
            lectureId,
            message,
            durationMs: Date.now() - generationStartedAt,
            stack: planError?.stack,
          });

          await updateLecturePlanStatus(lectureId, {
            planStatus: 'failed',
            planGeneratedAt: null,
            planError: message?.slice(0, 500),
          });
        }
        try {
          await embeddingsPromise;
        } catch (err) {
          console.warn('[lecture-new] embedding indexing (post-error) failed', err);
        } finally {
          // Ensure lecture list refreshes when status changes
          queryClient.invalidateQueries({ queryKey: ['lectures'] });
        }
      };

      runPlanGeneration().catch((err) => {
        console.warn('[lecture-new] unhandled plan generation error', { lectureId, message: err?.message ?? String(err) });
      });
    } catch (error) {
      console.warn('[lecture] upload failed', error);
      setCurrentStep(t('lectureNew.status.failed'));
    } finally {
      setStatus('idle');
    }
  };

  const getStatusMessage = () => {
    switch (status) {
      case 'uploading':
        return t('lectureNew.status.uploading');
      case 'extracting':
        return t('lectureNew.status.extracting');
      case 'generating-metadata':
        return t('lectureNew.status.metadata');
      case 'generating-plan':
        return t('lectureNew.status.plan');
      case 'saving':
        return t('lectureNew.status.saving');
      default:
        return '';
    }
  };

  return (
    <ThemedView style={styles.container}>
      <ThemedText type="title">{t('lectureNew.title')}</ThemedText>
      <ThemedText tone="muted" style={{ marginBottom: 12 }}>
        {t('lectureNew.subtitle')}
      </ThemedText>

      <Pressable style={styles.primaryButton} onPress={pickDocuments} disabled={isProcessing}>
        <ThemedText type="defaultSemiBold" style={styles.primaryButtonText}>
          {t('lectureNew.pickPdfs')}
        </ThemedText>
      </Pressable>

      <FlatList
        data={files}
        keyExtractor={(item) => item.uri}
        renderItem={({ item }) => (
          <ThemedView style={styles.fileRow}>
            <View style={styles.fileRowHeader}>
              <ThemedText>{item.name}</ThemedText>
              <Pressable
                style={[styles.examBadge, item.isExam && styles.examBadgeActive]}
                onPress={() => toggleExamFlag(item.uri)}
                disabled={isProcessing}
              >
                <ThemedText
                  type="defaultSemiBold"
                  style={[styles.examBadgeText, item.isExam && styles.examBadgeTextActive]}
                >
                  {item.isExam ? 'Past Exam' : 'Mark as Exam'}
                </ThemedText>
              </Pressable>
            </View>
            <ThemedText type="defaultSemiBold" tone="muted" style={{ fontSize: 12 }}>
              {item.mimeType}
            </ThemedText>
          </ThemedView>
        )}
        ListEmptyComponent={<ThemedText style={{ marginVertical: 12 }}>{t('lectureNew.noPdfs')}</ThemedText>}
        style={{ width: '100%', marginVertical: 12 }}
      />

      <ThemedText type="defaultSemiBold">{t('lectureNew.additionalNotesTitle')}</ThemedText>
      <ThemedText tone="muted" style={{ marginBottom: 6 }}>
        {t('lectureNew.additionalNotesHint')}
      </ThemedText>
      <TextInput
        style={styles.notesInput}
        placeholder={t('lectureNew.additionalNotesPlaceholder')}
        placeholderTextColor={palette.textMuted}
        multiline
        numberOfLines={4}
        value={additionalNotes}
        onChangeText={setAdditionalNotes}
        editable={!isProcessing}
      />

      <Pressable
        style={[styles.primaryButton, styles.accentButton, (isProcessing || files.length === 0) && styles.buttonDisabled]}
        onPress={startUpload}
        disabled={isProcessing || files.length === 0}
      >
        {isProcessing ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator color={palette.textOnPrimary} />
            <ThemedText type="defaultSemiBold" style={styles.primaryButtonText}>
              {getStatusMessage()}
            </ThemedText>
          </View>
        ) : (
          <ThemedText type="defaultSemiBold" style={styles.primaryButtonText}>
            {t('lectureNew.uploadCreate')}
          </ThemedText>
        )}
      </Pressable>

      {isProcessing && currentStep && (
        <View style={styles.progressContainer}>
          <View style={styles.progressBar}>
            <View style={[
              styles.progressFill, 
              { width: status === 'uploading' ? '20%' 
                : status === 'extracting' ? '40%'
                : status === 'generating-metadata' ? '60%'
                : status === 'generating-plan' ? '80%'
                : '95%'
              }
            ]} />
          </View>
          <ThemedText tone="muted" style={styles.progressText}>{currentStep}</ThemedText>
        </View>
      )}
    </ThemedView>
  );
}

const createStyles = (palette: typeof Colors.light) =>
  StyleSheet.create({
    container: {
      flex: 1,
      padding: Spacing.lg,
      gap: Spacing.sm,
      backgroundColor: palette.background,
    },
    primaryButton: {
      backgroundColor: palette.primary,
      borderRadius: Radii.md,
      paddingVertical: 12,
      paddingHorizontal: 16,
      alignSelf: 'flex-start',
      borderWidth: 1,
      borderColor: `${palette.primary}26`,
    },
    accentButton: {
      backgroundColor: palette.primaryStrong,
      borderColor: `${palette.primaryStrong}33`,
    },
    primaryButtonText: {
      color: palette.textOnPrimary,
    },
    buttonDisabled: {
      opacity: 0.65,
    },
    fileRow: {
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: Radii.md,
      padding: 12,
      marginBottom: 8,
      backgroundColor: palette.surface,
    },
    fileRowHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: Spacing.sm,
    },
    examBadge: {
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: Radii.sm,
      paddingHorizontal: 10,
      paddingVertical: 4,
      backgroundColor: palette.surface,
    },
    examBadgeActive: {
      backgroundColor: `${palette.success}14`,
      borderColor: `${palette.success}55`,
    },
    examBadgeText: {
      color: palette.textMuted,
      fontSize: 12,
    },
    examBadgeTextActive: {
      color: palette.success,
    },
    loadingRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    progressContainer: {
      marginTop: Spacing.md,
      gap: Spacing.xs,
    },
    progressBar: {
      height: 6,
      backgroundColor: palette.muted,
      borderRadius: 3,
      overflow: 'hidden',
    },
    progressFill: {
      height: '100%',
      backgroundColor: palette.primary,
      borderRadius: 3,
    },
    progressText: {
      fontSize: 13,
    },
    notesInput: {
      width: '100%',
      minHeight: 96,
      borderRadius: Radii.md,
      borderWidth: 1,
      borderColor: palette.border,
      padding: 12,
      color: palette.text,
      textAlignVertical: 'top',
      backgroundColor: palette.surface,
    },
  });
