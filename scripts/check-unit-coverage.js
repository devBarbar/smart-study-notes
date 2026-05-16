#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const v8toIstanbul = require('v8-to-istanbul');
const { getChangedCoverageTargets } = require('./changed-coverage-files');

const root = path.resolve(__dirname, '..');
const coverageDir = path.join(root, '.coverage', 'unit-v8');
const changedTargets = getChangedCoverageTargets();
const changedFiles = changedTargets.map(({ filePath }) => filePath);
const threshold = 100;

if (changedFiles.length === 0) {
  console.log('No changed coverage source files found.');
  process.exit(0);
}

console.log(
  `Checking 100% unit changed-line coverage:\n${changedTargets
    .map((target) => `- ${target.filePath} (${target.changedLines.length} changed lines)`)
    .join('\n')}`,
);

fs.rmSync(coverageDir, { recursive: true, force: true });
fs.mkdirSync(coverageDir, { recursive: true });

const testFiles = fs
  .readdirSync('tests')
  .filter((file) => file.endsWith('.test.ts'))
  .sort()
  .map((file) => `tests/${file}`);

const result = spawnSync(
  process.execPath,
  [
    '--experimental-test-coverage',
    ...changedFiles.map((file) => `--test-coverage-include=${file}`),
    '--require',
    'ts-node/register',
    '--test',
    ...testFiles,
  ],
  {
    env: {
      ...process.env,
      NODE_V8_COVERAGE: coverageDir,
      TS_NODE_COMPILER_OPTIONS: '{"module":"CommonJS","types":["node"]}',
    },
    stdio: 'inherit',
  },
);

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

const readV8CoverageEntries = (absoluteFilePath) => {
  const fileUrl = `file://${absoluteFilePath}`;
  const entries = [];

  for (const filename of fs.readdirSync(coverageDir)) {
    if (!filename.endsWith('.json')) continue;
    const report = JSON.parse(
      fs.readFileSync(path.join(coverageDir, filename), 'utf8'),
    );
    for (const entry of report.result ?? []) {
      if (entry.url === fileUrl) {
        entries.push(entry);
      }
    }
  }

  return entries;
};

const percentage = (covered, total) =>
  total === 0 ? 100 : (covered / total) * 100;

const findPreviousCoveredLine = (lineCoverage, lineNumber) => {
  const previousLines = Array.from(lineCoverage.keys())
    .filter((line) => line < lineNumber)
    .sort((a, b) => b - a);
  return previousLines.find((line) => lineCoverage.get(line));
};

const isCoveredLine = (lineCoverage, sourceLines, lineNumber) => {
  if (lineCoverage.get(lineNumber)) return true;

  const sourceLine = sourceLines[lineNumber - 1]?.trim() ?? '';
  if (!sourceLine.startsWith('return ')) return false;

  const previousLine = findPreviousCoveredLine(lineCoverage, lineNumber);
  return previousLine !== undefined && lineCoverage.get(previousLine);
};

const summarizeChangedLineCoverage = (coverage, changedLines, sourceLines) => {
  const lineCoverage = new Map();

  for (const [statementId, location] of Object.entries(coverage.statementMap)) {
    const line = location.start.line;
    lineCoverage.set(
      line,
      Boolean(lineCoverage.get(line)) || coverage.s[statementId] > 0,
    );
  }

  const changedExecutableLines = changedLines.filter((line) =>
    lineCoverage.has(line),
  );
  const coveredLines = changedExecutableLines.filter((line) =>
    isCoveredLine(lineCoverage, sourceLines, line),
  );

  return {
    covered: coveredLines.length,
    total: changedExecutableLines.length,
    lines: percentage(coveredLines.length, changedExecutableLines.length),
    uncoveredLines: changedExecutableLines.filter(
      (line) => !isCoveredLine(lineCoverage, sourceLines, line),
    ),
  };
};

const formatPercent = (value) => `${value.toFixed(2)}%`;

const checkCoverage = async () => {
  for (const { filePath: relativeFilePath, changedLines } of changedTargets) {
    const absoluteFilePath = path.join(root, relativeFilePath);
    const entries = readV8CoverageEntries(absoluteFilePath);

    const converter = v8toIstanbul(absoluteFilePath);
    await converter.load();
    for (const entry of entries) {
      converter.applyCoverage(entry.functions);
    }

    const summary = summarizeChangedLineCoverage(
      converter.toIstanbul()[absoluteFilePath],
      changedLines,
      fs.readFileSync(absoluteFilePath, 'utf8').split('\n'),
    );
    console.log(
      `${relativeFilePath}: changed lines ${summary.covered}/${summary.total} (${formatPercent(summary.lines)})`,
    );

    if (summary.total === 0) {
      console.log(`${relativeFilePath}: no changed executable lines to measure`);
      continue;
    }

    if (summary.lines < threshold) {
      const uncovered = summary.uncoveredLines.slice(0, 20).join(', ');
      throw new Error(
        `${relativeFilePath} did not meet ${threshold}% unit changed-line coverage: ${formatPercent(summary.lines)}. Uncovered changed lines: ${uncovered}`,
      );
    }
  }
};

checkCoverage().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
