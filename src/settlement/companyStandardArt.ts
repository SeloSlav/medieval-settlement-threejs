import {
  DEFAULT_NOBLE_PROFILE,
  HERALDRY_CHARGES,
  HERALDRY_PATTERNS,
  chargeAssetUrl,
  getCurrentNobleProfile,
  type Heraldry,
  type HeraldryCharge,
  type HeraldryPattern,
  type NobleId,
  type NobleProfile,
} from '../ui/nobleProfile.ts';

/**
 * Art-direction data for the player's two-piece company standard.
 *
 * This module deliberately owns no mesh, material or simulation state. The same
 * immutable descriptor can therefore drive the full-quality cloth renderer,
 * minimap heraldry, screenshots and tests without allowing those consumers to
 * quietly invent different colors or emblems.
 */

export const COMPANY_STANDARD_ART_VERSION = 1;
export const LORD_BANNER_ASPECT_RATIO = 1.46;
export const CROATIAN_BANNER_ASPECT_RATIO = 1.62;
export const CROATIAN_CHECKER_COLUMNS = 10;
export const CROATIAN_CHECKER_ROWS = 6;
export const OTTOMAN_FIELD_STANDARD_ASPECT_RATIO = 1.68;
export const MERCENARY_FIELD_STANDARD_ASPECT_RATIO = 1.42;

export const CROATIAN_CHECKER_COLORS = Object.freeze({
  red: '#9f2925',
  white: '#e7dfca',
} as const);

export const COMPANY_STANDARD_TRIM_COLOR = '#c5a45d';

export const OTTOMAN_FIELD_STANDARD_COLORS = Object.freeze({
  crimson: '#8f241e',
  saffron: '#c49a36',
  green: '#31553a',
  gold: '#c7a753',
} as const);

export const MERCENARY_FIELD_STANDARD_COLORS = Object.freeze({
  riverGreen: '#315744',
  marshGreen: '#78915b',
  muddyGold: '#c39a43',
  frogCream: '#e2d5a5',
} as const);

export type CompanyStandardChargePlacement = Readonly<{
  /** Horizontal center in normalized banner UV space. */
  u: number;
  /** Vertical center in normalized banner UV space. */
  v: number;
  /** Width and height relative to the shorter banner dimension. */
  scale: number;
}>;

export type LordHeraldryBannerArt = Readonly<{
  panel: 'lord-heraldry';
  aspectRatio: number;
  fieldColor: string;
  patternColor: string;
  pattern: HeraldryPattern;
  patternCode: number;
  patternTiling: number;
  patternAngleDegrees: number;
  charge: HeraldryCharge;
  chargeColor: string;
  chargeMaskUrl: string;
  chargePlacements: readonly CompanyStandardChargePlacement[];
  trimColor: string;
}>;

export type CroatianCheckerboardBannerArt = Readonly<{
  panel: 'croatian-checkerboard';
  aspectRatio: number;
  columns: number;
  rows: number;
  firstCell: 'red';
  red: string;
  white: string;
  trimColor: string;
}>;

export type PlayerCompanyStandardArt = Readonly<{
  version: typeof COMPANY_STANDARD_ART_VERSION;
  faction: 'player';
  source: 'current-lord-heraldry';
  nobleId: NobleId;
  lordName: string;
  upper: LordHeraldryBannerArt;
  lower: CroatianCheckerboardBannerArt;
  /** Stable identity for texture/material caching and live heraldry refreshes. */
  cacheKey: string;
}>;

export type OttomanStandardEmblemStroke = Readonly<{
  points: readonly (readonly [number, number])[];
  widthUv: number;
}>;

export type OttomanFieldStandardPanelArt = Readonly<{
  panel: 'ottoman-field-standard';
  aspectRatio: number;
  flyProfile: 'single-pointed';
  taperStartsAtU: number;
  bands: readonly [
    Readonly<{ id: 'crimson'; startV: 0; endV: number; color: string }>,
    Readonly<{ id: 'saffron'; startV: number; endV: number; color: string }>,
    Readonly<{ id: 'green'; startV: number; endV: 1; color: string }>,
  ];
  trimColor: string;
  trimWidthUv: number;
  emblem: Readonly<{
    kind: 'forked-blade-and-knot-flourish';
    inspiration: 'dhu-l-fiqar-and-tughra-ornament';
    color: string;
    /** The ornament is deliberately geometric, never fabricated Arabic script. */
    usesTextOrCalligraphy: false;
    strokes: readonly OttomanStandardEmblemStroke[];
  }>;
}>;

