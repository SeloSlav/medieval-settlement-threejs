/** Evaluate a server counter at the shared service clock (holy days excluded). */
export function householdCounterAt(base: number, baseTick: bigint, rate: number, tick: bigint): number {
  const elapsed = tick > baseTick ? tick - baseTick : 0n;
  const delta = elapsed * BigInt(rate);
  const value = BigInt(base) + delta;
  return Number(value < 0n ? 0n : value > 0xffff_ffffn ? 0xffff_ffffn : value);
}
