import { Ionicons } from "@expo/vector-icons";
import { useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, View } from "react-native";

import { StudyStyles } from "@/components/study/study-styles";
import { ThemedText } from "@/components/themed-text";
import { Colors } from "@/constants/theme";
import { DEPTH_PASS_SCORE } from "@/lib/depth-checks";
import { TutorCheckType } from "@/types";

export type StudyDepthProgressItem = {
  type: TutorCheckType;
  label: string;
  passed: boolean;
  current: boolean;
  attempts: number;
  bestScore?: number;
};

type StudyDepthProgressProps = {
  styles: StudyStyles;
  palette: typeof Colors.light;
  t: (key: string, params?: Record<string, any>) => string;
  items: StudyDepthProgressItem[];
};

const STAGE_ICONS: Record<TutorCheckType, keyof typeof Ionicons.glyphMap> = {
  recall: "albums-outline",
  why: "git-branch-outline",
  apply: "construct-outline",
  transfer: "shuffle-outline",
  teach_back: "chatbubble-ellipses-outline",
};

const STAGE_COPY_KEYS: Record<
  TutorCheckType,
  { about: string; criteria: string }
> = {
  recall: {
    about: "study.depthStageRecallAbout",
    criteria: "study.depthStageRecallCriteria",
  },
  why: {
    about: "study.depthStageWhyAbout",
    criteria: "study.depthStageWhyCriteria",
  },
  apply: {
    about: "study.depthStageApplyAbout",
    criteria: "study.depthStageApplyCriteria",
  },
  transfer: {
    about: "study.depthStageTransferAbout",
    criteria: "study.depthStageTransferCriteria",
  },
  teach_back: {
    about: "study.depthStageTeachBackAbout",
    criteria: "study.depthStageTeachBackCriteria",
  },
};

const getStageFillPercent = (item: StudyDepthProgressItem) => {
  if (item.passed) return 100;
  if (typeof item.bestScore === "number") {
    return Math.min(
      88,
      Math.max(18, Math.round((item.bestScore / DEPTH_PASS_SCORE) * 100)),
    );
  }
  return item.current ? 34 : 0;
};

export function StudyDepthProgress({
  styles,
  palette,
  t,
  items,
}: StudyDepthProgressProps) {
  const [selectedType, setSelectedType] = useState<TutorCheckType | null>(null);
  const selectedItem = useMemo(
    () => items.find((item) => item.type === selectedType) ?? null,
    [items, selectedType],
  );
  const completedCount = items.filter((item) => item.passed).length;
  const totalCount = items.length;
  const overallPercent =
    totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  if (items.length === 0) return null;

  return (
    <View style={styles.depthProgressContainer}>
      <View style={styles.depthProgressHeader}>
        <View style={styles.depthProgressTitleRow}>
          <View style={styles.depthProgressIcon}>
            <Ionicons name="analytics-outline" size={16} color={palette.primary} />
          </View>
          <View style={styles.depthProgressTitleStack}>
            <ThemedText style={styles.depthProgressTitle}>
              {t("study.depthPathTitle")}
            </ThemedText>
            <ThemedText style={styles.depthProgressSubtitle}>
              {t("study.depthPathSubtitle")}
            </ThemedText>
          </View>
        </View>
        <View style={styles.depthProgressSummary}>
          <ThemedText style={styles.depthProgressSummaryText}>
            {t("study.depthPathSummary", {
              completed: completedCount,
              total: totalCount,
            })}
          </ThemedText>
        </View>
      </View>

      <View style={styles.depthOverallTrack}>
        <View
          style={[
            styles.depthOverallFill,
            { width: `${overallPercent}%` },
          ]}
        />
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.depthStageScrollContent}
      >
        {items.map((item, index) => (
          <DepthStageButton
            key={item.type}
            styles={styles}
            palette={palette}
            t={t}
            item={item}
            index={index}
            onPress={() => setSelectedType(item.type)}
          />
        ))}
      </ScrollView>

      <DepthStageModal
        styles={styles}
        palette={palette}
        t={t}
        item={selectedItem}
        onClose={() => setSelectedType(null)}
      />
    </View>
  );
}

