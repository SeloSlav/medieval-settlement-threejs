export type GameMode = 'single' | 'multiplayer';
let previousSearch: string | undefined;
let selectedMode: GameMode = 'single';
export function isMultiplayer(): boolean { return gameMode() === 'multiplayer'; }
export function gameMode(): GameMode {
  if (typeof window === 'undefined') return 'single';
  const search = window.location.search;
  if (search !== previousSearch) {
    previousSearch = search;
    selectedMode = new URLSearchParams(search).get('mode') === 'multiplayer' ? 'multiplayer' : 'single';
  }
  return selectedMode;
}
export function switchGameMode(mode: GameMode): void {
  const url = new URL(window.location.href);
  url.searchParams.delete('new');
  url.searchParams.set('mode', mode);
  window.location.assign(url.href);
}