export type OttomanCompanyStandardArt = Readonly<{
  version: typeof COMPANY_STANDARD_ART_VERSION;
  faction: 'ottoman';
  source: 'mid-sixteenth-century-field-standard';
  /** Guards against accidentally replacing this with the modern Turkish flag. */
  explicitlyNotModernNationalFlag: true;
  panel: OttomanFieldStandardPanelArt;
  cacheKey: string;
}>;

export type MercenaryCompanyStandardArt = Readonly<{
  version: typeof COMPANY_STANDARD_ART_VERSION;
  faction: 'mercenary';
  source: 'kupa-border-company-field-sign';
  panel: Readonly<{
    panel: 'mercenary-frog-standard';
    aspectRatio: number;
    flyProfile: 'swallowtail';
    fieldColor: string;
    bendColor: string;
    trimColor: string;
    emblem: 'croaking-frog';
    emblemColor: string;
  }>;
  cacheKey: string;
}>;

export type CompanyStandardArt = PlayerCompanyStandardArt
  | MercenaryCompanyStandardArt
  | OttomanCompanyStandardArt;

export type OttomanFieldStandardSample = Readonly<{
  insideCloth: boolean;
  region: 'void' | 'crimson' | 'saffron' | 'green' | 'gold-trim' | 'gold-emblem';
  color: string | null;
}>;

export const HERALDRY_PATTERN_CODES = Object.freeze({
  solid: 0,
  'per-pale': 1,
  'per-fess': 2,
  bend: 3,
  'bend-sinister': 4,
  quarterly: 5,
  checky: 6,
  stripes: 7,
  chevron: 8,
  saltire: 9,
  cross: 10,
  lozengy: 11,
} as const satisfies Record<HeraldryPattern, number>);

/** Resolves the normalized profile persisted by character creation. */
export function getCurrentPlayerCompanyStandardArt(): PlayerCompanyStandardArt {
  return resolvePlayerCompanyStandardArt(getCurrentNobleProfile());
}

/** Shared faction entry point for the standard renderer and visual playtests. */
export function resolveCompanyStandardArt(
  faction: 'player' | 'mercenary' | 'ottoman',
  profile?: NobleProfile,
): CompanyStandardArt {
  if (faction === 'player') {
    return resolvePlayerCompanyStandardArt(profile ?? getCurrentNobleProfile());
  }
  return faction === 'mercenary'
    ? resolveMercenaryCompanyStandardArt()
    : resolveOttomanCompanyStandardArt();
}

/**
 * Resolves an explicit profile for previews and deterministic playtests.
 * Runtime renderers should normally use getCurrentPlayerCompanyStandardArt().
 */
export function resolvePlayerCompanyStandardArt(
  profile: NobleProfile = getCurrentNobleProfile(),
): PlayerCompanyStandardArt {
  const normalized = normalizeStandardProfile(profile);
  const heraldry = normalized.heraldry;
  const upper: LordHeraldryBannerArt = Object.freeze({
    panel: 'lord-heraldry',
    aspectRatio: LORD_BANNER_ASPECT_RATIO,
    fieldColor: heraldry.fieldColor,
    patternColor: heraldry.patternColor,
    pattern: heraldry.pattern,
    patternCode: HERALDRY_PATTERN_CODES[heraldry.pattern],
    patternTiling: heraldry.patternTiling,
    patternAngleDegrees: heraldry.patternAngle,
    charge: heraldry.charge,
    chargeColor: heraldry.chargeColor,
    chargeMaskUrl: chargeAssetUrl(heraldry.charge),
    chargePlacements: chargePlacements(heraldry.chargeCount, heraldry.chargeScale),
    trimColor: COMPANY_STANDARD_TRIM_COLOR,
  });
  const lower: CroatianCheckerboardBannerArt = Object.freeze({
    panel: 'croatian-checkerboard',
    aspectRatio: CROATIAN_BANNER_ASPECT_RATIO,
    columns: CROATIAN_CHECKER_COLUMNS,
    rows: CROATIAN_CHECKER_ROWS,
    firstCell: 'red',
    red: CROATIAN_CHECKER_COLORS.red,
    white: CROATIAN_CHECKER_COLORS.white,
    trimColor: COMPANY_STANDARD_TRIM_COLOR,
  });

  return Object.freeze({
    version: COMPANY_STANDARD_ART_VERSION,
    faction: 'player',
    source: 'current-lord-heraldry',
    nobleId: normalized.nobleId,
    lordName: normalized.displayName,
    upper,
    lower,
    cacheKey: standardArtCacheKey(normalized),
  });
}

/**
 * Resolves a restrained mid-sixteenth-century Ottoman field standard.
 * It uses period military-standard cues rather than the later modern national
 * crescent-and-star layout; the central forked-blade ornament contains no text.
 */
