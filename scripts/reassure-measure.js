#!/usr/bin/env node

const path = require('node:path');

const cliRoot = path.dirname(require.resolve('@callstack/reassure-cli'));
const { run } = require(path.join(cliRoot, 'commands', 'measure.js'));

const args = process.argv.slice(2);

const options = {
  _: [],
  baseline: false,
  compare: true,
  silent: false,
  verbose: false,
};

for (const arg of args) {
  if (arg === '--baseline') {
    options.baseline = true;
  } else if (arg === '--silent') {
    options.silent = true;
  } else if (arg === '--verbose') {
    options.verbose = true;
  } else if (arg === '--no-compare') {
    options.compare = false;
  } else if (arg.startsWith('--branch=')) {
    options.branch = arg.slice('--branch='.length);
  } else if (arg.startsWith('--commit-hash=')) {
    options.commitHash = arg.slice('--commit-hash='.length);
  } else {
    options._.push(arg);
  }
}

run(options).catch((error) => {
  console.error(error);
  process.exit(1);
});
