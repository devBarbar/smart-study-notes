import assert from 'node:assert/strict';
import Module from 'node:module';
import test from 'node:test';

import './utils/react-native-test-env';

type ModuleLoader = (
  request: string,
  parent: NodeModule | null,
  isMain: boolean,
) => unknown;

const moduleWithLoader = Module as unknown as {
  _load: ModuleLoader;
};
const previousLoad = moduleWithLoader._load;

test('StreamingTTSPlayer completes playback without native status event listeners', async () => {
  let addListenerCalls = 0;
  let playCalls = 0;
  let pauseCalls = 0;
  let removeCalls = 0;
  let modeCalls = 0;
  const status = {
    id: 'player-1',
    currentTime: 0,
    playbackState: 'ready',
    timeControlStatus: 'paused',
    reasonForWaitingToPlay: '',
    mute: false,
    duration: 1,
    playing: false,
    loop: false,
    didJustFinish: false,
    isBuffering: false,
    isLoaded: true,
    playbackRate: 1,
    shouldCorrectPitch: true,
    isLive: false,
  };

  moduleWithLoader._load = function load(request, parent, isMain) {
    if (request === 'expo-audio') {
      return {
        createAudioPlayer: () => ({
          isLoaded: true,
          duration: 1,
          get currentStatus() {
            return status;
          },
          addListener: () => {
            addListenerCalls += 1;
            throw new Error('Native playback status listeners should not be used');
          },
          pause: () => {
            pauseCalls += 1;
          },
          play: () => {
            playCalls += 1;
            status.playing = true;
            setTimeout(() => {
              status.playing = false;
              status.currentTime = 1;
              status.didJustFinish = true;
            }, 20);
          },
          remove: () => {
            removeCalls += 1;
          },
        }),
        setAudioModeAsync: async () => {
          modeCalls += 1;
        },
      };
    }

    if (request === 'expo-file-system/legacy') {
      return {
        cacheDirectory: 'file:///tmp/',
        documentDirectory: 'file:///tmp/',
        EncodingType: { Base64: 'base64' },
        writeAsStringAsync: async () => undefined,
        getInfoAsync: async () => ({ exists: true, size: 2048 }),
      };
    }

    if (request === 'expo-speech') {
      return {
        speak: () => undefined,
        stop: async () => undefined,
      };
    }

    if (request === './supabase') {
      return {
        getSupabase: () => null,
      };
    }

    return previousLoad.call(this, request, parent, isMain);
  };

  try {
    const { StreamingTTSPlayer, createAudioPlaybackCompletion } = await import('../lib/audio');
    const player = new StreamingTTSPlayer();

    let helperClearCalls = 0;
    let helperReleaseCalls = 0;
    const helperStatus = {
      ...status,
      currentTime: 0.96,
      didJustFinish: false,
      playing: false,
    };
    const helperPlayer = {
      duration: 1,
      currentStatus: helperStatus,
    } as any;
    const helperPlayback = createAudioPlaybackCompletion({
      player: helperPlayer,
      expectedGeneration: 2,
      getPlaybackGeneration: () => 2,
      getCurrentPlayer: () => helperPlayer,
      releasePlayer: () => {
        helperReleaseCalls += 1;
      },
      clearPollTimer: () => {
        helperClearCalls += 1;
      },
      setPollTimer: (timer) => {
        clearInterval(timer);
      },
    });
    helperPlayback.pollStatus();
    helperPlayback.finish();
    await helperPlayback.promise;

    assert.equal(helperClearCalls, 1);
    assert.equal(helperReleaseCalls, 1);

    await (player as unknown as {
      playAudioFile: (
        uri: string,
        options: { generation: number; notifyStart: boolean },
      ) => Promise<void>;
    }).playAudioFile('file:///tmp/tts.mp3', {
      generation: 0,
      notifyStart: true,
    });

    assert.equal(modeCalls, 1);
    assert.equal(playCalls, 1);
    assert.equal(addListenerCalls, 0);
    assert.equal(pauseCalls, 0);
    assert.equal(removeCalls, 1);

    let manualPauseCalls = 0;
    let manualRemoveCalls = 0;
    const manualTimer = setInterval(() => undefined, 1000);
    (player as any).playbackPollTimer = manualTimer;
    (player as any).player = {
      pause: () => {
        manualPauseCalls += 1;
      },
      remove: () => {
        manualRemoveCalls += 1;
      },
    };
    await player.stop();

    assert.equal(manualPauseCalls, 1);
    assert.equal(manualRemoveCalls, 1);
    assert.equal((player as any).playbackPollTimer, null);
    assert.equal((player as any).player, null);
  } finally {
    moduleWithLoader._load = previousLoad;
  }
});
