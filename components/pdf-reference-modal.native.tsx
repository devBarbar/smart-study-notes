import { Ionicons } from "@expo/vector-icons";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import Pdf from "react-native-pdf";

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
  const pdfRef = useRef<any>(null);
  const { width } = useWindowDimensions();
  const { t } = useLanguage();
  const colorScheme = useColorScheme();
  const palette = Colors[colorScheme === "dark" ? "dark" : "light"];
  const styles = useMemo(() => createStyles(palette), [palette]);
  const targetPage = Math.max(1, citation?.pageNumber ?? 1);
  const [currentPage, setCurrentPage] = useState(targetPage);
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const isWide = width >= 820;

  useEffect(() => {
    if (!visible) return;
    setCurrentPage(targetPage);
    setPageCount(null);
    setLoadError(null);
    requestAnimationFrame(() => {
      pdfRef.current?.setPage?.(targetPage);
    });
  }, [targetPage, visible]);

  const source = useMemo(
    () => (file?.uri ? { uri: file.uri, cache: true } : undefined),
    [file?.uri],
  );

  const openExternal = () => {
    if (!file?.uri) return;
    const target = citation?.pageNumber
      ? `${file.uri}#page=${citation.pageNumber}`
      : file.uri;
    Linking.openURL(target).catch((err) =>
      console.warn("[pdf-reference] Failed to open source externally", err),
    );
  };

  const goToPage = (page: number) => {
    const nextPage = Math.max(1, Math.min(page, pageCount ?? page));
    setCurrentPage(nextPage);
    pdfRef.current?.setPage?.(nextPage);
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
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
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("pdfReference.close")}
            onPress={onClose}
            style={styles.iconButton}
          >
            <Ionicons name="close" size={22} color={palette.text} />
          </Pressable>
        </View>

        <View style={[styles.body, isWide && styles.bodyWide]}>
          <View style={styles.pdfPane}>
            {source && !loadError ? (
              <Pdf
                ref={pdfRef}
                source={source}
                page={targetPage}
                trustAllCerts={false}
                enablePaging
                onLoadComplete={(pages) => {
                  const resolvedPage = Math.min(targetPage, pages);
                  setPageCount(pages);
                  setCurrentPage(resolvedPage);
                  pdfRef.current?.setPage?.(resolvedPage);
                }}
                onPageChanged={(page, pages) => {
                  setCurrentPage(page);
                  setPageCount(pages);
                }}
                onError={(error) => {
                  const message =
                    error instanceof Error ? error.message : String(error);
                  setLoadError(message);
                }}
                renderActivityIndicator={() => (
                  <ActivityIndicator color={palette.primary} />
                )}
                style={styles.pdf}
              />
            ) : (
              <View style={styles.errorState}>
                <Ionicons
                  name="document-text-outline"
                  size={42}
                  color={palette.textMuted}
                />
                <ThemedText type="defaultSemiBold">
                  {t("pdfReference.unavailable")}
                </ThemedText>
                <ThemedText tone="muted" style={styles.errorText}>
                  {loadError ?? t("pdfReference.noFile")}
                </ThemedText>
                <Pressable style={styles.externalButton} onPress={openExternal}>
                  <Ionicons name="open-outline" size={16} color={palette.primary} />
                  <ThemedText type="defaultSemiBold" tone="primary">
                    {t("pdfReference.openExternal")}
                  </ThemedText>
                </Pressable>
              </View>
            )}
          </View>

          <View style={styles.sourcePane}>
            <View style={styles.pageControls}>
              <Pressable
                style={[styles.pageButton, currentPage <= 1 && styles.disabled]}
                disabled={currentPage <= 1}
                onPress={() => goToPage(currentPage - 1)}
              >
                <Ionicons name="chevron-back" size={18} color={palette.text} />
              </Pressable>
              <ThemedText style={styles.pageLabel}>
                {t("pdfReference.page", {
                  page: currentPage,
                  total: pageCount ?? "?",
                })}
              </ThemedText>
              <Pressable
                style={[
                  styles.pageButton,
                  pageCount !== null && currentPage >= pageCount && styles.disabled,
                ]}
                disabled={pageCount !== null && currentPage >= pageCount}
                onPress={() => goToPage(currentPage + 1)}
              >
                <Ionicons name="chevron-forward" size={18} color={palette.text} />
              </Pressable>
            </View>

            <View style={styles.locationCard}>
              <ThemedText type="defaultSemiBold" style={styles.locationTitle}>
                {t("pdfReference.sourceExcerpt")}
              </ThemedText>
              <ThemedText tone="muted" style={styles.locationMeta}>
                {formatLineRange(citation, t)}
              </ThemedText>
              <HighlightedSnippet citation={citation} palette={palette} />
            </View>
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
      <ThemedText tone="muted" style={snippetStyles.empty}>
        {t("pdfReference.snippetUnavailable")}
      </ThemedText>
    );
  }

  const lines = snippet.split(/\r?\n/).filter(Boolean);
  const startLine = citation?.startLine;

  return (
    <ScrollView style={snippetStyles.scroll}>
      {lines.map((line, index) => (
        <View
          key={`${index}-${line.slice(0, 12)}`}
          style={[
            snippetStyles.line,
            { backgroundColor: `${palette.primary}14` },
          ]}
        >
          {startLine ? (
            <ThemedText tone="muted" style={snippetStyles.lineNumber}>
              {startLine + index}
            </ThemedText>
          ) : null}
          <ThemedText selectable style={snippetStyles.lineText}>
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
      justifyContent: "space-between",
      gap: Spacing.md,
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
      gap: Spacing.md,
      padding: Spacing.md,
    },
    bodyWide: {
      flexDirection: "row",
    },
    pdfPane: {
      flex: 1,
      minHeight: 360,
      overflow: "hidden",
      borderRadius: Radii.lg,
      borderWidth: 1,
      borderColor: palette.border,
      backgroundColor: palette.surfaceAlt,
    },
    pdf: {
      flex: 1,
      width: "100%",
      height: "100%",
      backgroundColor: palette.surfaceAlt,
    },
    sourcePane: {
      gap: Spacing.md,
      flexBasis: 320,
    },
    pageControls: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: Spacing.sm,
      padding: Spacing.sm,
      borderRadius: Radii.md,
      borderWidth: 1,
      borderColor: palette.border,
      backgroundColor: palette.surface,
    },
    pageButton: {
      width: 38,
      height: 38,
      borderRadius: Radii.md,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: palette.surfaceAlt,
      borderWidth: 1,
      borderColor: palette.border,
    },
    disabled: {
      opacity: 0.4,
    },
    pageLabel: {
      fontSize: 14,
      fontWeight: "700",
      fontVariant: ["tabular-nums"],
    },
    locationCard: {
      flex: 1,
      minHeight: 220,
      gap: Spacing.sm,
      padding: Spacing.md,
      borderRadius: Radii.lg,
      borderWidth: 1,
      borderColor: palette.border,
      backgroundColor: palette.surface,
    },
    locationTitle: {
      fontSize: 15,
    },
    locationMeta: {
      fontSize: 13,
    },
    errorState: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      gap: Spacing.sm,
      padding: Spacing.lg,
    },
    errorText: {
      textAlign: "center",
      fontSize: 13,
    },
    externalButton: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      paddingHorizontal: 12,
      paddingVertical: 9,
      borderRadius: Radii.md,
      backgroundColor: `${palette.primary}12`,
      borderWidth: 1,
      borderColor: `${palette.primary}26`,
    },
  });

const snippetStyles = StyleSheet.create({
  scroll: {
    flex: 1,
  },
  line: {
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
