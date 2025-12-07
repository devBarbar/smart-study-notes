import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Markdown, { MarkdownIt, RenderRules } from 'react-native-markdown-display';
import MathView from 'react-native-math-view';

import { Colors, Radii, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

type MarkdownTextProps = {
  content: string;
};

/**
 * Renders markdown text with LaTeX math support.
 * - Inline math: $x^2$
 * - Block math: $$x^2 + y^2 = z^2$$
 */
export const MarkdownText: React.FC<MarkdownTextProps> = ({ content }) => {
  const scheme = useColorScheme();
  const palette = Colors[scheme ?? 'light'];

  const markdownIt = useMemo(() => {
    const parser = MarkdownIt({
      html: false,
      linkify: true,
      breaks: true,
      typographer: true,
    });

    // Register math parsing so $...$ and $$...$$ become math_inline / math_block tokens
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const katexPlugin = require('markdown-it-katex');
    parser.use(katexPlugin);
    return parser;
  }, []);

  const renderRules = useMemo<RenderRules>(
    () => ({
      math_inline: (node) => (
        <MathView
          key={node.key}
          math={node.content}
          style={styles.inlineMath}
          resizeMode="contain"
        />
      ),
      math_block: (node) => (
        <View key={node.key} style={styles.blockMathWrapper}>
          <MathView math={`\\displaystyle ${node.content}`} style={styles.blockMath} />
        </View>
      ),
    }),
    []
  );

  const markdownStyles = useMemo(
    () =>
      StyleSheet.create({
        body: {
          color: palette.text,
        },
        text: {
          color: palette.text,
        },
        paragraph: {
          color: palette.text,
          marginTop: 0,
          marginBottom: Spacing.xs,
        },
        heading1: { color: palette.text, marginTop: Spacing.xs, marginBottom: Spacing.xs },
        heading2: { color: palette.text, marginTop: Spacing.xs, marginBottom: Spacing.xs },
        heading3: { color: palette.text, marginTop: Spacing.xs, marginBottom: Spacing.xs },
        bullet_list: { marginTop: 0, marginBottom: Spacing.xs },
        ordered_list: { marginTop: 0, marginBottom: Spacing.xs },
        link: { color: palette.accent },
        code_inline: {
          backgroundColor: palette.surfaceAlt,
          color: palette.text,
          paddingHorizontal: 6,
          paddingVertical: 2,
          borderRadius: Radii.sm,
        },
        code_block: {
          backgroundColor: palette.surfaceAlt,
          color: palette.text,
          padding: Spacing.xs,
          borderRadius: Radii.md,
          borderWidth: 1,
          borderColor: palette.border,
        },
      }),
    [palette]
  );

  return (
    <Markdown markdownit={markdownIt} rules={renderRules} style={markdownStyles}>
      {content || ''}
    </Markdown>
  );
};

const styles = StyleSheet.create({
  blockMathWrapper: {
    marginVertical: Spacing.xs,
  },
  blockMath: {
    alignSelf: 'flex-start',
  },
  inlineMath: {
    alignSelf: 'flex-start',
  },
});

export default MarkdownText;

