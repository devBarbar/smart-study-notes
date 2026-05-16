const fs = require('fs');
const { execFileSync } = require('child_process');

const DEFAULT_BASE = 'HEAD';
const SOURCE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx']);
const COVERAGE_SOURCE_ROOTS = [
  'app/',
  'components/',
  'constants/',
  'contexts/',
  'hooks/',
  'lib/',
  'supabase/functions/',
];
const EXCLUDED_PATH_PREFIXES = [
  'features/',
  'scripts/',
  'specs/',
  'tests/',
];
const EXCLUDED_PATH_SEGMENTS = [
  '/__fixtures__/',
  '/__mocks__/',
  '/__tests__/',
];
const EXCLUDED_FILE_PATTERNS = [
  /(^|\/)[\w.-]+\.config\.[cm]?[jt]sx?$/,
  /(^|\/)[\w.-]+\.test\.[cm]?[jt]sx?$/,
  /(^|\/)[\w.-]+\.spec\.[cm]?[jt]sx?$/,
  /(^|\/)expo-env\.d\.ts$/,
  /\.d\.ts$/,
 ];

const pathExtension = (filePath) => {
  if (filePath.endsWith('.d.ts')) return '.d.ts';
  const match = filePath.match(/(\.[cm]?[jt]sx?)$/);
  return match?.[1].replace(/^\.[cm]/, '.') ?? '';
};

const isCoverageSourceFile = (filePath) => {
  const extension = pathExtension(filePath);
  if (!SOURCE_EXTENSIONS.has(extension)) {
    return false;
  }

  if (EXCLUDED_PATH_PREFIXES.some((prefix) => filePath.startsWith(prefix))) {
    return false;
  }

  if (EXCLUDED_PATH_SEGMENTS.some((segment) => filePath.includes(segment))) {
    return false;
  }

  if (EXCLUDED_FILE_PATTERNS.some((pattern) => pattern.test(filePath))) {
    return false;
  }

  return COVERAGE_SOURCE_ROOTS.some((root) => filePath.startsWith(root));
};

const getChangedCoverageFiles = ({
  base = process.env.COVERAGE_BASE || DEFAULT_BASE,
} = {}) => {
  const diffOutput = execFileSync(
    'git',
    ['diff', '--name-only', '--diff-filter=ACMRT', base, '--'],
    { encoding: 'utf8' },
  );
  const untrackedOutput = execFileSync(
    'git',
    ['ls-files', '--others', '--exclude-standard'],
    { encoding: 'utf8' },
  );

  return Array.from(new Set(`${diffOutput}\n${untrackedOutput}`
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean)
    .filter(isCoverageSourceFile)));
};

const parseChangedLinesFromDiff = (diffOutput) => {
  const changedLines = new Set();
  const hunkPattern = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;

  for (const line of diffOutput.split('\n')) {
    const match = line.match(hunkPattern);
    if (!match) continue;

    const start = Number(match[1]);
    const count = match[2] === undefined ? 1 : Number(match[2]);
    for (let offset = 0; offset < count; offset += 1) {
      changedLines.add(start + offset);
    }
  }

  return Array.from(changedLines).sort((a, b) => a - b);
};

const getDiffChangedLines = (filePath, base) => {
  const diffOutput = execFileSync(
    'git',
    ['diff', '--unified=0', '--diff-filter=ACMRT', base, '--', filePath],
    { encoding: 'utf8' },
  );
  return parseChangedLinesFromDiff(diffOutput);
};

const getAllFileLines = (filePath) => {
  const source = fs.readFileSync(filePath, 'utf8');
  return source
    .split('\n')
    .map((line, index) => ({ line, lineNumber: index + 1 }))
    .filter(({ line }) => line.trim().length > 0)
    .map(({ lineNumber }) => lineNumber);
};

const filterChangedLinesToSource = (filePath, changedLines) => {
  const sourceLines = fs.readFileSync(filePath, 'utf8').split('\n');
  return changedLines.filter((lineNumber) => sourceLines[lineNumber - 1]?.trim().length > 0);
};

const getChangedCoverageTargets = ({
  base = process.env.COVERAGE_BASE || DEFAULT_BASE,
} = {}) => {
  const trackedFiles = getChangedCoverageFiles({ base });
  return trackedFiles.map((filePath) => {
    const diffLines = getDiffChangedLines(filePath, base);
    return {
      filePath,
      changedLines: diffLines.length > 0 ? filterChangedLinesToSource(filePath, diffLines) : getAllFileLines(filePath),
    };
  });
};

module.exports = {
  getChangedCoverageTargets,
  getChangedCoverageFiles,
  isCoverageSourceFile,
  parseChangedLinesFromDiff,
  filterChangedLinesToSource,
};
