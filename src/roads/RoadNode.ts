import * as THREE from 'three';

export type JunctionType = 'endpoint' | 'bend' | 't-junction' | 'cross-junction' | 'complex';

export type RoadNode = {
  id: string;
  position: THREE.Vector3;
  edgeIds: Set<string>;
  junctionType: JunctionType;
  helper?: THREE.Object3D;
};
