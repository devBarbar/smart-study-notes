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
import { generateLectureMetadata } from '@/lib/openai';
import { uploadToStorage } from '@/lib/storage';
import { enqueueLecturePlanGeneration, saveLecture, saveLectureFiles } from '@/lib/supabase';
import { Lecture, LectureFile, PlanSettings } from '@/types';
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
  | 'generating-metadata'
  | 'saving'
  | 'queueing';

export default function NewLectureScreen() {
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [additionalNotes, setAdditionalNotes] = useState('');
  const [examDate, setExamDate] = useState('');
  const [targetGrade, setTargetGrade] = useState<PlanSettings['targetGrade']>('pass');
  const [weeklyStudyMinutes, setWeeklyStudyMinutes] = useState('');
  const [preferredSessionMinutes, setPreferredSessionMinutes] = useState('45');
  const [currentLevel, setCurrentLevel] = useState<NonNullable<PlanSettings['currentLevel']>>('some-background');
  const [weakAreas, setWeakAreas] = useState('');
  const [status, setStatus] = useState<UploadStatus>('idle');
  const [currentStep, setCurrentStep] = useState('');
  const router = useRouter();
  const queryClient = useQueryClient();
  const { agentLanguage, t } = useLanguage();
  const colorScheme = useColorScheme();
  const scheme = colorScheme === 'dark' ? 'dark' : 'light';
  const palette = Colors[scheme];
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
    const planSettings: PlanSettings = {
      targetGrade,
      preferredSessionMinutes: Math.max(15, Math.min(180, Number(preferredSessionMinutes) || 45)),
      currentLevel,
      additionalNotes: trimmedNotes || undefined,
    };
    if (examDate.trim()) planSettings.examDate = examDate.trim();
    if (Number(weeklyStudyMinutes) > 0) {
      planSettings.weeklyStudyMinutes = Math.max(30, Math.min(6000, Number(weeklyStudyMinutes)));
    }
    const parsedWeakAreas = weakAreas
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    if (parsedWeakAreas.length > 0) planSettings.weakAreas = parsedWeakAreas;
    
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

      // Step 2: Generate lecture metadata from filenames. Heavy extraction runs server-side.
      setStatus('generating-metadata');
      setCurrentStep(t('lectureNew.status.metadata'));
      
      const metadata = await generateLectureMetadata(
        files.map((f) => ({
          name: f.name,
          notes: f.isExam ? 'Marked as past exam' : undefined,
        })),
        agentLanguage
      );

      // Step 3: Save lecture and files, then enqueue server-owned plan generation.
      setStatus('saving');
      setCurrentStep(t('lectureNew.status.saving'));
      
      await saveLecture({
        id: lectureId,
        title: metadata.title,
        description: metadata.description,
        additionalNotes: trimmedNotes || null,
        planSettings,
        planStatus: 'pending',
        planGeneratedAt: null,
        planError: null,
      });
      
      await saveLectureFiles(lectureId, uploaded);

      // Update local cache with pending status (plan will be added via realtime/invalidations)
      queryClient.setQueryData(['lectures'], (prev: Lecture[] | undefined) => [
        { 
          id: lectureId, 
          title: metadata.title, 
          description: metadata.description, 
          createdAt: new Date().toISOString(), 
          additionalNotes: trimmedNotes || undefined,
          planSettings,
          files: uploaded,
          studyPlanModules: undefined,
          studyPlan: undefined,
          planStatus: 'pending',
          planGeneratedAt: null,
          planError: null,
        },
        ...(prev ?? []),
      ]);

      setStatus('queueing');
      setCurrentStep(t('lectureNew.status.plan'));
      await enqueueLecturePlanGeneration(lectureId);
      queryClient.invalidateQueries({ queryKey: ['lectures'] });
      router.replace(`/lecture/${lectureId}`);
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
      case 'generating-metadata':
        return t('lectureNew.status.metadata');
      case 'queueing':
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
      <ThemedView style={styles.setupPanel}>
        <ThemedText type="defaultSemiBold">Learning path setup</ThemedText>
        <View style={styles.setupGrid}>
          <TextInput
            style={styles.setupInput}
            placeholder="Exam date (YYYY-MM-DD)"
            placeholderTextColor={palette.textMuted}
            value={examDate}
            onChangeText={setExamDate}
            editable={!isProcessing}
          />
          <TextInput
            style={styles.setupInput}
            placeholder="Weekly minutes"
            placeholderTextColor={palette.textMuted}
            keyboardType="number-pad"
            value={weeklyStudyMinutes}
            onChangeText={setWeeklyStudyMinutes}
            editable={!isProcessing}
          />
          <TextInput
            style={styles.setupInput}
            placeholder="Session minutes"
            placeholderTextColor={palette.textMuted}
            keyboardType="number-pad"
            value={preferredSessionMinutes}
            onChangeText={setPreferredSessionMinutes}
            editable={!isProcessing}
          />
          <TextInput
            style={styles.setupInput}
            placeholder="Weak areas, comma separated"
            placeholderTextColor={palette.textMuted}
            value={weakAreas}
            onChangeText={setWeakAreas}
            editable={!isProcessing}
          />
        </View>
        <View style={styles.segmentRow}>
          {(['pass', '2.0', '1.3'] as const).map((grade) => (
            <Pressable
              key={grade}
              style={[styles.segmentButton, targetGrade === grade && styles.segmentButtonActive]}
              onPress={() => setTargetGrade(grade)}
              disabled={isProcessing}
            >
              <ThemedText style={[styles.segmentText, targetGrade === grade && styles.segmentTextActive]}>
                {grade === 'pass' ? 'Pass' : grade}
              </ThemedText>
            </Pressable>
          ))}
        </View>
        <View style={styles.segmentRow}>
          {(['beginner', 'some-background', 'advanced'] as const).map((level) => (
            <Pressable
              key={level}
              style={[styles.segmentButton, currentLevel === level && styles.segmentButtonActive]}
              onPress={() => setCurrentLevel(level)}
              disabled={isProcessing}
            >
              <ThemedText style={[styles.segmentText, currentLevel === level && styles.segmentTextActive]}>
                {level === 'some-background' ? 'Some background' : level}
              </ThemedText>
            </Pressable>
          ))}
        </View>
      </ThemedView>
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
                : status === 'generating-metadata' ? '60%'
                : status === 'queueing' ? '80%'
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
    setupPanel: {
      width: '100%',
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: Radii.md,
      padding: 12,
      gap: Spacing.sm,
      backgroundColor: palette.surface,
    },
    setupGrid: {
      gap: Spacing.sm,
    },
    setupInput: {
      width: '100%',
      borderRadius: Radii.sm,
      borderWidth: 1,
      borderColor: palette.border,
      paddingHorizontal: 10,
      paddingVertical: 8,
      color: palette.text,
      backgroundColor: palette.surfaceAlt,
    },
    segmentRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: Spacing.xs,
    },
    segmentButton: {
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: Radii.sm,
      paddingHorizontal: 10,
      paddingVertical: 6,
      backgroundColor: palette.surface,
    },
    segmentButtonActive: {
      borderColor: `${palette.primary}66`,
      backgroundColor: `${palette.primary}14`,
    },
    segmentText: {
      color: palette.textMuted,
      fontSize: 12,
      fontWeight: '600',
      textTransform: 'capitalize',
    },
    segmentTextActive: {
      color: palette.primary,
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