function DepthStageButton({
  styles,
  palette,
  t,
  item,
  index,
  onPress,
}: {
  styles: StudyStyles;
  palette: typeof Colors.light;
  t: (key: string, params?: Record<string, any>) => string;
  item: StudyDepthProgressItem;
  index: number;
  onPress: () => void;
}) {
  const statusLabel = item.passed
    ? t("study.depthStageStatusDone")
    : item.current
      ? t("study.depthStageStatusCurrent")
      : t("study.depthStageStatusOpen");
  const iconColor = item.passed
    ? palette.success
    : item.current
      ? palette.warning
      : palette.textMuted;
  const fillPercent = getStageFillPercent(item);

  return (
    <Pressable
      style={[
        styles.depthStageButton,
        item.passed && styles.depthStageButtonPassed,
        item.current && styles.depthStageButtonCurrent,
      ]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={t("study.depthStageDetailsLabel", {
        stage: item.label,
      })}
    >
      <View style={styles.depthStageMetaRow}>
        <ThemedText style={styles.depthStageNumber}>
          {t("study.depthStageNumber", { number: index + 1 })}
        </ThemedText>
        <Ionicons
          name={item.passed ? "checkmark-circle" : STAGE_ICONS[item.type]}
          size={15}
          color={iconColor}
        />
      </View>
      <ThemedText
        style={[
          styles.depthStageLabel,
          item.passed && styles.depthStageLabelPassed,
          item.current && styles.depthStageLabelCurrent,
        ]}
        numberOfLines={1}
      >
        {item.label}
      </ThemedText>
      <View style={styles.depthStageTrack}>
        <View
          style={[
            styles.depthStageFill,
            item.passed && styles.depthStageFillPassed,
            item.current && styles.depthStageFillCurrent,
            { width: `${fillPercent}%` },
          ]}
        />
      </View>
      <ThemedText
        style={[
          styles.depthStageStatus,
          item.passed && styles.depthStageStatusPassed,
          item.current && styles.depthStageStatusCurrent,
        ]}
        numberOfLines={1}
      >
        {statusLabel}
      </ThemedText>
    </Pressable>
  );
}

function DepthStageModal({
  styles,
  palette,
  t,
  item,
  onClose,
}: {
  styles: StudyStyles;
  palette: typeof Colors.light;
  t: (key: string, params?: Record<string, any>) => string;
  item: StudyDepthProgressItem | null;
  onClose: () => void;
}) {
  if (!item) return null;

  const copyKeys = STAGE_COPY_KEYS[item.type];
  const statusLabel = item.passed
    ? t("study.depthStageStatusDone")
    : item.current
      ? t("study.depthStageStatusCurrent")
      : t("study.depthStageStatusOpen");
  const signal =
    typeof item.bestScore === "number"
      ? t("study.depthStageBestScore", {
          score: item.bestScore,
          count: Math.max(item.attempts, 1),
        })
      : item.passed
        ? t("study.depthStageCompletedSignal")
        : item.current
          ? t("study.depthStageCurrentSignal")
          : t("study.depthStageOpenSignal");

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={styles.depthStageModalBackdrop} onPress={onClose}>
        <Pressable style={styles.depthStageModal} onPress={() => undefined}>
          <View style={styles.depthStageModalHeader}>
            <View style={styles.depthStageModalIcon}>
              <Ionicons name={STAGE_ICONS[item.type]} size={20} color="#ffffff" />
            </View>
            <View style={styles.depthStageModalTitleStack}>
              <ThemedText style={styles.depthStageModalEyebrow}>
                {statusLabel}
              </ThemedText>
              <ThemedText style={styles.depthStageModalTitle}>
                {item.label}
              </ThemedText>
            </View>
            <Pressable
              style={styles.depthStageModalClose}
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel={t("common.close")}
            >
              <Ionicons name="close" size={18} color={palette.text} />
            </Pressable>
          </View>

          <View style={styles.depthStageDetailBlock}>
            <ThemedText style={styles.depthStageDetailLabel}>
              {t("study.depthStageWhatChecks")}
            </ThemedText>
            <ThemedText style={styles.depthStageDetailText}>
              {t(copyKeys.about)}
            </ThemedText>
          </View>

          <View style={styles.depthStageDetailBlock}>
            <ThemedText style={styles.depthStageDetailLabel}>
              {t("study.depthStageAdvanceCriteria")}
            </ThemedText>
            <ThemedText style={styles.depthStageDetailText}>
              {t(copyKeys.criteria)}
            </ThemedText>
          </View>

          <View style={styles.depthStageSignalBox}>
            <Ionicons name="pulse-outline" size={16} color={palette.primary} />
            <ThemedText style={styles.depthStageSignalText}>{signal}</ThemedText>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
