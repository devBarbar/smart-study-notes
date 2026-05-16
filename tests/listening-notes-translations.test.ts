import assert from 'node:assert/strict';
import test from 'node:test';

import de from '../lib/translations/de';
import en from '../lib/translations/en';

test('English listening notes copy explains that answers open after audio', () => {
  assert.equal(
    en['study.guidedNotesMode'],
    'Listen and write notes on this page. The question appears on a clean answer page when the explanation ends.',
  );
  assert.equal(en['study.stopGuidedAudio'], 'Stop and answer');
});

test('German listening notes copy explains that answers open after audio', () => {
  assert.equal(
    de['study.guidedNotesMode'],
    'Höre zu und schreibe Notizen auf diese Seite. Die Frage erscheint nach der Erklärung auf einer leeren Antwortseite.',
  );
  assert.equal(de['study.stopGuidedAudio'], 'Stoppen und antworten');
});

