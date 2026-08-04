export const NOBLE_PROFILE_STORAGE_KEY = 'selo-empire:noble-profile:v1';

export const NOBLES = [
  {
    id: 'nikola-zrinski',
    name: 'Nikola IV. Zrinski',
    title: 'hrvatski ban i krajiški zapovjednik',
    years: '1508. – 1566.',
    portrait: '/assets/ui/noble-setup/portraits/nikola-zrinski.webp',
  },
  {
    id: 'katarina-frankapan',
    name: 'Katarina Frankapan',
    title: 'kneginja iz ozaljske loze Frankapana',
    years: '† 1561.',
    portrait: '/assets/ui/noble-setup/portraits/katarina-frankapan.webp',
  },
  {
    id: 'stjepan-frankapan',
    name: 'Stjepan IV. Frankapan',
    title: 'knez Ozlja, Ribnika i Novigrada',
    years: '† 1577.',
    portrait: '/assets/ui/noble-setup/portraits/stjepan-frankapan.webp',
  },
  {
    id: 'franjo-frankapan',
    name: 'Franjo I. Frankapan',
    title: 'mladi knez slunjske loze',
    years: '1536. – 1572.',
    portrait: '/assets/ui/noble-setup/portraits/franjo-frankapan.webp',
  },
  {
    id: 'petar-erdody',
    name: 'Petar II. Erdődy',
    title: 'velikaš jastrebarskih posjeda',
    years: 'oko 1504. – 1567.',
    portrait: '/assets/ui/noble-setup/portraits/petar-erdody.webp',
  },
  {
    id: 'petar-keglevic',
    name: 'Petar Keglević',
    title: 'bivši ban i knez Bužimski',
    years: 'oko 1500. – 1554./55.',
    portrait: '/assets/ui/noble-setup/portraits/petar-keglevic.webp',
  },
  {
    id: 'ivan-lenkovic',
    name: 'Ivan Lenković',
    title: 'senjski kapetan i zapovjednik uskoka',
    years: '† 1569.',
    portrait: '/assets/ui/noble-setup/portraits/ivan-lenkovic.webp',
  },
  {
    id: 'juraj-draskovic',
    name: 'Juraj II. Drašković',
    title: 'plemić, kanonik i kraljevski učenjak',
    years: '1525. – 1587.',
    portrait: '/assets/ui/noble-setup/portraits/juraj-draskovic.webp',
  },
  {
    id: 'gaspar-alapic',
    name: 'Gašpar Alapić',
    title: 'plemić i krajiški vojnik',
    years: 'oko 1520. – 1584.',
    portrait: '/assets/ui/noble-setup/portraits/gaspar-alapic.webp',
  },
  {
    id: 'franjo-tahi',
    name: 'Franjo Tahi',
    title: 'plemić i konjanički časnik',
    years: '1526. – 1573.',
    portrait: '/assets/ui/noble-setup/portraits/franjo-tahi.webp',
  },
  {
    id: 'nikola-jurisic',
    name: 'Nikola Jurišić',
    title: 'junak Kisega — naslijeđe granice',
    years: '1490. – 1545.',
    portrait: '/assets/ui/noble-setup/portraits/nikola-jurisic.webp',
  },
  {
    id: 'jelena-zrinska',
    name: 'Jelena Zrinska',
    title: 'plemkinja roda Zrinskih',
    years: 'prva polovina XVI. st.',
    portrait: '/assets/ui/noble-setup/portraits/jelena-zrinska.webp',
  },
] as const;

export type NobleId = (typeof NOBLES)[number]['id'];

export const HERALDRY_TINCTURES = [
  { id: 'gules', name: 'Crvena', value: '#8d3027' },
  { id: 'azure', name: 'Modra', value: '#2e5266' },
  { id: 'vert', name: 'Zelena', value: '#43593b' },
  { id: 'sable', name: 'Crna', value: '#25251f' },
  { id: 'purpure', name: 'Grimizna', value: '#66445b' },
  { id: 'argent', name: 'Srebrna', value: '#d8d1bb' },
  { id: 'or', name: 'Zlatna', value: '#c59b48' },
] as const;

export const HERALDRY_PATTERNS = [
  { id: 'solid', name: 'Jednobojno' },
  { id: 'per-pale', name: 'Raspolovljeno' },
  { id: 'per-fess', name: 'Poprečno' },
  { id: 'bend', name: 'Kosa greda' },
  { id: 'bend-sinister', name: 'Lijeva kosa' },
  { id: 'quarterly', name: 'Četvoreno' },
  { id: 'checky', name: 'Šahirano' },
  { id: 'stripes', name: 'Pruge' },
  { id: 'chevron', name: 'Rog' },
  { id: 'saltire', name: 'Kosi križ' },
  { id: 'cross', name: 'Križ' },
  { id: 'lozengy', name: 'Rombovi' },
] as const;

export type HeraldryPattern = (typeof HERALDRY_PATTERNS)[number]['id'];

