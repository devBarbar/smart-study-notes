import { configure } from 'reassure';
import { performance as nodePerformance } from 'node:perf_hooks';

const runs = Number(process.env.REASSURE_RUNS ?? 20);
const warmupRuns = Number(process.env.REASSURE_WARMUP_RUNS ?? 2);

configure({
  testingLibrary: 'react-native',
  runs,
  warmupRuns,
});

(globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__ = true;

Object.defineProperty(globalThis, 'performance', {
  configurable: true,
  value: {
    now: () => nodePerformance.now(),
  },
  writable: true,
});

globalThis.requestAnimationFrame = (callback: FrameRequestCallback) => {
  callback(0);
  return 1;
};

globalThis.cancelAnimationFrame = () => undefined;

beforeEach(() => {
  jest.clearAllMocks();
});
