import * as THREE from 'three';
import type { WebGPURenderer } from 'three/webgpu';
import type { Terrain } from '../terrain/Terrain.ts';
import type { ForestTreePlacement } from '../props/forestPlacements.ts';
import { createSeedThreeForest, createSeedThreeForestController } from '../vegetation/seedthree/seedThreeForestBuilder.ts';
import type { SeedThreeForestController } from '../vegetation/seedthree/seedThreeForestTypes.ts';
import { ChunkStream } from './ChunkStream.ts';
import { StreamedInstanceBatches } from '../scene/StreamedInstanceBatches.ts';
import { REALM_CHUNKS_PER_SIDE, chunkBounds, worldChunk } from './realmPolicy.ts';

type Tile = { group: THREE.Group; controller: SeedThreeForestController; dispose(): void };
/** Only metadata for all 30k trees stays resident. GPU tree/card instances are chunk-owned. */
export async function createRealmForestStream(placements: ForestTreePlacement[],
  terrain: Pick<Terrain, 'getHeightAt' | 'generationSize'>, anisotropy: number, seed: number, renderer: WebGPURenderer) {
  const group = new THREE.Group(); group.name = 'Streamed realm woodland';
  const batches = new StreamedInstanceBatches(); group.add(batches.root);
  // Bake shared species once during startup, before the normal renderer owns the GPU.
  const prepared = await createSeedThreeForest([], terrain, anisotropy, seed, renderer);
  const empty = createSeedThreeForestController(prepared);
  const buckets = new Map<number, number[]>();
  const localIndices = new Uint32Array(placements.length);
  placements.forEach((p, i) => {
    const id = worldChunk(p.x, p.z); if (id === null) return;
    const indices = buckets.get(id) ?? []; localIndices[i] = indices.length;
    indices.push(i); buckets.set(id, indices);
  });
  const hidden = new Set<number>(); const transforms = new Map<number, THREE.Matrix4>();
  const loaded = new Map<number, Tile>(); const attached = new Map<number, Tile>();
  let season: Parameters<SeedThreeForestController['setDeciduousFoliage']>[0] | undefined;
  let snow = 0, shadows = true, distantCards = true, previousInterest = '';
  const stream = new ChunkStream<Tile>({ capacity: 49, cacheCapacity: 6, concurrency: 1,
    load: async id => {
      const indices = buckets.get(id)!;
      const forest = await createSeedThreeForest(indices.map(i => placements[i]), terrain, anisotropy, seed, renderer);
      const controller = createSeedThreeForestController(forest);
      for (const [local, global] of indices.entries()) {
        if (hidden.has(global)) controller.hideTree(local);
        const transform = transforms.get(global); if (transform) controller.setTreeTransform?.(local, transform);
      }
      controller.commit(); controller.setSnowCoverage(snow); controller.setShadows(shadows); controller.setDistantCanopyCardsEnabled(distantCards);
      if (season) controller.setDeciduousFoliage(season);
      const tile: Tile = { group: forest.group, controller, dispose: () => { controller.dispose(); forest.group.removeFromParent(); loaded.delete(id); } };
      loaded.set(id, tile); return tile;
    },
    attach: (id, tile) => { attached.set(id, tile); group.add(tile.group); tile.group.updateMatrixWorld(true); batches.add(tile.group); },
    detach: (id, tile) => { attached.delete(id); batches.remove(tile.group); group.remove(tile.group); },
    onError: (id, error) => console.error(`[Realm woodland ${id}]`, error),
  });
  const eachLoaded = (fn: (c: SeedThreeForestController) => void) => { for (const tile of loaded.values()) fn(tile.controller); };
  const modify = (index: number, action: (c: SeedThreeForestController, local: number) => void) => {
    const p = placements[index]; if (!p) return;
    const tile = loaded.get(worldChunk(p.x,p.z)!); if (tile) action(tile.controller,localIndices[index]);
  };
  const controller: SeedThreeForestController = {
    hideTree: index => { hidden.add(index); modify(index,(c,i)=>c.hideTree(i)); },
    showTree: index => { hidden.delete(index); modify(index,(c,i)=>c.showTree(i)); },
    setTreeTransform: (index,matrix) => { transforms.set(index,matrix.clone()); modify(index,(c,i)=>c.setTreeTransform?.(i,matrix)); },
    commit: () => eachLoaded(c=>c.commit()),
    updateCamera: (camera,distance,firstPerson,bounds,interacting,dt) => {
      const centerX=(bounds.minX+bounds.maxX)/2, centerZ=(bounds.minZ+bounds.maxZ)/2;
      const center=worldChunk(centerX,centerZ);
      const radius=Math.min(1024,Math.max(384,(bounds.maxX-bounds.minX)/2,(bounds.maxZ-bounds.minZ)/2));
      const interest=[...buckets.keys()].filter(id=>{
        const b=chunkBounds(id); return b.maxX>=centerX-radius && b.minX<=centerX+radius && b.maxZ>=centerZ-radius && b.minZ<=centerZ+radius;
      }).sort((a,b)=>{
        const distance=(id:number)=>(id%REALM_CHUNKS_PER_SIDE-(center??0)%REALM_CHUNKS_PER_SIDE)**2
          +(Math.floor(id/REALM_CHUNKS_PER_SIDE)-Math.floor((center??0)/REALM_CHUNKS_PER_SIDE))**2;
        return distance(a)-distance(b);
      }).slice(0,49);
      const signature=interest.join(','); if(signature!==previousInterest) { previousInterest=signature; stream.setInterest(interest); }
      const before=attached.size; stream.pump(1.5);
      let changed=before!==attached.size, presentationChanged=changed;
      for(const tile of attached.values()) {
        const state=tile.controller.updateCamera(camera,distance,firstPerson,bounds,interacting,dt);
        changed=state.shadowCastersChanged||changed; presentationChanged=state.presentationChanged||presentationChanged;
      }
      const batchUpdate=batches.prepare();
      changed=batchUpdate.shadowChanged||changed; presentationChanged=batchUpdate.changed||presentationChanged;
      return {presentationChanged,shadowCastersChanged:changed};
    },
    getStructuralStats: () => {
      const result=empty.getStructuralStats();
      for(const tile of attached.values()) {
        const s=tile.controller.getStructuralStats(); result.draws+=s.draws; result.triangles+=s.triangles; result.instances+=s.instances;
        result.trees.nearTrees+=s.trees.nearTrees; result.trees.overviewTrees+=s.trees.overviewTrees; result.trees.visibleTrees+=s.trees.visibleTrees;
      }
      const batchStats=batches.stats(); result.draws-=batchStats.sourceDraws-batchStats.draws;
      result.trees.totalTrees=placements.length; result.trees.culledTrees=placements.length-result.trees.visibleTrees; return result;
    },
    getProfileBreakdown: () => {
      const result=empty.getProfileBreakdown();
      for(const tile of attached.values()) {
        const s=tile.controller.getProfileBreakdown(); result.paddedColorTrees+=s.paddedColorTrees; result.criticalColorTrees+=s.criticalColorTrees;
        for(const key of ['residentColor','submittedColor','criticalProjectedColor'] as const) {
          result[key].draws+=s[key].draws; result[key].triangles+=s[key].triangles; result[key].instances+=s[key].instances;
        }
      }
      const batchStats=batches.stats(); result.submittedColor.draws-=batchStats.sourceDraws-batchStats.draws;
      return result;
    },
    setDeciduousFoliage: value => {season=value;eachLoaded(c=>c.setDeciduousFoliage(value));},
    setSnowCoverage: value => {snow=value;eachLoaded(c=>c.setSnowCoverage(value));},
    setDistantCanopyCardsEnabled: value => {distantCards=value;eachLoaded(c=>c.setDistantCanopyCardsEnabled(value));},
    setShadows: value => {shadows=value;eachLoaded(c=>c.setShadows(value));},
    dispose: () => {stream.dispose();batches.dispose();empty.dispose();group.removeFromParent();},
  };
  group.userData.realmStream = stream;
  group.userData.realmInstanceBatches = batches;
  return {group,controller};
}
