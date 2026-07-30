import { sampleAuthoritativeHydrologyScore } from '../hydrology/sampleAuthoritativeHydrology.ts';

export const CLAY_BANK_SCORE_FLOOR = 0.15;
export const CLAY_BANK_SCORE_CEILING = 0.53;
export const CLAY_BANK_SITE_YIELD_MIN = 0.85;
export const CLAY_BANK_SITE_YIELD_MAX = 1.25;
export const CLAY_BANK_REGIONAL_YIELD_MIN = 0.9;
export const CLAY_BANK_REGIONAL_YIELD_MAX = 1.1;
export const CLAY_BANK_TOTAL_YIELD_MIN = 0.75;
export const CLAY_BANK_TOTAL_YIELD_MAX = 1.38;
export const CLAY_BANK_STRATA_VISUAL_SEGMENTS = 4;
export const CLAY_BANK_LEAN_YIELD_THRESHOLD = 0.92;

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
): number {
  return Math.max(
    CLAY_BANK_TOTAL_YIELD_MIN,
    Math.min(
      CLAY_BANK_TOTAL_YIELD_MAX,
      clayBankSiteYieldMultiplier(hydrologyScore)
        * clayBankRegionalYieldMultiplier(resourceAbundance),
    ),
  );
}

export function clayBankYieldAt(
  x: number,
  z: number,
  resourceAbundance = 50,
): number {
  return clayBankYieldMultiplier(
    sampleAuthoritativeHydrologyScore(x, z),
    resourceAbundance,
  );
}

export function clayBankSiteYieldAt(x: number, z: number): number {
  return clayBankSiteYieldMultiplier(
    sampleAuthoritativeHydrologyScore(x, z),
  );
}

export function clayBankYieldGrade(multiplier: number): string {
  if (multiplier >= 1.15) return 'Rich clay seam';
  if (multiplier >= 1.02) return 'Good alluvial pocket';
  if (multiplier >= CLAY_BANK_LEAN_YIELD_THRESHOLD) return 'Workable clay bank';
  return 'Lean clay margin';
}

export function clayBankStrataVisualLevel(siteMultiplier: number): number {
  const normalized = clamp01(
    (finiteOr(siteMultiplier, CLAY_BANK_SITE_YIELD_MIN) - CLAY_BANK_SITE_YIELD_MIN)
      / (CLAY_BANK_SITE_YIELD_MAX - CLAY_BANK_SITE_YIELD_MIN),
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
