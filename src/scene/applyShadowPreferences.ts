import * as THREE from 'three';
import { isBuildingShadowProxy } from '../buildings/buildingShadowProxy.ts';
import type { ForestManager } from '../props/ForestManager.ts';
import {
  areBuildingShadowsEnabled,
  areTreeShadowsEnabled,
} from './shadowPreference.ts';

export function applyShadowPreferences(options: {
  sunLight: THREE.DirectionalLight;
  forestManager: ForestManager | null;
  propGroups: readonly THREE.Object3D[];
  buildingRoot: THREE.Object3D;
}): void {
  const treeShadows = areTreeShadowsEnabled();
  const buildingShadows = areBuildingShadowsEnabled();

  options.sunLight.castShadow = treeShadows || buildingShadows;
  options.forestManager?.setTreeShadowsEnabled(treeShadows);

  for (const group of options.propGroups) {
    setTreeShadowCastersInGroup(group, treeShadows);
  }

  setBuildingShadowProxiesEnabled(options.buildingRoot, buildingShadows);
}

function setTreeShadowCastersInGroup(root: THREE.Object3D, enabled: boolean): void {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || !isTreeShadowCaster(mesh)) return;
    mesh.castShadow = enabled;
  });
}

function isTreeShadowCaster(mesh: THREE.Mesh): boolean {
  const name = mesh.name.toLowerCase();
  return name.includes('shadow') || name === 'river reeds';
}

function setBuildingShadowProxiesEnabled(root: THREE.Object3D, enabled: boolean): void {
  root.traverse((object) => {
    if (!isBuildingShadowProxy(object)) return;
    (object as THREE.Mesh).castShadow = enabled;
  });
}
