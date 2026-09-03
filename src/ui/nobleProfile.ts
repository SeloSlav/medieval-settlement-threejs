export const NOBLE_PROFILE_STORAGE_KEY = 'selo-empire:noble-profile:v1';

export const NOBLES = [
  {
    id: 'nikola-zrinski',
    name: 'Nikola IV. Zrinski',
    title: 'Croatian ban and Military Frontier commander',
    years: '1508–1566',
    portrait: '/assets/ui/noble-setup/portraits/nikola-zrinski.webp',
  },
  {
    id: 'katarina-frankapan',
    name: 'Katarina Frankapan',
    title: 'noblewoman of the Frankapan branch of Ozalj',
    years: 'd. 1561',
    portrait: '/assets/ui/noble-setup/portraits/katarina-frankapan.webp',
  },
  {
    id: 'stjepan-frankapan',
    name: 'Stjepan IV. Frankapan',
    title: 'Lord of Ozalj, Ribnik, and Novigrad',
    years: 'd. 1577',
    portrait: '/assets/ui/noble-setup/portraits/stjepan-frankapan.webp',
  },
  {
    id: 'franjo-frankapan',
    name: 'Franjo I. Frankapan',
    title: 'young lord of the Frankapan branch of Slunj',
    years: '1536–1572',
    portrait: '/assets/ui/noble-setup/portraits/franjo-frankapan.webp',
  },
  {
    id: 'petar-erdody',
    name: 'Petar II. Erdődy',
    title: 'magnate of the estates around Jastrebarsko',
    years: 'c. 1504–1567',
    portrait: '/assets/ui/noble-setup/portraits/petar-erdody.webp',
  },
  {
    id: 'petar-keglevic',
    name: 'Petar Keglević',
    title: 'former ban and Lord of Bužim',
    years: 'c. 1500–1554/55',
    portrait: '/assets/ui/noble-setup/portraits/petar-keglevic.webp',
  },
  {
    id: 'ivan-lenkovic',
    name: 'Ivan Lenković',
    title: 'Captain of Senj and Uskok commander',
    years: 'd. 1569',
    portrait: '/assets/ui/noble-setup/portraits/ivan-lenkovic.webp',
  },
  {
    id: 'juraj-draskovic',
    name: 'Juraj II. Drašković',
    title: 'nobleman, canon, and royal scholar',
    years: '1525–1587',
    portrait: '/assets/ui/noble-setup/portraits/juraj-draskovic.webp',
  },
  {
    id: 'gaspar-alapic',
    name: 'Gašpar Alapić',
    title: 'nobleman and Military Frontier soldier',
    years: 'c. 1520–1584',
    portrait: '/assets/ui/noble-setup/portraits/gaspar-alapic.webp',
  },
  {
    id: 'franjo-tahi',
    name: 'Franjo Tahi',
    title: 'nobleman and cavalry officer',
    years: '1526–1573',
    portrait: '/assets/ui/noble-setup/portraits/franjo-tahi.webp',
  },
  {
    id: 'nikola-jurisic',
    name: 'Nikola Jurišić',
    title: 'hero of Kőszeg — a legacy of the frontier',
    years: '1490–1545 · legacy',
    portrait: '/assets/ui/noble-setup/portraits/nikola-jurisic.webp',
  },
  {
    id: 'vuk-frankapan',
    name: 'Vuk I. Frankapan',
    title: 'Lord of Bosiljevo, Ribnik, and Novigrad',
    years: 'before 1521–1546 · legacy',
    portrait: '/assets/ui/noble-setup/portraits/vuk-frankapan.webp',
  },
  {
    id: 'daniciceva-udovica',
    name: 'Daničićeva udovica',
    title: 'Senj Uskok expedition leader and organizer',
    years: 'fl. 1571',
    portrait: '/assets/ui/noble-setup/portraits/daniciceva-udovica.webp',
  },
  {
    id: 'filipa-lacea',
    name: 'Filipa Lacea',
    title: 'Pula-born Neo-Latin poet and Renaissance humanist',
    years: '1545/46–1576',
    portrait: '/assets/ui/noble-setup/portraits/filipa-lacea.webp',
  },
  {
    id: 'frane-petric',
    name: 'Frane Petrić',
    title: 'Cres-born philosopher, polymath, merchant, and sailor',
    years: '1529–1597',
    portrait: '/assets/ui/noble-setup/portraits/frane-petric.webp',
  },
  {
    id: 'matija-vlacic-ilirik',
    name: 'Matija Vlačić Ilirik',
    title: 'Labin-born Protestant theologian, historian, and philologist',
    years: '1520–1575',
    portrait: '/assets/ui/noble-setup/portraits/matija-vlacic-ilirik.webp',
  },
  {
    id: 'simun-kozicic-benja',
    name: 'Šimun Kožičić Benja',
    title: 'Modruš bishop and Glagolitic printer in Rijeka',
    years: 'c. 1460–1536',
    portrait: '/assets/ui/noble-setup/portraits/simun-kozicic-benja.webp',
  },
  {
    id: 'magdalena-budrisic',
    name: 'Magdalena Budrišić',
    title: "Founder of Rab's Franciscan women's convent",
    years: 'c. 1455–1532',
    portrait: '/assets/ui/noble-setup/portraits/magdalena-budrisic.webp',
  },
] as const;

