import assert from 'node:assert/strict';
import type { NobleProfile } from '../src/ui/nobleProfile.ts';

const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const storage = new Map<string, string>();
let storageAvailable = true;
Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: {
    localStorage: {
      getItem(key: string) {
        if (!storageAvailable) throw new Error('Storage unavailable');
        return storage.get(key) ?? null;
      },
      setItem(key: string, value: string) {
        if (!storageAvailable) throw new Error('Storage unavailable');
        storage.set(key, value);
      },
    },
  },
});

// A fresh module instance models the next page load without retaining session state.
async function loadProfileSession(name: string): Promise<typeof import('../src/ui/nobleProfile.ts')> {
  const url = new URL('../src/ui/nobleProfile.ts', import.meta.url);
  url.searchParams.set('session', name);
  return import(url.href);
}

try {
  const first = await loadProfileSession('first');
  assert.deepEqual(first.getCurrentNobleProfile(), first.DEFAULT_NOBLE_PROFILE);
  assert.equal(first.getCurrentNobleProfile().heraldry.charge, 'bear');
  const chosen: NobleProfile = {
    nobleId: 'ivan-lenkovic',
    displayName: 'House of the Silver Pine',
    heraldry: {
      ...first.DEFAULT_NOBLE_PROFILE.heraldry,
      pattern: 'saltire',
      fieldColor: '#2e5266',
      patternColor: '#c59b48',
      patternTiling: 3,
      patternAngle: 15,
      charge: 'wolf',
      chargeColor: '#d8d1bb',
      chargeOutlineColor: '#66445b',
      chargeCount: 3,
      chargeScale: 0.42,
    },
  };
  first.setCurrentNobleProfile(chosen);
  assert.deepEqual(first.getCurrentNobleProfile(), chosen);
  assert.equal(storage.size, 0, 'an unfinished setup must not replace the default');

  first.persistCurrentNobleProfile();
  const returning = await loadProfileSession('returning');
  assert.deepEqual(returning.getCurrentNobleProfile(), chosen,
    'returning players retain their entire chosen profile, including charge outline');

  returning.setCurrentNobleProfile(returning.DEFAULT_NOBLE_PROFILE);
  const abandoned = await loadProfileSession('abandoned-setup');
  assert.deepEqual(abandoned.getCurrentNobleProfile(), chosen,
    'leaving a new setup before entering its world preserves the last played profile');

  returning.persistCurrentNobleProfile();
  const nextWorld = await loadProfileSession('next-world');
  assert.deepEqual(nextWorld.getCurrentNobleProfile(), returning.DEFAULT_NOBLE_PROFILE,
    'entering another world replaces the remembered default with its chosen profile');

  nextWorld.setCurrentNobleProfile(chosen);
  storageAvailable = false;
  assert.doesNotThrow(() => nextWorld.persistCurrentNobleProfile());
  assert.deepEqual(nextWorld.getCurrentNobleProfile(), chosen,
    'unavailable browser storage must not prevent using the current heraldry');
} finally {
  if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
  else Reflect.deleteProperty(globalThis, 'window');
}

console.log('Noble profile persistence preserves the last played heraldry across page loads.');
