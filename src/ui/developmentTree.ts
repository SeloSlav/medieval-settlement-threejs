/** Presentation-only progression. Nothing in this module may affect the simulation. */
export const DEVELOPMENT_POINT_CAP = 9;

export type DevelopmentBranchId = 'land' | 'woodland' | 'craft' | 'hearth';
export type DevelopmentSkill = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly icon: string;
  readonly requires: readonly string[];
};
export type DevelopmentBranch = {
  readonly id: DevelopmentBranchId;
  readonly name: string;
  readonly motto: string;
  readonly angle: number;
  readonly skills: readonly DevelopmentSkill[];
};

export const DEVELOPMENT_BRANCHES: readonly DevelopmentBranch[] = [
  {
    id: 'land', name: 'Land & Harvest', motto: 'From good earth, abundance.', angle: -90,
    skills: [
      { id: 'field-stewards', name: 'Field Stewards', description: 'Careful field planning reduces the labor needed to plough and sow crops.', icon: 'ploughshare', requires: [] },
      { id: 'deep-furrows', name: 'Deep Furrows', description: 'Experienced ox teams prepare larger fields with less ploughing work.', icon: 'bull', requires: ['field-stewards'] },
      { id: 'living-soil', name: 'Living Soil', description: 'Manure and worked fallow restore more fertility between harvests.', icon: 'oak-branch', requires: ['field-stewards'] },
      { id: 'harvest-hands', name: 'Harvest Hands', description: 'Practised harvest crews gather ripe crops faster before the autumn deadline.', icon: 'scythe', requires: ['deep-furrows'] },
      { id: 'orchard-keepers', name: 'Orchard Keepers', description: 'Tended household orchards produce more fruit from every mature tree.', icon: 'grape-cluster', requires: ['living-soil'] },
      { id: 'breadbasket', name: 'Breadbasket', description: 'Coordinated fields, orchards, and granaries increase the estate’s harvest yield.', icon: 'wheat-sheaf', requires: ['harvest-hands', 'orchard-keepers'] },
    ],
  },
  {
    id: 'craft', name: 'Craft & Trade', motto: 'Skilled hands, lasting prosperity.', angle: 0,
    skills: [
      { id: 'apprenticeships', name: 'Apprenticeships', description: 'Apprentices help staffed workshops complete ordinary production cycles faster.', icon: 'blacksmith-hammer', requires: [] },
      { id: 'charcoal-mastery', name: 'Charcoal Mastery', description: 'Carefully banked kilns turn the same timber into more charcoal.', icon: 'single-axe', requires: ['apprenticeships'] },
      { id: 'merchant-ledgers', name: 'Merchant Ledgers', description: 'Better trading records reduce the gold cost of imported workshop materials.', icon: 'open-gospel', requires: ['apprenticeships'] },
      { id: 'master-smiths', name: 'Master Smiths', description: 'Master smiths forge civilian tools and military equipment with less iron waste.', icon: 'anvil', requires: ['charcoal-mastery'] },
      { id: 'carters-guild', name: 'Carters’ Guild', description: 'Organised cart crews carry larger loads on workshop and trade deliveries.', icon: 'wagon-wheel', requires: ['merchant-ledgers'] },
      { id: 'chartered-markets', name: 'Chartered Markets', description: 'An estate-wide market charter improves the sale value of locally made exports.', icon: 'sailing-ship', requires: ['master-smiths', 'carters-guild'] },
    ],
  },
  {
    id: 'hearth', name: 'Hearth & Watch', motto: 'A home worth defending.', angle: 90,
    skills: [
      { id: 'common-cause', name: 'Common Cause', description: 'Shared building customs reduce the work needed to construct and improve residences.', icon: 'castle', requires: [] },
      { id: 'parish-care', name: 'Parish Care', description: 'Parish relief reaches struggling households with fewer provisions lost along the way.', icon: 'chalice-and-host', requires: ['common-cause'] },
      { id: 'watch-fires', name: 'Watch Fires', description: 'A practised watch gives earlier warning of approaching bandits and raiders.', icon: 'tower', requires: ['common-cause'] },
      { id: 'winter-hearths', name: 'Winter Hearths', description: 'Better household insulation reduces winter firewood consumption.', icon: 'closed-gospel', requires: ['parish-care'] },
      { id: 'trained-bands', name: 'Trained Bands', description: 'Regular militia drills improve company cohesion and recovery after battle.', icon: 'spear', requires: ['watch-fires'] },
      { id: 'steadfast-estate', name: 'Steadfast Estate', description: 'Secure homes and a trusted watch soften household approval losses during hardship.', icon: 'round-shield', requires: ['winter-hearths', 'trained-bands'] },
    ],
  },
  {
    id: 'woodland', name: 'Woodland & Waters', motto: 'Take wisely; leave life behind.', angle: 180,
    skills: [
      { id: 'woodland-lore', name: 'Woodland Lore', description: 'Local knowledge helps foresters and gatherers bring home more useful woodland resources.', icon: 'oak-branch', requires: [] },
      { id: 'coppice-craft', name: 'Coppice Craft', description: 'Managed regrowth improves the long-term supply of firewood from worked woodland.', icon: 'single-axe', requires: ['woodland-lore'] },
      { id: 'hunters-paths', name: 'Hunters’ Paths', description: 'Experienced hunters recover more meat and hides from each hunted animal.', icon: 'stag', requires: ['woodland-lore'] },
      { id: 'forest-gardens', name: 'Forest Gardens', description: 'Carefully tended gathering grounds improve seasonal berry and mushroom yields.', icon: 'bee', requires: ['coppice-craft'] },
      { id: 'river-wardens', name: 'River Wardens', description: 'Selective fishing preserves more breeding stock while maintaining a useful catch.', icon: 'fish', requires: ['hunters-paths'] },
      { id: 'keepers-of-the-wild', name: 'Keepers of the Wild', description: 'Estate-wide stewardship strengthens the recovery of renewable woodland and river resources.', icon: 'hunting-horn', requires: ['forest-gardens', 'river-wardens'] },
    ],
  },
];

