import * as THREE from 'three';

export const GORSKI_PALETTE = {
  stoneWhite: 0xe6dfd0,
  stoneWhiteShadow: 0xcbc3b4,
  stoneMortar: 0xb8b0a2,
  timberDark: 0x4f3828,
  timberMid: 0x6b4e38,
  timberLight: 0x8a684c,
  timberWeathered: 0x7a5e46,
  tileRed: 0xa83f32,
  tileRedDark: 0x8a3228,
  tileRedHighlight: 0xc04a3a,
  shingleWood: 0x5c4636,
  shingleAged: 0x4a382c,
  moss: 0x4d6b3c,
  grassRoof: 0x5f7a44,
  mossDark: 0x3d5530,
  interiorDark: 0x1a1410,
} as const;

export function stoneMaterial(shade: 'light' | 'mid' | 'mortar' = 'mid'): THREE.MeshStandardMaterial {
  const color =
    shade === 'light'
      ? GORSKI_PALETTE.stoneWhite
      : shade === 'mortar'
        ? GORSKI_PALETTE.stoneMortar
        : GORSKI_PALETTE.stoneWhiteShadow;
  return new THREE.MeshStandardMaterial({ color, roughness: 0.94, metalness: 0 });
}

export function timberMaterial(shade: 'dark' | 'mid' | 'light' | 'weathered' = 'mid'): THREE.MeshStandardMaterial {
  const color =
    shade === 'dark'
      ? GORSKI_PALETTE.timberDark
      : shade === 'light'
        ? GORSKI_PALETTE.timberLight
        : shade === 'weathered'
          ? GORSKI_PALETTE.timberWeathered
          : GORSKI_PALETTE.timberMid;
  return new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0 });
}

export function tileMaterial(variant: 0 | 1 | 2 = 0): THREE.MeshStandardMaterial {
  const colors = [GORSKI_PALETTE.tileRed, GORSKI_PALETTE.tileRedDark, GORSKI_PALETTE.tileRedHighlight] as const;
  return new THREE.MeshStandardMaterial({ color: colors[variant], roughness: 0.82, metalness: 0.02 });
}

export function shingleMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: GORSKI_PALETTE.shingleWood,
    roughness: 0.92,
    metalness: 0,
  });
}

export function mossMaterial(kind: 'moss' | 'grass' = 'moss'): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: kind === 'grass' ? GORSKI_PALETTE.grassRoof : GORSKI_PALETTE.moss,
    roughness: 0.98,
    metalness: 0,
  });
}

export function addMesh(
  group: THREE.Group,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  position: THREE.Vector3,
  rotation = new THREE.Euler(),
  scale = new THREE.Vector3(1, 1, 1),
): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.copy(position);
  mesh.rotation.copy(rotation);
  mesh.scale.copy(scale);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}