export const HERALDRY_CHARGES = [
  { id: 'lion', name: 'Lav' },
  { id: 'eagle', name: 'Orao' },
  { id: 'wolf', name: 'Vuk' },
  { id: 'bear', name: 'Medvjed' },
  { id: 'stag', name: 'Jelen' },
  { id: 'boar', name: 'Vepar' },
  { id: 'falcon', name: 'Sokol' },
  { id: 'raven', name: 'Gavran' },
  { id: 'tower', name: 'Kula' },
  { id: 'key', name: 'Ključ' },
  { id: 'sword', name: 'Mač' },
  { id: 'axes', name: 'Sjekire' },
  { id: 'star', name: 'Zvijezda' },
  { id: 'crescent', name: 'Mjesec' },
  { id: 'fleur-de-lis', name: 'Ljiljan' },
  { id: 'oak-branch', name: 'Hrastova grana' },
] as const;

export type HeraldryCharge = (typeof HERALDRY_CHARGES)[number]['id'];

export type Heraldry = {
  pattern: HeraldryPattern;
  fieldColor: string;
  patternColor: string;
  patternTiling: number;
  patternAngle: number;
  charge: HeraldryCharge;
  chargeColor: string;
  chargeCount: number;
  chargeScale: number;
};

export type NobleProfile = {
  nobleId: NobleId;
  displayName: string;
  heraldry: Heraldry;
};

export const HERALDRY_PRESETS: readonly Heraldry[] = [
  { pattern: 'checky', fieldColor: '#d8d1bb', patternColor: '#8d3027', patternTiling: 4, patternAngle: 0, charge: 'falcon', chargeColor: '#c59b48', chargeCount: 1, chargeScale: 0.63 },
  { pattern: 'per-pale', fieldColor: '#25251f', patternColor: '#c59b48', patternTiling: 1, patternAngle: 0, charge: 'lion', chargeColor: '#d8d1bb', chargeCount: 1, chargeScale: 0.68 },
  { pattern: 'bend', fieldColor: '#8d3027', patternColor: '#d8d1bb', patternTiling: 1, patternAngle: -5, charge: 'wolf', chargeColor: '#25251f', chargeCount: 1, chargeScale: 0.64 },
  { pattern: 'quarterly', fieldColor: '#2e5266', patternColor: '#d8d1bb', patternTiling: 1, patternAngle: 0, charge: 'tower', chargeColor: '#c59b48', chargeCount: 1, chargeScale: 0.61 },
  { pattern: 'per-fess', fieldColor: '#43593b', patternColor: '#c59b48', patternTiling: 1, patternAngle: 0, charge: 'stag', chargeColor: '#d8d1bb', chargeCount: 1, chargeScale: 0.67 },
  { pattern: 'saltire', fieldColor: '#66445b', patternColor: '#d8d1bb', patternTiling: 1, patternAngle: 0, charge: 'star', chargeColor: '#c59b48', chargeCount: 1, chargeScale: 0.5 },
  { pattern: 'stripes', fieldColor: '#25251f', patternColor: '#8d3027', patternTiling: 4, patternAngle: 0, charge: 'eagle', chargeColor: '#d8d1bb', chargeCount: 1, chargeScale: 0.72 },
  { pattern: 'solid', fieldColor: '#2e5266', patternColor: '#2e5266', patternTiling: 1, patternAngle: 0, charge: 'crescent', chargeColor: '#d8d1bb', chargeCount: 3, chargeScale: 0.34 },
  { pattern: 'lozengy', fieldColor: '#d8d1bb', patternColor: '#43593b', patternTiling: 3, patternAngle: 0, charge: 'bear', chargeColor: '#25251f', chargeCount: 1, chargeScale: 0.66 },
  { pattern: 'cross', fieldColor: '#8d3027', patternColor: '#d8d1bb', patternTiling: 1, patternAngle: 0, charge: 'key', chargeColor: '#c59b48', chargeCount: 2, chargeScale: 0.38 },
  { pattern: 'chevron', fieldColor: '#25251f', patternColor: '#c59b48', patternTiling: 1, patternAngle: 0, charge: 'boar', chargeColor: '#d8d1bb', chargeCount: 1, chargeScale: 0.59 },
  { pattern: 'bend-sinister', fieldColor: '#43593b', patternColor: '#d8d1bb', patternTiling: 1, patternAngle: 6, charge: 'axes', chargeColor: '#c59b48', chargeCount: 1, chargeScale: 0.6 },
  { pattern: 'per-pale', fieldColor: '#66445b', patternColor: '#25251f', patternTiling: 1, patternAngle: 0, charge: 'fleur-de-lis', chargeColor: '#d8d1bb', chargeCount: 3, chargeScale: 0.33 },
  { pattern: 'checky', fieldColor: '#2e5266', patternColor: '#d8d1bb', patternTiling: 3, patternAngle: 0, charge: 'sword', chargeColor: '#c59b48', chargeCount: 1, chargeScale: 0.65 },
  { pattern: 'solid', fieldColor: '#8d3027', patternColor: '#8d3027', patternTiling: 1, patternAngle: 0, charge: 'oak-branch', chargeColor: '#d8d1bb', chargeCount: 1, chargeScale: 0.62 },
];

