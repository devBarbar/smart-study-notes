import { Ionicons } from "@expo/vector-icons";
import { Pressable, View } from "react-native";

import { StudyStyles } from "@/components/study/study-styles";
import { ThemedText } from "@/components/themed-text";

type StudyChatHeaderProps = {
  styles: StudyStyles;
  t: (key: string, params?: Record<string, any>) => string;
  ttsEnabled: boolean;
  listeningMode: boolean;
  onToggleTutor: () => void;
  onToggleTts: () => void;
  onToggleListening: () => void;
  onRestartSession: () => void;
};

export function StudyChatHeader({
  styles,
  t,
  ttsEnabled,
  listeningMode,
  onToggleTutor,
  onToggleTts,
  onToggleListening,
  onRestartSession,
}: StudyChatHeaderProps) {
  return (
    <View style={styles.chatHeader}>
      <View style={styles.chatTitleRow}>
        <ThemedText type="title" style={{ color: "#fff" }}>
          {t("study.aiTutor")}
        </ThemedText>
        <Pressable
          style={styles.collapseTutorButton}
          onPress={onToggleTutor}
          accessibilityLabel={t("study.hideTutor")}
          accessibilityRole="button"
        >
          <Ionicons name="chevron-forward" size={20} color="#64748b" />
        </Pressable>
      </View>
      <View style={styles.voiceControlsRow}>
        <Pressable
          style={styles.ttsToggle}
          onPress={onRestartSession}
          accessibilityLabel={t("study.restartSession")}
          accessibilityRole="button"
        >
          <Ionicons name="refresh" size={18} color="#64748b" />
        </Pressable>
        <Pressable
          style={[styles.ttsToggle, ttsEnabled && styles.ttsToggleActive]}
          onPress={onToggleTts}
          accessibilityLabel={
            ttsEnabled ? t("voice.disableTts") : t("voice.enableTts")
          }
          accessibilityRole="button"
        >
          <Ionicons
            name={ttsEnabled ? "volume-high" : "volume-mute"}
            size={20}
            color={ttsEnabled ? "#10b981" : "#64748b"}
          />
        </Pressable>
        <Pressable
          style={[
            styles.ttsToggle,
            listeningMode && styles.listeningModeActive,
          ]}
          onPress={onToggleListening}
          accessibilityLabel={
            listeningMode
              ? t("voice.disableListening")
              : t("voice.enableListening")
          }
          accessibilityRole="button"
        >
          <Ionicons
            name={listeningMode ? "ear" : "ear-outline"}
            size={18}
            color={listeningMode ? "#f59e0b" : "#64748b"}
          />
        </Pressable>
      </View>
    </View>
  );
}