export function resolveOttomanCompanyStandardArt(): OttomanCompanyStandardArt {
  const strokes = freezeOttomanEmblemStrokes([
    // Dhu'l-Fiqar-inspired blade, fork and guard.
    { points: [[0.2, 0.52], [0.72, 0.52], [0.87, 0.4]], widthUv: 0.026 },
    { points: [[0.72, 0.52], [0.87, 0.64]], widthUv: 0.026 },
    { points: [[0.23, 0.41], [0.23, 0.63]], widthUv: 0.025 },
    { points: [[0.16, 0.46], [0.23, 0.52], [0.16, 0.58]], widthUv: 0.021 },
    // Abstract knot-and-stem flourishes inspired by the rhythm of a tughra,
    // without copying or fabricating Arabic words.
    { points: [[0.33, 0.47], [0.31, 0.3], [0.36, 0.2], [0.4, 0.31], [0.39, 0.47]], widthUv: 0.015 },
    { points: [[0.43, 0.47], [0.43, 0.24], [0.47, 0.17], [0.5, 0.27], [0.49, 0.47]], widthUv: 0.014 },
    { points: [[0.32, 0.66], [0.4, 0.74], [0.48, 0.67], [0.56, 0.73], [0.64, 0.65]], widthUv: 0.015 },
  ]);
  const panel: OttomanFieldStandardPanelArt = Object.freeze({
    panel: 'ottoman-field-standard',
    aspectRatio: OTTOMAN_FIELD_STANDARD_ASPECT_RATIO,
    flyProfile: 'single-pointed',
    taperStartsAtU: 0.76,
    bands: Object.freeze([
      Object.freeze({ id: 'crimson', startV: 0, endV: 0.43, color: OTTOMAN_FIELD_STANDARD_COLORS.crimson }),
      Object.freeze({ id: 'saffron', startV: 0.43, endV: 0.53, color: OTTOMAN_FIELD_STANDARD_COLORS.saffron }),
      Object.freeze({ id: 'green', startV: 0.53, endV: 1, color: OTTOMAN_FIELD_STANDARD_COLORS.green }),
    ] as const),
    trimColor: OTTOMAN_FIELD_STANDARD_COLORS.gold,
    trimWidthUv: 0.022,
    emblem: Object.freeze({
      kind: 'forked-blade-and-knot-flourish',
      inspiration: 'dhu-l-fiqar-and-tughra-ornament',
      color: OTTOMAN_FIELD_STANDARD_COLORS.gold,
      usesTextOrCalligraphy: false,
      strokes,
    }),
  });
  const signature = [
    COMPANY_STANDARD_ART_VERSION,
    panel.aspectRatio,
    panel.flyProfile,
    panel.taperStartsAtU,
    ...panel.bands.flatMap((band) => [band.id, band.startV, band.endV, band.color]),
    panel.trimColor,
    panel.trimWidthUv,
    panel.emblem.kind,
    ...panel.emblem.strokes.flatMap((stroke) => [stroke.widthUv, ...stroke.points.flat()]),
  ].join('|');
  return Object.freeze({
    version: COMPANY_STANDARD_ART_VERSION,
    faction: 'ottoman',
    source: 'mid-sixteenth-century-field-standard',
    explicitlyNotModernNationalFlag: true,
    panel,
    cacheKey: `ottoman-field-standard-v${COMPANY_STANDARD_ART_VERSION}-${fnv1a(signature)}`,
  });
}

/** A deliberately boastful hired-company sign, separate from the lord's arms. */
export function resolveMercenaryCompanyStandardArt(): MercenaryCompanyStandardArt {
  const panel = Object.freeze({
    panel: 'mercenary-frog-standard' as const,
    aspectRatio: MERCENARY_FIELD_STANDARD_ASPECT_RATIO,
    flyProfile: 'swallowtail' as const,
    fieldColor: MERCENARY_FIELD_STANDARD_COLORS.riverGreen,
    bendColor: MERCENARY_FIELD_STANDARD_COLORS.marshGreen,
    trimColor: MERCENARY_FIELD_STANDARD_COLORS.muddyGold,
    emblem: 'croaking-frog' as const,
    emblemColor: MERCENARY_FIELD_STANDARD_COLORS.frogCream,
  });
  const signature = Object.values(panel).join('|');
  return Object.freeze({
    version: COMPANY_STANDARD_ART_VERSION,
    faction: 'mercenary',
    source: 'kupa-border-company-field-sign',
    panel,
    cacheKey: `mercenary-field-standard-v${COMPANY_STANDARD_ART_VERSION}-${fnv1a(signature)}`,
  });
}

