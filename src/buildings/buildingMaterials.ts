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

export const RESIDENCE_FACADE_PALETTE = {
  white: 0xe8e2d8,
  yellow: 0xccb860,
  grey: 0x8a8580,
  lightOrange: 0xcc9858,
  orange: 0xbf7038,
} as const;

export const RESIDENCE_ROOF_PALETTE = {
  red: GORSKI_PALETTE.tileRed,
  brown: GORSKI_PALETTE.shingleWood,
  grey: 0x6a6662,
  slate: 0x454a50,
} as const;

export const RESIDENCE_ROOF_SPECS = {
  red: { roughness: 0.82, metalness: 0.02 },
  brown: { roughness: 0.92, metalness: 0 },
  grey: { roughness: 0.92, metalness: 0 },
  slate: { roughness: 0.88, metalness: 0.04 },
} as const;

export type ResidenceFacadeColor = keyof typeof RESIDENCE_FACADE_PALETTE;
export type ResidenceRoofColor = keyof typeof RESIDENCE_ROOF_PALETTE;

/** Weathered grey quarry stone — distinct from bright Gorski limestone on mills/huts. */
export const QUARRY_ROCK_PALETTE = {
  dark: 0x52565c,
  mid: 0x6b7078,
  light: 0x828890,
  cut: 0x5e636a,
  dust: 0x6a6660,
  spoil: 0x5c5854,
} as const;

export function quarryRockMaterial(
  shade: keyof typeof QUARRY_ROCK_PALETTE = 'mid',
): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: QUARRY_ROCK_PALETTE[shade],
    roughness: 0.96,
    metalness: 0,
  });
}

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

export function residenceFacadeMaterial(
  facade: ResidenceFacadeColor,
): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: RESIDENCE_FACADE_PALETTE[facade],
    roughness: 0.9,
    metalness: 0,
  });
}

export function residenceRoofMaterial(roof: ResidenceRoofColor): THREE.MeshStandardMaterial {
  const spec = RESIDENCE_ROOF_SPECS[roof];
  return new THREE.MeshStandardMaterial({
    color: RESIDENCE_ROOF_PALETTE[roof],
    roughness: spec.roughness,
    metalness: spec.metalness,
  });
}

export function mossMaterial(kind: 'moss' | 'grass' = 'moss'): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: kind === 'grass' ? GORSKI_PALETTE.grassRoof : GORSKI_PALETTE.moss,
    roughness: 0.98,
    metalness: 0,
  });
}

export function metalMaterial(shade: 'iron' | 'steel' = 'iron'): THREE.MeshStandardMaterial {
  const color = shade === 'steel' ? 0x6b7078 : 0x4a4846;
  return new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.72 });
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
  // Detailed meshes stay off the shadow pass; one invisible proxy per building casts instead.
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}
