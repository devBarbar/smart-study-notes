import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  AI_MODEL_OPTIONS,
  AI_PLATFORM_LABELS,
  AI_USE_CASES,
  AIPlatform,
  getDefaultModelForUseCase,
} from '../lib/ai-model-options';
import {
  SETTINGS_MIN_CONTRAST_RATIO,
  SETTINGS_THEME_COLORS,
  SETTINGS_TOUCH_TARGET_MIN,
} from '../lib/settings-a11y';

const hexToRgb = (hex: string) => {
  const normalized = hex.replace('#', '');
  assert.equal(normalized.length, 6, `Expected 6-digit hex color, got ${hex}`);
  return [0, 2, 4].map((index) => parseInt(normalized.slice(index, index + 2), 16) / 255);
};

const toLinear = (channel: number) =>
  channel <= 0.03928
    ? channel / 12.92
    : Math.pow((channel + 0.055) / 1.055, 2.4);

const relativeLuminance = (hex: string) => {
  const [red, green, blue] = hexToRgb(hex).map(toLinear);
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
};

const contrastRatio = (foreground: string, background: string) => {
  const foregroundLum = relativeLuminance(foreground);
  const backgroundLum = relativeLuminance(background);
  const lighter = Math.max(foregroundLum, backgroundLum);
  const darker = Math.min(foregroundLum, backgroundLum);
  return (lighter + 0.05) / (darker + 0.05);
};

test('settings color tokens satisfy WCAG AA contrast for normal text', () => {
  Object.entries(SETTINGS_THEME_COLORS).forEach(([themeName, theme]) => {
    const pairs = [
      ['page text', theme.text, theme.pageBackground],
      ['card text', theme.text, theme.cardBackground],
      ['card muted text', theme.mutedText, theme.cardBackground],
      ['control text', theme.text, theme.controlBackground],
      ['control muted text', theme.mutedText, theme.controlBackground],
      ['selected control text', theme.selectedText, theme.selectedBackground],
      ['primary button text', theme.primaryButtonText, theme.primaryButtonBackground],
      ['success text', theme.successText, theme.cardBackground],
    ] as const;

    pairs.forEach(([label, foreground, background]) => {
      assert.ok(
        contrastRatio(foreground, background) >= SETTINGS_MIN_CONTRAST_RATIO,
        `${themeName} ${label} does not meet ${SETTINGS_MIN_CONTRAST_RATIO}:1 contrast`,
      );
    });
  });
});

test('settings touch targets meet the 44 point accessibility minimum', () => {
  assert.ok(
    SETTINGS_TOUCH_TARGET_MIN >= 44,
    'Settings controls must use at least 44px/pt touch targets',
  );
});

test('every AI use case has selectable models for each provider', () => {
  const providers = Object.keys(AI_PLATFORM_LABELS) as AIPlatform[];

  AI_USE_CASES.forEach((useCase) => {
    providers.forEach((provider) => {
      const options = AI_MODEL_OPTIONS[useCase.id][provider];
      assert.ok(options.length > 0, `${useCase.id} has no ${provider} model options`);
      assert.ok(
        options.some((option) => option.model === getDefaultModelForUseCase(useCase.id, provider)),
        `${useCase.id} default ${provider} model is not selectable`,
      );
      assert.equal(
        new Set(options.map((option) => option.id)).size,
        options.length,
        `${useCase.id} ${provider} model option ids must be unique`,
      );
      options.forEach((option) => {
        assert.match(
          option.id,
          /^[a-z0-9-]+$/,
          `${useCase.id} ${provider} option id must be safe for testIDs`,
        );
      });
    });
  });
});

test('settings screen uses selectable model options instead of manual model typing', () => {
  const settingsSource = readFileSync(
    path.join(process.cwd(), 'app', '(tabs)', 'settings.tsx'),
    'utf8',
  );

  assert.match(settingsSource, /ai-model-option-\$\{item\.id\}-\$\{option\.id\}/);
  assert.doesNotMatch(settingsSource, /onChangeText=\{\(model\) => patchUseCaseConfig/);
  assert.doesNotMatch(settingsSource, /placeholder=\{item\.defaultModels\[config\.platform\]\}/);
});