export type NobleId = (typeof NOBLES)[number]['id'];

// Art-directed cloth colors, not measurements of surviving regional textiles.
// The first seven are conventional tinctures; the last three extend the cloth
// palette, without claiming they were standard Croatian heraldic tinctures.
// Historical rationale and sources: artifacts/startup-ui/heraldry-palette.md.
export const HERALDRY_CLOTH_COLORS = {
  red: '#a44132',
  blue: '#355f83',
  green: '#526b3d',
  black: '#272824',
  purple: '#705574',
  white: '#e2dac2',
  yellow: '#c7a64e',
  crimson: '#862f46',
  russet: '#ae6638',
  brown: '#735039',
} as const;

export const HERALDRY_TINCTURES = [
  { id: 'gules', name: 'Red', value: HERALDRY_CLOTH_COLORS.red,
    dye: 'Madder red', description: 'Madder root dyes wool a warm, strong red. A well-established European cloth dye.' },
  { id: 'azure', name: 'Blue', value: HERALDRY_CLOTH_COLORS.blue,
    dye: 'Woad blue', description: 'Woad vat-dyeing produces blue cloth; repeated dips can deepen the shade.' },
  { id: 'vert', name: 'Green', value: HERALDRY_CLOTH_COLORS.green,
    dye: 'Weld and woad green', description: 'Yellow from weld combined with woad blue produces a leafy green.' },
  { id: 'sable', name: 'Black', value: HERALDRY_CLOTH_COLORS.black,
    dye: 'Tannin black', description: 'Oak-gall tannins and iron salts produce black. A deep, even black required careful dyeing.' },
  { id: 'purpure', name: 'Purple', value: HERALDRY_CLOTH_COLORS.purple,
    dye: 'Madder and woad purple', description: 'Red and blue dye baths produce a subdued purple, without rare shellfish dye.' },
  { id: 'argent', name: 'White', value: HERALDRY_CLOTH_COLORS.white,
    dye: 'Wool white · Argent', description: 'Light, undyed wool gives a warm off-white. White cloth stands for heraldic silver.' },
  { id: 'or', name: 'Yellow', value: HERALDRY_CLOTH_COLORS.yellow,
    dye: 'Weld yellow · Or', description: 'Weld flowers and leaves produce yellow. Yellow cloth stands for heraldic gold.' },
  { id: 'crimson', name: 'Crimson', value: HERALDRY_CLOTH_COLORS.crimson,
    dye: 'Kermes crimson', description: 'Kermes insects provide a rich red dye. A costly luxury option known in sixteenth-century textiles.' },
  { id: 'russet', name: 'Russet', value: HERALDRY_CLOTH_COLORS.russet,
    dye: 'Madder russet', description: 'A warm orange-brown in the range of madder dyes, distinct from the deeper red.' },
  { id: 'walnut', name: 'Brown', value: HERALDRY_CLOTH_COLORS.brown,
    dye: 'Walnut brown', description: 'The green husks of common walnut provide a warm brown cloth dye.' },
] as const;

