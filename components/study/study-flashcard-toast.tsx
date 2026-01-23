import { Ionicons } from "@expo/vector-icons";
import { View } from "react-native";

import { StudyStyles } from "@/components/study/study-styles";
import { ThemedText } from "@/components/themed-text";

type StudyFlashcardToastProps = {
  styles: StudyStyles;
  t: (key: string, params?: Record<string, any>) => string;
};

export function StudyFlashcardToast({ styles, t }: StudyFlashcardToastProps) {
  return (
    <View style={styles.flashcardNotification}>
      <Ionicons name="layers" size={18} color="#fff" />
      <ThemedText style={styles.flashcardNotificationText}>
        {t("flashcards.added")}
      </ThemedText>
    </View>
  );
}