/**
 * Returns one when the heraldry's secondary tincture covers this UV and zero
 * when the primary field shows. The sampler is useful for generated textures,
 * vertex-shader cloth motion and deterministic diagnostics.
 */
export function sampleHeraldryPattern(
  banner: LordHeraldryBannerArt,
  u: number,
  v: number,
): 0 | 1 {
  if (banner.pattern === 'solid') return 0;
  const [x, y] = rotateUv(clampUnit(u), clampUnit(v), banner.patternAngleDegrees);
  const tiling = Math.max(1, banner.patternTiling);

  switch (banner.pattern) {
    case 'per-pale': return x >= 0.5 ? 1 : 0;
    case 'per-fess': return y >= 0.5 ? 1 : 0;
    case 'bend': return Math.abs((x + y) - 1) <= 0.16 ? 1 : 0;
    case 'bend-sinister': return Math.abs(x - y) <= 0.16 ? 1 : 0;
    case 'quarterly': return (x >= 0.5) === (y >= 0.5) ? 0 : 1;
    case 'checky': {
      const cells = tiling * 2;
      return ((Math.floor(wrapUnit(x) * cells) + Math.floor(wrapUnit(y) * cells)) & 1) === 0 ? 1 : 0;
    }
    case 'stripes': return (Math.floor(wrapUnit(x) * tiling * 2) & 1) === 1 ? 1 : 0;
    case 'chevron': {
      const ridge = 0.69 - Math.abs(x - 0.5) * 0.88;
      return Math.abs(y - ridge) <= 0.075 ? 1 : 0;
    }
    case 'saltire': return Math.abs(x - y) <= 0.075 || Math.abs((x + y) - 1) <= 0.075 ? 1 : 0;
    case 'cross': return Math.abs(x - 0.5) <= 0.08 || Math.abs(y - 0.5) <= 0.08 ? 1 : 0;
    case 'lozengy': {
      const diamondX = Math.abs(fract(x * tiling) - 0.5);
      const diamondY = Math.abs(fract(y * tiling) - 0.5);
      return diamondX + diamondY <= 0.5 ? 1 : 0;
    }
  }
}

/** Returns the historically legible red/white cell at a lower-banner UV. */
export function sampleCroatianCheckerboard(
  banner: CroatianCheckerboardBannerArt,
  u: number,
  v: number,
): 'red' | 'white' {
  const column = Math.min(banner.columns - 1, Math.floor(clampUnit(u) * banner.columns));
  const row = Math.min(banner.rows - 1, Math.floor(clampUnit(v) * banner.rows));
  return ((column + row) & 1) === 0 ? banner.firstCell : 'white';
}

/**
 * Deterministic CPU reference for generated maps and shader validation. The
 * pointed fly is part of the art contract, so transparent corner samples are
 * returned outside its tapered silhouette.
 */
export function sampleOttomanFieldStandard(
  banner: OttomanFieldStandardPanelArt,
  u: number,
  v: number,
): OttomanFieldStandardSample {
  const x = clampUnit(u);
  const y = clampUnit(v);
  const taperProgress = x <= banner.taperStartsAtU
    ? 0
    : (x - banner.taperStartsAtU) / (1 - banner.taperStartsAtU);
  const halfHeight = 0.5 * (1 - taperProgress);
  const distanceFromCenter = Math.abs(y - 0.5);
  if (distanceFromCenter > halfHeight + 1e-6) {
    return Object.freeze({ insideCloth: false, region: 'void', color: null });
  }

  const edgeDistance = x <= banner.taperStartsAtU
    ? Math.min(x, y, 1 - y)
    : Math.min(x, Math.max(0, halfHeight - distanceFromCenter));
  if (edgeDistance <= banner.trimWidthUv) {
    return Object.freeze({ insideCloth: true, region: 'gold-trim', color: banner.trimColor });
  }

  for (const stroke of banner.emblem.strokes) {
    for (let index = 1; index < stroke.points.length; index += 1) {
      if (distanceToSegment(x, y, stroke.points[index - 1], stroke.points[index]) <= stroke.widthUv * 0.5) {
        return Object.freeze({ insideCloth: true, region: 'gold-emblem', color: banner.emblem.color });
      }
    }
  }

  const band = banner.bands.find((entry) => y >= entry.startV && y <= entry.endV)
    ?? banner.bands[banner.bands.length - 1];
  return Object.freeze({ insideCloth: true, region: band.id, color: band.color });
}