export const HERALDRY_PATTERNS = [
  { id: 'solid', name: 'Plain' },
  { id: 'per-pale', name: 'Per Pale' },
  { id: 'per-fess', name: 'Per Fess' },
  { id: 'bend', name: 'Bend' },
  { id: 'bend-sinister', name: 'Bend Sinister' },
  { id: 'quarterly', name: 'Quarterly' },
  { id: 'checky', name: 'Checky' },
  { id: 'stripes', name: 'Stripes' },
  { id: 'chevron', name: 'Chevron' },
  { id: 'saltire', name: 'Saltire' },
  { id: 'cross', name: 'Cross' },
  { id: 'lozengy', name: 'Lozengy' },
] as const;

export type HeraldryPattern = (typeof HERALDRY_PATTERNS)[number]['id'];

export const HERALDRY_CHARGES = [
  { id: 'lion', name: 'Lion' },
  { id: 'eagle', name: 'Eagle' },
  { id: 'wolf', name: 'Wolf' },
  { id: 'bear', name: 'Bear' },
  { id: 'stag', name: 'Stag' },
  { id: 'boar', name: 'Boar' },
  { id: 'falcon', name: 'Falcon' },
  { id: 'raven', name: 'Raven' },
  { id: 'tower', name: 'Tower' },
  { id: 'key', name: 'Key' },
  { id: 'sword', name: 'Sword' },
  { id: 'axes', name: 'Crossed Axes' },
  { id: 'star', name: 'Star' },
  { id: 'crescent', name: 'Crescent' },
  { id: 'fleur-de-lis', name: 'Fleur-de-lis' },
  { id: 'oak-branch', name: 'Oak Branch' },
  { id: 'latin-cross', name: 'Latin Cross' },
  { id: 'patriarchal-cross', name: 'Patriarchal Cross' },
  { id: 'papal-cross', name: 'Papal Cross' },
  { id: 'cross-pattee', name: 'Cross Pattée' },
  { id: 'cross-potent', name: 'Cross Potent' },
  { id: 'cross-moline', name: 'Cross Moline' },
  { id: 'cross-fleury', name: 'Cross Fleury' },
  { id: 'cross-bottony', name: 'Cross Bottony' },
  { id: 'cross-crosslet', name: 'Cross Crosslet' },
  { id: 'maltese-cross', name: 'Maltese Cross' },
  { id: 'jerusalem-cross', name: 'Jerusalem Cross' },
  { id: 'calvary-cross', name: 'Calvary Cross' },
  { id: 'tau-cross', name: 'Tau Cross' },
  { id: 'chi-rho', name: 'Chi-Rho' },
  { id: 'ihs-monogram', name: 'IHS' },
  { id: 'lamb-of-god', name: 'Lamb of God' },
  { id: 'pelican-in-piety', name: 'Pelican in Piety' },
  { id: 'holy-dove', name: 'Holy Spirit Dove' },
  { id: 'chalice-and-host', name: 'Chalice and Host' },
  { id: 'keys-of-saint-peter', name: 'Keys of Saint Peter' },
  { id: 'crown-of-thorns', name: 'Crown of Thorns' },
  { id: 'three-nails', name: 'Three Holy Nails' },
  { id: 'anchor-cross', name: 'Anchor Cross' },
  { id: 'crowned-cross', name: 'Crowned Cross' },
  { id: 'passion-ladder', name: 'Passion Ladder' },
  { id: 'madonna-and-child', name: 'Madonna and Child' },
  { id: 'marian-monogram', name: 'Marian Monogram' },
  { id: 'saint-james-shell', name: 'Saint James Shell' },
  { id: 'saint-catherine-wheel', name: 'Saint Catherine Wheel' },
  { id: 'saint-paul-sword', name: 'Saint Paul Sword' },
  { id: 'crossed-keys', name: 'Crossed Keys' },
  { id: 'bishop-mitre', name: 'Bishop’s Mitre' },
  { id: 'abbot-crozier', name: 'Abbot’s Crozier' },
  { id: 'papal-tiara', name: 'Papal Tiara' },
  { id: 'rosary', name: 'Rosary' },
  { id: 'censer', name: 'Censer' },
  { id: 'sanctus-bell', name: 'Sanctus Bell' },
  { id: 'closed-gospel', name: 'Closed Gospel' },
  { id: 'open-gospel', name: 'Open Gospel' },
  { id: 'monstrance', name: 'Monstrance' },
  { id: 'reliquary', name: 'Reliquary' },
  { id: 'church', name: 'Church' },
  { id: 'chapel', name: 'Chapel' },
  { id: 'monastery', name: 'Monastery' },
  { id: 'baptismal-font', name: 'Baptismal Font' },
  { id: 'lily', name: 'Lily' },
  { id: 'rose', name: 'Rose' },
  { id: 'grape-cluster', name: 'Grape Cluster' },
  { id: 'wheat-sheaf', name: 'Wheat Sheaf' },
  { id: 'olive-branch', name: 'Olive Branch' },
  { id: 'griffin', name: 'Griffin' },
  { id: 'wyvern', name: 'Wyvern' },
  { id: 'dragon', name: 'Dragon' },
  { id: 'unicorn', name: 'Unicorn' },
  { id: 'horse', name: 'Horse' },
  { id: 'bull', name: 'Bull' },
  { id: 'ram', name: 'Ram' },
  { id: 'goat', name: 'Goat' },
  { id: 'hound', name: 'Hound' },
  { id: 'fox', name: 'Fox' },
  { id: 'lynx', name: 'Lynx' },
  { id: 'hare', name: 'Hare' },
  { id: 'squirrel', name: 'Squirrel' },
  { id: 'dolphin', name: 'Dolphin' },
  { id: 'fish', name: 'Fish' },
  { id: 'pike-fish', name: 'Pike' },
  { id: 'swan', name: 'Swan' },
  { id: 'rooster', name: 'Rooster' },
  { id: 'owl', name: 'Owl' },
  { id: 'peacock', name: 'Peacock' },
  { id: 'stork', name: 'Stork' },
  { id: 'pelican', name: 'Pelican' },
  { id: 'bee', name: 'Bee' },
  { id: 'serpent', name: 'Serpent' },
  { id: 'double-headed-eagle', name: 'Double-Headed Eagle' },
  { id: 'spear', name: 'Spear' },
  { id: 'halberd', name: 'Halberd' },
  { id: 'mace', name: 'Mace' },
  { id: 'war-hammer', name: 'War Hammer' },
  { id: 'bow-and-arrow', name: 'Bow and Arrow' },
  { id: 'crossbow', name: 'Crossbow' },
  { id: 'quiver', name: 'Quiver' },
  { id: 'round-shield', name: 'Round Shield' },
  { id: 'great-helm', name: 'Great Helm' },
  { id: 'gauntlet', name: 'Gauntlet' },
  { id: 'spur', name: 'Spur' },
  { id: 'horseshoe', name: 'Horseshoe' },
  { id: 'hunting-horn', name: 'Hunting Horn' },
  { id: 'war-banner', name: 'War Banner' },
  { id: 'single-axe', name: 'Battle Axe' },
  { id: 'scythe', name: 'Scythe' },
  { id: 'ploughshare', name: 'Ploughshare' },
  { id: 'blacksmith-hammer', name: 'Smith’s Hammer' },
  { id: 'anvil', name: 'Anvil' },
  { id: 'wagon-wheel', name: 'Wagon Wheel' },
  { id: 'anchor', name: 'Anchor' },
  { id: 'sailing-ship', name: 'Sailing Ship' },
  { id: 'chain-links', name: 'Chain Links' },
  { id: 'portcullis', name: 'Portcullis' },
  { id: 'castle', name: 'Castle' },
  { id: 'sun', name: 'Sun' },
  { id: 'comet', name: 'Comet' },
  { id: 'mountain', name: 'Mountain' },
  { id: 'waves', name: 'Waves' },
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
  chargeOutlineColor: string;
  chargeCount: number;
  chargeScale: number;
};