export const DEFAULT_NOBLE_PROFILE: NobleProfile = {
  nobleId: 'nikola-zrinski',
  displayName: 'Nikola IV. Zrinski',
  heraldry: { ...HERALDRY_PRESETS[0] },
};

let currentProfile: NobleProfile = loadStoredNobleProfile() ?? cloneProfile(DEFAULT_NOBLE_PROFILE);

export function getNoble(id: NobleId) {
  return NOBLES.find((noble) => noble.id === id) ?? NOBLES[0];
}

export function getCurrentNobleProfile(): NobleProfile {
  return cloneProfile(currentProfile);
}

export function setCurrentNobleProfile(profile: NobleProfile): void {
  currentProfile = normalizeProfile(profile);
  try {
    window.localStorage.setItem(NOBLE_PROFILE_STORAGE_KEY, JSON.stringify(currentProfile));
  } catch {
    // The current page retains the profile even when storage is unavailable.
  }
}

export function chargeAssetUrl(charge: HeraldryCharge): string {
  return `/assets/ui/noble-setup/charges/${charge}.png`;
}

export function createHeraldryShield(className = ''): HTMLElement {
  const shield = document.createElement('span');
  shield.className = `heraldry-shield ${className}`.trim();
  shield.setAttribute('aria-hidden', 'true');
  shield.innerHTML = `
    <span class="heraldry-shield__rim">
      <span class="heraldry-shield__field">
        <span class="heraldry-shield__pattern"></span>
        <span class="heraldry-shield__charges">
          ${Array.from({ length: 5 }, () => '<i></i>').join('')}
        </span>
      </span>
    </span>
  `;
  return shield;
}

export function applyHeraldryToElement(element: HTMLElement, heraldry: Heraldry): void {
  const normalized = normalizeHeraldry(heraldry);
  element.dataset.pattern = normalized.pattern;
  element.dataset.chargeCount = String(normalized.chargeCount);
  element.style.setProperty('--field-a', normalized.fieldColor);
  element.style.setProperty('--field-b', normalized.patternColor);
  element.style.setProperty('--pattern-size', `${Math.max(12, 58 / normalized.patternTiling)}px`);
  element.style.setProperty('--pattern-angle', `${normalized.patternAngle}deg`);
  element.style.setProperty('--charge-color', normalized.chargeColor);
  element.style.setProperty('--charge-scale', String(normalized.chargeScale));
  element.style.setProperty('--charge-mask', `url("${chargeAssetUrl(normalized.charge)}")`);
}

function loadStoredNobleProfile(): NobleProfile | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(NOBLE_PROFILE_STORAGE_KEY);
    return raw ? normalizeProfile(JSON.parse(raw) as NobleProfile) : null;
  } catch {
    return null;
  }
}

function normalizeProfile(profile: NobleProfile): NobleProfile {
  const nobleId = NOBLES.some((noble) => noble.id === profile?.nobleId)
    ? profile.nobleId
    : DEFAULT_NOBLE_PROFILE.nobleId;
  const fallbackName = getNoble(nobleId).name;
  return {
    nobleId,
    displayName: typeof profile?.displayName === 'string'
      ? profile.displayName.trim().slice(0, 42) || fallbackName
      : fallbackName,
    heraldry: normalizeHeraldry(profile?.heraldry),
  };
}

function normalizeHeraldry(heraldry?: Heraldry): Heraldry {
  const fallback = DEFAULT_NOBLE_PROFILE.heraldry;
  const pattern = HERALDRY_PATTERNS.some((entry) => entry.id === heraldry?.pattern)
    ? heraldry!.pattern
    : fallback.pattern;
  const charge = HERALDRY_CHARGES.some((entry) => entry.id === heraldry?.charge)
    ? heraldry!.charge
    : fallback.charge;
  return {
    pattern,
    charge,
    fieldColor: validColor(heraldry?.fieldColor, fallback.fieldColor),
    patternColor: validColor(heraldry?.patternColor, fallback.patternColor),
    chargeColor: validColor(heraldry?.chargeColor, fallback.chargeColor),
    patternTiling: clampNumber(heraldry?.patternTiling, 1, 6, fallback.patternTiling),
    patternAngle: clampNumber(heraldry?.patternAngle, -45, 45, fallback.patternAngle),
    chargeCount: Math.round(clampNumber(heraldry?.chargeCount, 1, 5, fallback.chargeCount)),
    chargeScale: clampNumber(heraldry?.chargeScale, 0.24, 0.84, fallback.chargeScale),
  };
}

function validColor(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const number = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, number));
}

function cloneProfile(profile: NobleProfile): NobleProfile {
  return { ...profile, heraldry: { ...profile.heraldry } };
}
