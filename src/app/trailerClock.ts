/** Fixed presentation clock used only while exporting a development trailer take. */
export const trailerClock = {
  active: false,
  speed: 1 as 1 | 8,
  pending: false,
  timeMs: 0,
  onFrame: null as null | (() => void),
};
export function presentationNow(): number {
  return trailerClock.active ? trailerClock.timeMs : performance.now();
}