export type NobleProfile = {
  nobleId: NobleId;
  displayName: string;
  heraldry: Heraldry;
};

const cloth = HERALDRY_CLOTH_COLORS;

export const HERALDRY_PRESETS: readonly Heraldry[] = [
  { pattern: 'solid', fieldColor: cloth.green, patternColor: cloth.green, patternTiling: 1, patternAngle: 0, charge: 'bear', chargeColor: cloth.white, chargeOutlineColor: cloth.black, chargeCount: 1, chargeScale: 0.66 },
  { pattern: 'per-pale', fieldColor: cloth.black, patternColor: cloth.yellow, patternTiling: 1, patternAngle: 0, charge: 'lion', chargeColor: cloth.white, chargeOutlineColor: cloth.black, chargeCount: 1, chargeScale: 0.68 },
  { pattern: 'bend', fieldColor: cloth.red, patternColor: cloth.white, patternTiling: 1, patternAngle: -5, charge: 'wolf', chargeColor: cloth.black, chargeOutlineColor: cloth.white, chargeCount: 1, chargeScale: 0.64 },
  { pattern: 'quarterly', fieldColor: cloth.blue, patternColor: cloth.white, patternTiling: 1, patternAngle: 0, charge: 'tower', chargeColor: cloth.yellow, chargeOutlineColor: cloth.black, chargeCount: 1, chargeScale: 0.61 },
  { pattern: 'per-fess', fieldColor: cloth.green, patternColor: cloth.yellow, patternTiling: 1, patternAngle: 0, charge: 'stag', chargeColor: cloth.white, chargeOutlineColor: cloth.black, chargeCount: 1, chargeScale: 0.67 },
  { pattern: 'saltire', fieldColor: cloth.purple, patternColor: cloth.white, patternTiling: 1, patternAngle: 0, charge: 'star', chargeColor: cloth.yellow, chargeOutlineColor: cloth.black, chargeCount: 1, chargeScale: 0.5 },
  { pattern: 'stripes', fieldColor: cloth.black, patternColor: cloth.red, patternTiling: 4, patternAngle: 0, charge: 'eagle', chargeColor: cloth.white, chargeOutlineColor: cloth.black, chargeCount: 1, chargeScale: 0.72 },
  { pattern: 'solid', fieldColor: cloth.blue, patternColor: cloth.blue, patternTiling: 1, patternAngle: 0, charge: 'crescent', chargeColor: cloth.white, chargeOutlineColor: cloth.black, chargeCount: 3, chargeScale: 0.34 },
  { pattern: 'lozengy', fieldColor: cloth.white, patternColor: cloth.green, patternTiling: 3, patternAngle: 0, charge: 'bear', chargeColor: cloth.black, chargeOutlineColor: cloth.white, chargeCount: 1, chargeScale: 0.66 },
  { pattern: 'cross', fieldColor: cloth.red, patternColor: cloth.white, patternTiling: 1, patternAngle: 0, charge: 'key', chargeColor: cloth.yellow, chargeOutlineColor: cloth.black, chargeCount: 2, chargeScale: 0.38 },
  { pattern: 'chevron', fieldColor: cloth.black, patternColor: cloth.yellow, patternTiling: 1, patternAngle: 0, charge: 'boar', chargeColor: cloth.white, chargeOutlineColor: cloth.black, chargeCount: 1, chargeScale: 0.59 },
  { pattern: 'bend-sinister', fieldColor: cloth.green, patternColor: cloth.white, patternTiling: 1, patternAngle: 6, charge: 'axes', chargeColor: cloth.yellow, chargeOutlineColor: cloth.black, chargeCount: 1, chargeScale: 0.6 },
  { pattern: 'per-pale', fieldColor: cloth.purple, patternColor: cloth.black, patternTiling: 1, patternAngle: 0, charge: 'fleur-de-lis', chargeColor: cloth.white, chargeOutlineColor: cloth.black, chargeCount: 3, chargeScale: 0.33 },
  { pattern: 'checky', fieldColor: cloth.blue, patternColor: cloth.white, patternTiling: 3, patternAngle: 0, charge: 'sword', chargeColor: cloth.yellow, chargeOutlineColor: cloth.black, chargeCount: 1, chargeScale: 0.65 },
  { pattern: 'solid', fieldColor: cloth.red, patternColor: cloth.red, patternTiling: 1, patternAngle: 0, charge: 'oak-branch', chargeColor: cloth.white, chargeOutlineColor: cloth.black, chargeCount: 1, chargeScale: 0.62 },
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
}

/** Remember the profile only once its world is playable, not while editing setup. */
export function persistCurrentNobleProfile(): void {
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
  element.style.setProperty('--charge-outline-color', normalized.chargeOutlineColor);
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
    chargeOutlineColor: validColor(heraldry?.chargeOutlineColor, fallback.chargeOutlineColor),
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
