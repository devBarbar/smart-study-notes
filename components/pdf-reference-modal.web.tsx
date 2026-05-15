import { Ionicons } from "@expo/vector-icons";
import { useMemo } from "react";
import {
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";

import { Colors, Radii, Spacing } from "@/constants/theme";
import { useLanguage } from "@/contexts/language-context";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { LectureFile, StudyCitation } from "@/types";

import { ThemedText } from "./themed-text";

type Props = {
  visible: boolean;
  file?: LectureFile | null;
  citation?: StudyCitation | null;
  label?: string;
  sourceLabel?: string;
  onClose: () => void;
};

export const PdfReferenceModal = ({
  visible,
  file,
  citation,
  label,
  sourceLabel,
  onClose,
}: Props) => {
  const { t } = useLanguage();
  const colorScheme = useColorScheme();
  const palette = Colors[colorScheme === "dark" ? "dark" : "light"];
  const styles = useMemo(() => createStyles(palette), [palette]);
  const page = Math.max(1, citation?.pageNumber ?? 1);
  const viewerUri = file?.uri ? `${file.uri}#page=${page}` : "";

  const openExternal = () => {
    if (!file?.uri) return;
    Linking.openURL(citation?.pageNumber ? `${file.uri}#page=${page}` : file.uri).catch(
      (err) => console.warn("[pdf-reference] Failed to open source externally", err),
    );
  };

  return (
    <Modal visible={visible} animationType="fade" onRequestClose={onClose}>
      <View style={styles.container}>
        <View style={styles.header}>
          <View style={styles.titleStack}>
            <ThemedText type="defaultSemiBold" style={styles.title}>
              {label ?? t("pdfReference.title")}
            </ThemedText>
            <ThemedText tone="muted" style={styles.subtitle}>
              {sourceLabel ? `${sourceLabel} - ` : ""}
              {file?.name ?? t("pdfReference.source")}
            </ThemedText>
          </View>
          <Pressable onPress={openExternal} style={styles.iconButton}>
            <Ionicons name="open-outline" size={20} color={palette.text} />
          </Pressable>
          <Pressable onPress={onClose} style={styles.iconButton}>
            <Ionicons name="close" size={22} color={palette.text} />
          </Pressable>
        </View>

        <View style={styles.body}>
          <View style={styles.pdfPane}>
            {viewerUri ? (
              <iframe
                src={viewerUri}
                title={label ?? t("pdfReference.title")}
                style={{
                  border: "none",
                  width: "100%",
                  height: "100%",
                }}
              />
            ) : (
              <View style={styles.emptyState}>
                <ThemedText>{t("pdfReference.noFile")}</ThemedText>
              </View>
            )}
          </View>

          <View style={styles.sourcePane}>
            <ThemedText type="defaultSemiBold">
              {t("pdfReference.sourceExcerpt")}
            </ThemedText>
            <ThemedText tone="muted" style={styles.locationMeta}>
              {formatLineRange(citation, t)}
            </ThemedText>
            <HighlightedSnippet citation={citation} palette={palette} />
          </View>
        </View>
      </View>
    </Modal>
  );
};

const formatLineRange = (
  citation: StudyCitation | null | undefined,
  t: (key: string, params?: Record<string, string | number>, fallbackText?: string) => string,
) => {
  if (!citation?.startLine) return t("pdfReference.lineUnavailable");
  if (citation.endLine && citation.endLine !== citation.startLine) {
    return t("pdfReference.lines", {
      start: citation.startLine,
      end: citation.endLine,
    });
  }
  return t("pdfReference.line", { line: citation.startLine });
};

const HighlightedSnippet = ({
  citation,
  palette,
}: {
  citation?: StudyCitation | null;
  palette: typeof Colors.light;
}) => {
  const { t } = useLanguage();
  const snippet = citation?.snippet?.trim();

  if (!snippet) {
    return (
      <ThemedText tone="muted" style={stylesStatic.empty}>
        {t("pdfReference.snippetUnavailable")}
      </ThemedText>
    );
  }

  const lines = snippet.split(/\r?\n/).filter(Boolean);
  const startLine = citation?.startLine;

  return (
    <ScrollView style={stylesStatic.snippetScroll}>
      {lines.map((line, index) => (
        <View
          key={`${index}-${line.slice(0, 12)}`}
          style={[
            stylesStatic.snippetLine,
            { backgroundColor: `${palette.primary}14` },
          ]}
        >
          {startLine ? (
            <ThemedText tone="muted" style={stylesStatic.lineNumber}>
              {startLine + index}
            </ThemedText>
          ) : null}
          <ThemedText selectable style={stylesStatic.lineText}>
            {line}
          </ThemedText>
        </View>
      ))}
    </ScrollView>
  );
};

const createStyles = (palette: typeof Colors.light) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: palette.background,
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      gap: Spacing.sm,
      padding: Spacing.md,
      borderBottomWidth: 1,
      borderColor: palette.border,
      backgroundColor: palette.surface,
    },
    titleStack: {
      flex: 1,
      gap: 2,
    },
    title: {
      fontSize: 17,
    },
    subtitle: {
      fontSize: 13,
    },
    iconButton: {
      width: 40,
      height: 40,
      borderRadius: Radii.md,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: palette.surfaceAlt,
      borderWidth: 1,
      borderColor: palette.border,
    },
    body: {
      flex: 1,
      flexDirection: "row",
      gap: Spacing.md,
      padding: Spacing.md,
    },
    pdfPane: {
      flex: 1,
      overflow: "hidden",
      borderRadius: Radii.lg,
      borderWidth: 1,
      borderColor: palette.border,
      backgroundColor: palette.surfaceAlt,
    },
    sourcePane: {
      width: 340,
      gap: Spacing.sm,
      padding: Spacing.md,
      borderRadius: Radii.lg,
      borderWidth: 1,
      borderColor: palette.border,
      backgroundColor: palette.surface,
    },
    locationMeta: {
      fontSize: 13,
    },
    emptyState: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
    },
  });

const stylesStatic = StyleSheet.create({
  snippetScroll: {
    flex: 1,
  },
  snippetLine: {
    flexDirection: "row",
    gap: 10,
    paddingVertical: 7,
    paddingHorizontal: 8,
    borderRadius: Radii.sm,
    marginBottom: 6,
  },
  lineNumber: {
    width: 34,
    fontSize: 12,
    fontVariant: ["tabular-nums"],
    textAlign: "right",
  },
  lineText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 19,
  },
  empty: {
    fontSize: 13,
    lineHeight: 19,
  },
});
