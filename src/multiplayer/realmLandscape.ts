import { REALM, realmRegionCenter } from './realmPolicy.ts';
import type { ForestTreePlacement } from '../props/forestPlacements.ts';
import type { ForestCore } from '../props/forestField.ts';

export function realmCamp(slot: number) {
  const center = realmRegionCenter(slot);
  return { slot, x: center.x + Math.sin(slot * 17.3) * 72, z: center.z + Math.cos(slot * 11.7) * 72 };
}
/** Low-gradient arable benches; the founding clearing is level for every slot. */
export function realmHeight(x: number, z: number): number {
  const col = Math.round(x / REALM.regionSpacing) + 4;
  const row = Math.round(z / REALM.regionSpacing) + 4;
  const slot = Math.max(0, Math.min(8, row)) * 9 + Math.max(0, Math.min(8, col));
  const camp = realmCamp(slot);
  const blend = Math.min(1, Math.max(0, (Math.hypot(x - camp.x, z - camp.z) - 48) / 160));
  const h = (px: number, pz: number) => 6 + Math.sin(px / 430) * 3 + Math.cos(pz / 370) * 3
    + Math.sin((px + pz) / 160) * 0.8;
  return h(camp.x, camp.z) * (1 - blend) + h(x, z) * blend;
}
export function realmForestCores(): ForestCore[] {
  return Array.from({ length: 81 }, (_, slot) => {
    const camp = realmCamp(slot);
    return [0, 1, 2].map(grove => {
      const angle = grove * Math.PI * 2 / 3 + slot * 0.7;
      return { x: camp.x + Math.cos(angle) * 270, z: camp.z + Math.sin(angle) * 270,
        radiusX: 115, radiusZ: 95, rotation: angle, strength: 0.94, coniferBias: (slot % 5) / 5 };
    });
  }).flat();
}
/** Stable IDs derive from slots, not camera load order. No global rejection sampling. */
export function realmTrees(isBlockedAt?: (x: number, z: number) => boolean): ForestTreePlacement[] {
  const trees: ForestTreePlacement[] = [];
  for (const [index, core] of realmForestCores().entries()) {
    for (let i = 0; i < 128; i++) {
      const angle = i * 2.399963229728653 + index;
      const radius = Math.sqrt((i + 0.5) / 128);
      const x = core.x + Math.cos(angle) * radius * core.radiusX;
      const z = core.z + Math.sin(angle) * radius * core.radiusZ;
      if (isBlockedAt?.(x, z)) continue;
      trees.push({ x, z, species: (i + index) % 4 === 0 ? 'silverFir' : 'beech',
        form: i % 7 === 0 ? 'young' : 'broad', scale: 0.85 + ((i * 17 + index) % 31) / 60 });
    }
  }
  return trees;
}
