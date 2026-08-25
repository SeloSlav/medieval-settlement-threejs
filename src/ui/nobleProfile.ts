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
    id: 'juraj-julije-klovic',
    name: 'Juraj Julije Klović',
    title: 'Vinodol-born Augustinian canon and master illuminator',
    years: '1498–1578',
    portrait: '/assets/ui/noble-setup/portraits/juraj-julije-klovic.webp',
  },
  {
    id: 'stjepan-konzul-istranin',
    name: 'Stjepan Konzul Istranin',
    title: 'Glagolitic priest, Protestant writer, and Bible translator',
    years: '1521–1579',
    portrait: '/assets/ui/noble-setup/portraits/stjepan-konzul-istranin.webp',
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

export const HERALDRY_TINCTURES = [
  { id: 'gules', name: 'Red', value: '#8d3027' },
  { id: 'azure', name: 'Blue', value: '#2e5266' },
  { id: 'vert', name: 'Green', value: '#43593b' },
  { id: 'sable', name: 'Black', value: '#25251f' },
  { id: 'purpure', name: 'Purple', value: '#66445b' },
  { id: 'argent', name: 'Silver', value: '#d8d1bb' },
  { id: 'or', name: 'Gold', value: '#c59b48' },
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
