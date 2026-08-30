// Keep this list aligned with the Gorski tree/shrub presets plus the
// apple/cherry backyard models. A directory-wide eager glob made every unused
// SeedThree biome texture part of the production payload.
const barkModules = (typeof import.meta.glob === 'function' ? import.meta.glob(
  '../../../vendor/seedthree/assets/bark/{american_beech,white_oak,red_maple,sweetgum,douglas_fir,loblolly,pine,apple_bark,cherry_bark,pear_bark,aronia_branch,rosehip_cane,bilberry_branch,common_juniper_branch,raspberry_cane,hornbeam_hedge_branch}_{albedo,normal,roughness}.png',
  {
    eager: true,
    query: '?url',
    import: 'default',
  },
) : {}) as Record<string, string>;

const leafModules = (typeof import.meta.glob === 'function' ? import.meta.glob(
  [
    '../../../vendor/seedthree/assets/leaves/{american_beech_single,white_oak_single,red_maple_single,sweetgum_single,douglas_fir_needle,loblolly_needle,pine_needle,apple_single,cherry_single,pear_single}_{albedo,normal,roughness,translucency}.png',
    '../../../vendor/seedthree/assets/leaves/{bilberry,fern,juniper_scrub,raspberry_spray,hornbeam_hedge_spray,aronia_spray,rosehip_spray}_{albedo,normal,roughness,translucency}.png',
    '../../../vendor/seedthree/assets/leaves/cattail_reed_card{,_normal,_roughness,_translucency}.png',
  ],
  {
    eager: true,
    query: '?url',
    import: 'default',
  },
) : {}) as Record<string, string>;

const localNettleModules = (typeof import.meta.glob === 'function' ? import.meta.glob(
  '../../assets/vegetation/stinging-nettle/stinging_nettle_{single,stem}_{albedo,normal,roughness,translucency}.png',
  {
    eager: true,
    query: '?url',
    import: 'default',
  },
) : {}) as Record<string, string>;

const localDogwoodModules = (typeof import.meta.glob === 'function' ? import.meta.glob(
  [
    '../../assets/vegetation/common-dogwood/common_dogwood_branch_{albedo,normal,roughness}.png',
    '../../assets/vegetation/common-dogwood/common_dogwood_single_{albedo,normal,roughness,translucency}.png',
  ],
  {
    eager: true,
    query: '?url',
    import: 'default',
  },
) : {}) as Record<string, string>;

const fruitModules = (typeof import.meta.glob === 'function' ? import.meta.glob(
  '../../../vendor/seedthree/assets/fruits/{apple,cherry_pair,pear,aronia_cluster,rosehip_cluster,raspberry_cluster}.glb',
  {
    eager: true,
    query: '?url',
    import: 'default',
  },
) : {}) as Record<string, string>;

function byBasename(modules: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [path, url] of Object.entries(modules)) {
    out[path.split('/').pop() ?? path] = url;
  }
  return out;
}

const localNettleUrls = byBasename(localNettleModules);
const localDogwoodUrls = byBasename(localDogwoodModules);
const barkUrls = { ...byBasename(barkModules), ...localNettleUrls, ...localDogwoodUrls };
const leafUrls = { ...byBasename(leafModules), ...localNettleUrls, ...localDogwoodUrls };
const fruitUrls = byBasename(fruitModules);

export function seedThreeBarkUrl(name: string): string | undefined {
  return barkUrls[name];
}

export function seedThreeLeafUrl(name: string): string | undefined {
  return leafUrls[name];
}

export function seedThreeFruitUrl(name: string): string | undefined {
  return fruitUrls[name];
}
