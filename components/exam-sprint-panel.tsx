import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Colors, Radii, Spacing } from '@/constants/theme';
import { getExamSprintTaskActionLabel } from '@/lib/exam-sprint-orchestrator';
import type { ExamSprintPlan, ExamSprintTask } from '@/types';

type ExamSprintPanelProps = {
  plan: ExamSprintPlan;
  onTaskPress?: (task: ExamSprintTask) => void;
  onSetupPress?: () => void;
};

const riskCopy: Record<ExamSprintPlan['riskLevel'], { label: string; color: string }> = {
  critical: { label: 'Critical', color: '#dc2626' },
  tight: { label: 'Tight', color: '#d97706' },
  on_track: { label: 'On track', color: '#059669' },
};

const formatMinutes = (minutes: number) => {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder === 0 ? `${hours}h` : `${hours}h ${remainder}m`;
};

export function ExamSprintPanel({ plan, onTaskPress, onSetupPress }: ExamSprintPanelProps) {
  if (plan.status === 'setup_required') {
    const setupTask = plan.nextTask;
    return (
      <View style={styles.card} testID="exam-sprint-panel">
        <View style={styles.headerRow}>
          <View style={styles.titleRow}>
            <Ionicons name="timer" size={18} color={Colors.light.primary} />
            <ThemedText type="defaultSemiBold">Exam Sprint</ThemedText>
          </View>
          <View style={[styles.riskBadge, { backgroundColor: `${riskCopy.critical.color}18` }]}>
            <ThemedText style={[styles.riskText, { color: riskCopy.critical.color }]}>
              {riskCopy.critical.label}
            </ThemedText>
          </View>
        </View>
        <ThemedText style={styles.subtitle}>
          Add a future exam date and study-time budget to generate a crash-course plan.
        </ThemedText>
        {setupTask && (
          <Pressable
            accessibilityRole="button"
            testID="exam-sprint-next-action"
            style={styles.primaryAction}
            onPress={() => onSetupPress?.()}
          >
            <Ionicons name="calendar" size={16} color="#fff" />
            <ThemedText style={styles.primaryActionText}>
              {getExamSprintTaskActionLabel(setupTask)}
            </ThemedText>
          </Pressable>
        )}
      </View>
    );
  }

  const risk = riskCopy[plan.riskLevel];
  const visibleDays = plan.days.slice(0, 5);
  const remainingDays = Math.max(0, plan.days.length - visibleDays.length);

  return (
    <View style={styles.card} testID="exam-sprint-panel">
      <View style={styles.headerRow}>
        <View style={styles.titleRow}>
          <Ionicons name="timer" size={18} color={Colors.light.primary} />
          <ThemedText type="defaultSemiBold">Exam Sprint</ThemedText>
        </View>
        <View style={[styles.riskBadge, { backgroundColor: `${risk.color}18` }]}>
          <ThemedText style={[styles.riskText, { color: risk.color }]}>{risk.label}</ThemedText>
        </View>
      </View>

      <View style={styles.metricsRow}>
        <View style={styles.metric}>
          <ThemedText type="title">{plan.daysUntilExam}</ThemedText>
          <ThemedText style={styles.metricLabel}>days left</ThemedText>
        </View>
        <View style={styles.metric}>
          <ThemedText type="title">{formatMinutes(plan.dailyCapacityMinutes)}</ThemedText>
          <ThemedText style={styles.metricLabel}>per day</ThemedText>
        </View>
        <View style={styles.metric}>
          <ThemedText type="title">{plan.readiness?.percentage ?? 0}%</ThemedText>
          <ThemedText style={styles.metricLabel}>ready</ThemedText>
        </View>
      </View>

      {plan.nextTask && (
        <Pressable
          accessibilityRole="button"
          testID="exam-sprint-next-action"
          style={styles.nextTask}
          onPress={() => onTaskPress?.(plan.nextTask!)}
        >
          <View style={styles.nextTaskText}>
            <ThemedText type="caption" style={styles.eyebrow}>
              Next sprint action
            </ThemedText>
            <ThemedText testID="exam-sprint-next-title" type="defaultSemiBold">
              {plan.nextTask.title}
            </ThemedText>
            {plan.nextTask.subtitle && (
              <ThemedText style={styles.taskSubtitle} numberOfLines={2}>
                {plan.nextTask.subtitle}
              </ThemedText>
            )}
          </View>
          <View style={styles.nextTaskAction}>
            <ThemedText style={styles.nextTaskActionText}>
              {getExamSprintTaskActionLabel(plan.nextTask)}
            </ThemedText>
            <Ionicons name="arrow-forward" size={14} color="#fff" />
          </View>
        </Pressable>
      )}

      <View style={styles.daysList}>
        {visibleDays.map((day) => (
          <View key={day.date} style={styles.dayRow}>
            <View style={styles.dayHeader}>
              <ThemedText type="defaultSemiBold" style={styles.dayLabel}>{day.label}</ThemedText>
              <ThemedText style={styles.dayMinutes}>
                {formatMinutes(day.totalMinutes)} / {formatMinutes(day.capacityMinutes)}
              </ThemedText>
            </View>
            {day.tasks.length === 0 ? (
              <ThemedText style={styles.emptyDay}>Buffer and light review</ThemedText>
            ) : (
              day.tasks.slice(0, 3).map((task) => (
                <Pressable
                  accessibilityRole="button"
                  key={task.id}
                  style={styles.taskRow}
                  onPress={() => onTaskPress?.(task)}
                >
                  <ThemedText style={styles.taskTitle} numberOfLines={1}>{task.title}</ThemedText>
                  <ThemedText style={styles.taskMinutes}>{formatMinutes(task.estimatedMinutes)}</ThemedText>
                </Pressable>
              ))
            )}
          </View>
        ))}
        {remainingDays > 0 && (
          <ThemedText style={styles.moreDays}>+{remainingDays} more planned day{remainingDays === 1 ? '' : 's'}</ThemedText>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.light.surface,
    borderRadius: Radii.md,
    borderWidth: 1,
    borderColor: Colors.light.border,
    padding: Spacing.md,
    gap: Spacing.md,
  },
  headerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  titleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Spacing.xs,
  },
  riskBadge: {
    borderRadius: Radii.pill,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  riskText: {
    fontSize: 12,
    fontWeight: '700',
  },
  subtitle: {
    color: Colors.light.textMuted,
  },
  primaryAction: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: Colors.light.primary,
    borderRadius: Radii.pill,
    flexDirection: 'row',
    gap: Spacing.xs,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  primaryActionText: {
    color: '#fff',
    fontWeight: '700',
  },
  metricsRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  metric: {
    backgroundColor: Colors.light.surfaceAlt,
    borderRadius: Radii.sm,
    flex: 1,
    padding: Spacing.sm,
  },
  metricLabel: {
    color: Colors.light.textMuted,
    fontSize: 12,
  },
  nextTask: {
    alignItems: 'center',
    backgroundColor: '#eef2ff',
    borderColor: '#c7d2fe',
    borderRadius: Radii.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: Spacing.sm,
    padding: Spacing.md,
  },
  nextTaskText: {
    flex: 1,
    gap: 2,
  },
  eyebrow: {
    color: Colors.light.primary,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  taskSubtitle: {
    color: Colors.light.textMuted,
    fontSize: 13,
  },
  nextTaskAction: {
    alignItems: 'center',
    backgroundColor: Colors.light.primary,
    borderRadius: Radii.pill,
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  nextTaskActionText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  daysList: {
    gap: Spacing.sm,
  },
  dayRow: {
    borderTopColor: Colors.light.border,
    borderTopWidth: 1,
    gap: Spacing.xs,
    paddingTop: Spacing.sm,
  },
  dayHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  dayLabel: {
    fontSize: 14,
  },
  dayMinutes: {
    color: Colors.light.textMuted,
    fontSize: 12,
  },
  emptyDay: {
    color: Colors.light.textMuted,
    fontSize: 13,
  },
  taskRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Spacing.sm,
    justifyContent: 'space-between',
    paddingVertical: 3,
  },
  taskTitle: {
    flex: 1,
    fontSize: 13,
  },
  taskMinutes: {
    color: Colors.light.textMuted,
    fontSize: 12,
  },
  moreDays: {
    color: Colors.light.textMuted,
    fontSize: 13,
  },
});