export const DEVELOPMENT_SKILLS = DEVELOPMENT_BRANCHES.flatMap(branch => branch.skills);
export const DEVELOPMENT_SKILL_BY_ID = new Map(DEVELOPMENT_SKILLS.map(skill => [skill.id, skill]));

export type DevelopmentSkillStatus = 'locked' | 'available' | 'learned' | 'unaffordable';

/** One budget for the entire map; deliberately session-local, with no save/reducer hooks. */
export class DevelopmentState {
  private readonly learned = new Set<string>();

  get points(): number { return DEVELOPMENT_POINT_CAP - this.learned.size; }
  get spent(): number { return this.learned.size; }

  has(id: string): boolean { return this.learned.has(id); }

  status(id: string): DevelopmentSkillStatus {
    const skill = DEVELOPMENT_SKILL_BY_ID.get(id);
    if (!skill) return 'locked';
    if (this.has(id)) return 'learned';
    if (!skill.requires.every(required => this.has(required))) return 'locked';
    return this.points > 0 ? 'available' : 'unaffordable';
  }

  unlock(id: string): boolean {
    if (this.status(id) !== 'available') return false;
    this.learned.add(id);
    return true;
  }

  reset(): void { this.learned.clear(); }
}

/** Shared radial geometry for the HTML nodes and SVG dependency lines. */
export function developmentSkillPosition(branch: DevelopmentBranch, index: number): { x: number; y: number } {
  const [radius, offset] = [[142, 0], [235, -22], [235, 22], [325, -21], [325, 21], [398, 0]][index];
  const angle = (branch.angle + offset) * Math.PI / 180;
  return { x: 450 + Math.cos(angle) * radius, y: 450 + Math.sin(angle) * radius };
}

export function developmentIconUrl(icon: string): string {
  // Existing painted woodcuts, not the single-color heraldic charge masks.
  const artwork: Record<string, string> = {
    ploughshare: 'icons/affinities/cultivation.png', bull: 'icons/actions/cattle-herd.png',
    'oak-branch': 'icons/affinities/forestry.png', scythe: 'icons/provisions/rye-sheaves.png',
    'grape-cluster': 'icons/backyards/orchard.png', 'wheat-sheaf': 'icons/provisions/rye-bread.png',
    'blacksmith-hammer': 'icons/affinities/industry.png', 'single-axe': 'icons/materials/charcoal.png',
    'open-gospel': 'icons/monastery/scriptorium-archive.png', anvil: 'icons/materials/iron.png',
    'wagon-wheel': 'build-menu/cards/trading-post.webp', 'sailing-ship': 'build-menu/cards/market.webp',
    castle: 'icons/upgrades/residence-tier-2.png', 'chalice-and-host': 'icons/monastery/infirmary-wing.png',
    tower: 'build-menu/cards/watchtower.webp', 'closed-gospel': 'icons/upgrades/residence-tier-3.png',
    spear: 'icons/actions/trained-spears.png', 'round-shield': 'icons/materials/shields.png',
    stag: 'icons/materials/pelts.png', bee: 'icons/backyards/herb-garden.png',
    fish: 'build-menu/cards/fishing-camp.webp', 'hunting-horn': 'icons/affinities/pollination.png',
  };
  return `/assets/ui/${artwork[icon]}`;
}
