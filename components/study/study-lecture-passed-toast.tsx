import { Ionicons } from "@expo/vector-icons";
import { View } from "react-native";

import { StudyStyles } from "@/components/study/study-styles";
import { ThemedText } from "@/components/themed-text";

type StudyLecturePassedToastProps = {
  styles: StudyStyles;
  t: (key: string, params?: Record<string, any>) => string;
};

export function StudyLecturePassedToast({
  styles,
  t,
}: StudyLecturePassedToastProps) {
  return (
    <View style={styles.lecturePassedNotification}>
      <Ionicons name="trophy" size={18} color="#fff" />
      <ThemedText style={styles.lecturePassedNotificationText}>
        {t("lecture.passedToast")}
      </ThemedText>
    </View>
  );
}
