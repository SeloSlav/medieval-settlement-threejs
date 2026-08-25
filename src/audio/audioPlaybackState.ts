let soundtrackActive = false;
let externalSoundtrackActive = false;

export function isSoundtrackActive(): boolean {
  return soundtrackActive || externalSoundtrackActive;
}

export function setSoundtrackActive(active: boolean): void {
  soundtrackActive = active;
}

export function setExternalSoundtrackActive(active: boolean): void {
  externalSoundtrackActive = active;
}
