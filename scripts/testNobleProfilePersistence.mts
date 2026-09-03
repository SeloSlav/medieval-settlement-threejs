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
  const colorKeys = ['fieldColor', 'patternColor', 'chargeColor', 'chargeOutlineColor'] as const;
  const palette = first.HERALDRY_TINCTURES;
  const paletteValues = new Set<string>(palette.map((color) => color.value));
  assert.equal(palette.length, 10, 'all four color rows offer ten cloth colors');
  assert.equal(paletteValues.size, 10, 'no duplicate color swatches');
  assert.equal(new Set(palette.map((color) => color.id)).size, 10);
  assert.equal(new Set(palette.map((color) => color.name)).size, 10);
  for (const color of palette) {
    assert.match(color.value, /^#[0-9a-f]{6}$/);
    assert.ok(color.dye && color.description, `${color.name} needs its dye-source tooltip`);
  }
  for (const preset of first.HERALDRY_PRESETS) {
    for (const key of colorKeys) {
      assert.ok(paletteValues.has(preset[key]), `preset ${key} must select a current swatch`);
    }
  }
  const chosen: NobleProfile = {
    nobleId: 'ivan-lenkovic',
    displayName: 'House of the Silver Pine',
    heraldry: {
      ...first.DEFAULT_NOBLE_PROFILE.heraldry,
      pattern: 'saltire',
      fieldColor: first.HERALDRY_CLOTH_COLORS.blue,
      patternColor: first.HERALDRY_CLOTH_COLORS.yellow,
      patternTiling: 3,
      patternAngle: 15,
      charge: 'wolf',
      chargeColor: first.HERALDRY_CLOTH_COLORS.white,
      chargeOutlineColor: first.HERALDRY_CLOTH_COLORS.purple,
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

  // Every dye must survive normalization, rendering, and a fresh page load in
  // every color role, including the three new dyes and the independent outline.
  const cssProperties = {
    fieldColor: '--field-a', patternColor: '--field-b',
    chargeColor: '--charge-color', chargeOutlineColor: '--charge-outline-color',
  } as const;
  for (const color of palette) {
    for (const key of colorKeys) {
      const profile = { ...chosen, heraldry: { ...chosen.heraldry, [key]: color.value } };
      nextWorld.setCurrentNobleProfile(profile);
      assert.deepEqual(nextWorld.getCurrentNobleProfile(), profile);
      const properties = new Map<string, string>();
      const shield = {
        dataset: {},
        style: { setProperty: (name: string, value: string) => properties.set(name, value) },
      } as unknown as HTMLElement;
      nextWorld.applyHeraldryToElement(shield, profile.heraldry);
      assert.equal(properties.get(cssProperties[key]), color.value);
      nextWorld.persistCurrentNobleProfile();
      const restored = await loadProfileSession(`${color.id}-${key}`);
      assert.deepEqual(restored.getCurrentNobleProfile(), profile);
    }
  }

  nextWorld.setCurrentNobleProfile(chosen);
  storageAvailable = false;
  assert.doesNotThrow(() => nextWorld.persistCurrentNobleProfile());
  assert.deepEqual(nextWorld.getCurrentNobleProfile(), chosen,
    'unavailable browser storage must not prevent using the current heraldry');
} finally {
  if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
  else Reflect.deleteProperty(globalThis, 'window');
}

console.log('All ten cloth colors render and persist in all four heraldry roles; presets use the current palette.');
