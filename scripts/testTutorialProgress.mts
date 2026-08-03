import assert from 'node:assert/strict';
import {
  PersistentTutorialCompletions,
  type TutorialStorage,
} from '../src/ui/PersistentTutorialCompletions.ts';

type TutorialId = 'welcome' | 'workforce' | 'fire';

const STORAGE_KEY = 'tutorial-progress-test';
const VALID_IDS = new Set<TutorialId>(['welcome', 'workforce', 'fire']);
const isTutorialId = (value: string): value is TutorialId => VALID_IDS.has(value as TutorialId);

class MemoryStorage implements TutorialStorage {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

function testAcknowledgementsSurviveRefreshAndResetExplicitly(): void {
  const storage = new MemoryStorage();
  const firstSession = new PersistentTutorialCompletions(
    () => storage,
    STORAGE_KEY,
    isTutorialId,
  );

  assert.equal(firstSession.has('workforce'), false);
  firstSession.complete('workforce');

  const refreshedSession = new PersistentTutorialCompletions(
    () => storage,
    STORAGE_KEY,
    isTutorialId,
  );
  assert.equal(refreshedSession.has('workforce'), true);

  refreshedSession.clear();
  const replayedSession = new PersistentTutorialCompletions(
    () => storage,
    STORAGE_KEY,
    isTutorialId,
  );
  assert.equal(replayedSession.has('workforce'), false);
}

function testMalformedAndStaleProgressIsHarmless(): void {
  const storage = new MemoryStorage();
  storage.values.set(STORAGE_KEY, '["workforce","retired-tutorial",42]');
  const filtered = new PersistentTutorialCompletions(
    () => storage,
    STORAGE_KEY,
    isTutorialId,
  );
  assert.equal(filtered.has('workforce'), true);
  assert.equal(filtered.has('fire'), false);

  storage.values.set(STORAGE_KEY, '{not valid json');
  const malformed = new PersistentTutorialCompletions(
    () => storage,
    STORAGE_KEY,
    isTutorialId,
  );
  assert.equal(malformed.has('workforce'), false);

  const unavailable = new PersistentTutorialCompletions(
    () => { throw new Error('storage unavailable'); },
    STORAGE_KEY,
    isTutorialId,
  );
  assert.doesNotThrow(() => unavailable.complete('fire'));
  assert.doesNotThrow(() => unavailable.clear());
}

testAcknowledgementsSurviveRefreshAndResetExplicitly();
testMalformedAndStaleProgressIsHarmless();
console.log('Tutorial completion persistence checks passed.');