/** FNV-1a keeps cache keys compact without relying on browser-only crypto APIs. */
function standardArtCacheKey(profile: NobleProfile): string {
  const heraldry = profile.heraldry;
  const source = [
    COMPANY_STANDARD_ART_VERSION,
    profile.nobleId,
    profile.displayName,
    heraldry.pattern,
    heraldry.fieldColor,
    heraldry.patternColor,
    heraldry.patternTiling,
    heraldry.patternAngle,
    heraldry.charge,
    heraldry.chargeColor,
    heraldry.chargeCount,
    heraldry.chargeScale,
  ].join('|');
  return `player-standard-v${COMPANY_STANDARD_ART_VERSION}-${fnv1a(source)}`;
}

function freezeOttomanEmblemStrokes(
  strokes: readonly { points: readonly (readonly [number, number])[]; widthUv: number }[],
): readonly OttomanStandardEmblemStroke[] {
  return Object.freeze(strokes.map((stroke) => Object.freeze({
    widthUv: stroke.widthUv,
    points: Object.freeze(stroke.points.map(([u, v]) => Object.freeze([u, v] as const))),
  })));
}

function distanceToSegment(
  x: number,
  y: number,
  start: readonly [number, number],
  end: readonly [number, number],
): number {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared > 0
    ? clamp(((x - start[0]) * dx + (y - start[1]) * dy) / lengthSquared, 0, 1)
    : 0;
  return Math.hypot(x - (start[0] + dx * t), y - (start[1] + dy * t));
}

function fnv1a(source: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function chargePlacements(count: number, scale: number): readonly CompanyStandardChargePlacement[] {
  const normalizedCount = Math.round(clamp(count, 1, 5));
  const multiScale = normalizedCount === 1 ? scale : scale * 0.68;
  const positions: readonly (readonly [number, number])[] = normalizedCount === 1
    ? [[0.5, 0.5]]
    : normalizedCount === 2
      ? [[0.31, 0.5], [0.69, 0.5]]
      : normalizedCount === 3
        ? [[0.5, 0.29], [0.31, 0.66], [0.69, 0.66]]
        : normalizedCount === 4
          ? [[0.31, 0.3], [0.69, 0.3], [0.31, 0.69], [0.69, 0.69]]
          : [[0.31, 0.3], [0.69, 0.3], [0.31, 0.69], [0.69, 0.69], [0.5, 0.5]];
  return Object.freeze(positions.map(([u, v]) => Object.freeze({ u, v, scale: multiScale })));
}

function normalizeStandardProfile(profile: NobleProfile): NobleProfile {
  const fallback = DEFAULT_NOBLE_PROFILE;
  const heraldry = profile?.heraldry;
  const pattern = HERALDRY_PATTERNS.some((entry) => entry.id === heraldry?.pattern)
    ? heraldry.pattern
    : fallback.heraldry.pattern;
  const charge = HERALDRY_CHARGES.some((entry) => entry.id === heraldry?.charge)
    ? heraldry.charge
    : fallback.heraldry.charge;
  return {
    nobleId: profile?.nobleId ?? fallback.nobleId,
    displayName: typeof profile?.displayName === 'string'
      ? profile.displayName.trim().slice(0, 42) || fallback.displayName
      : fallback.displayName,
    heraldry: {
      pattern,
      fieldColor: validHexColor(heraldry?.fieldColor, fallback.heraldry.fieldColor),
      patternColor: validHexColor(heraldry?.patternColor, fallback.heraldry.patternColor),
      patternTiling: clamp(heraldry?.patternTiling, 1, 6, fallback.heraldry.patternTiling),
      patternAngle: clamp(heraldry?.patternAngle, -45, 45, fallback.heraldry.patternAngle),
      charge,
      chargeColor: validHexColor(heraldry?.chargeColor, fallback.heraldry.chargeColor),
      chargeCount: Math.round(clamp(heraldry?.chargeCount, 1, 5, fallback.heraldry.chargeCount)),
      chargeScale: clamp(heraldry?.chargeScale, 0.24, 0.84, fallback.heraldry.chargeScale),
    },
  };
}

function validHexColor(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

function rotateUv(u: number, v: number, angleDegrees: number): readonly [number, number] {
  const radians = angleDegrees * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const x = u - 0.5;
  const y = v - 0.5;
  return [x * cosine - y * sine + 0.5, x * sine + y * cosine + 0.5];
}

function wrapUnit(value: number): number {
  return fract(value + 1024);
}

function fract(value: number): number {
  return value - Math.floor(value);
}

function clampUnit(value: number): number {
  return clamp(value, 0, 1);
}

function clamp(value: unknown, min: number, max: number, fallback = min): number {
  const number = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, number));
}

export type { Heraldry };
