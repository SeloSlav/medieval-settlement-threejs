import { sampleAuthoritativeHydrologyScore } from '../hydrology/sampleAuthoritativeHydrology.ts';
import type { ClayDepositLayout } from '../clay/ClayDepositLayout.ts';

export const CLAY_BANK_SCORE_FLOOR = 0.15;
export const CLAY_BANK_SCORE_CEILING = 0.53;
export const CLAY_BANK_SITE_YIELD_MIN = 0.82;
export const CLAY_BANK_SITE_YIELD_MAX = 1.08;
export const CLAY_BANK_REGIONAL_YIELD_MIN = 0.95;
export const CLAY_BANK_REGIONAL_YIELD_MAX = 1.05;
export const CLAY_BANK_TOTAL_YIELD_MIN = 0.78;
export const CLAY_BANK_ORDINARY_YIELD_MAX = 1.14;
export const CLAY_BANK_RICH_YIELD_MIN = 1.28;
export const CLAY_BANK_TOTAL_YIELD_MAX = 1.42;
export const CLAY_BANK_STRATA_VISUAL_SEGMENTS = 4;
export const CLAY_BANK_LEAN_YIELD_THRESHOLD = 0.92;
export const CLAY_BANK_RICH_YIELD_THRESHOLD = 1.2;

let activeClayDepositLayout: ClayDepositLayout | null = null;

export function setActiveClayDepositLayout(layout: ClayDepositLayout | null): void {
  activeClayDepositLayout = layout;
}

/**
 * Local bank quality inferred from the same hydrology field used by the
 * authority. Narrow, drier margins stay workable while broader alluvial
 * pockets reward careful shoreline placement.
 */
export function clayBankSiteYieldMultiplier(hydrologyScore: number): number {
  const normalized = clamp01(
    (finiteOr(hydrologyScore, CLAY_BANK_SCORE_FLOOR) - CLAY_BANK_SCORE_FLOOR)
      / (CLAY_BANK_SCORE_CEILING - CLAY_BANK_SCORE_FLOOR),
  );
  return CLAY_BANK_SITE_YIELD_MIN
    + normalized * (CLAY_BANK_SITE_YIELD_MAX - CLAY_BANK_SITE_YIELD_MIN);
}

/**
 * World resource abundance modestly changes regional clay richness without
 * turning a lean shoreline into a hard placement failure.
 */
export function clayBankRegionalYieldMultiplier(resourceAbundance: number): number {
  const normalized = clamp01(finiteOr(resourceAbundance, 50) / 100);
  return CLAY_BANK_REGIONAL_YIELD_MIN
    + normalized * (
      CLAY_BANK_REGIONAL_YIELD_MAX - CLAY_BANK_REGIONAL_YIELD_MIN
    );
}

export function clayBankYieldMultiplier(
  hydrologyScore: number,
  resourceAbundance = 50,
  richDepositStrength = 0,
): number {
  const ordinaryYield = Math.max(
    CLAY_BANK_TOTAL_YIELD_MIN,
    Math.min(
      CLAY_BANK_ORDINARY_YIELD_MAX,
      clayBankSiteYieldMultiplier(hydrologyScore)
        * clayBankRegionalYieldMultiplier(resourceAbundance),
    ),
  );
  const richness = clamp01(finiteOr(richDepositStrength, 0));
  if (richness <= 0) return ordinaryYield;
  const richYield = Math.max(
    CLAY_BANK_RICH_YIELD_MIN,
    Math.min(CLAY_BANK_TOTAL_YIELD_MAX, ordinaryYield * 1.3),
  );
  return ordinaryYield + (richYield - ordinaryYield) * richness;
}

export function clayBankYieldAt(
  x: number,
  z: number,
  resourceAbundance = 50,
): number {
  return clayBankYieldMultiplier(
    sampleAuthoritativeHydrologyScore(x, z),
    resourceAbundance,
    activeClayDepositLayout?.richnessAt(x, z) ?? 0,
  );
}

export function clayBankSiteYieldAt(x: number, z: number): number {
  return clayBankYieldMultiplier(
    sampleAuthoritativeHydrologyScore(x, z),
    50,
    activeClayDepositLayout?.richnessAt(x, z) ?? 0,
  );
}

export function clayBankYieldGrade(multiplier: number): string {
  if (multiplier >= CLAY_BANK_RICH_YIELD_THRESHOLD) return 'Rich clay deposit';
  if (multiplier >= 1.02) return 'Good alluvial pocket';
  if (multiplier >= CLAY_BANK_LEAN_YIELD_THRESHOLD) return 'Workable clay bank';
  return 'Lean clay margin';
}

export function clayBankStrataVisualLevel(siteMultiplier: number): number {
  const normalized = clamp01(
    (finiteOr(siteMultiplier, CLAY_BANK_SITE_YIELD_MIN) - CLAY_BANK_SITE_YIELD_MIN)
      / (CLAY_BANK_TOTAL_YIELD_MAX - CLAY_BANK_SITE_YIELD_MIN),
  );
  return 1 + Math.min(
    CLAY_BANK_STRATA_VISUAL_SEGMENTS - 1,
    Math.floor(normalized * CLAY_BANK_STRATA_VISUAL_SEGMENTS),
  );
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
