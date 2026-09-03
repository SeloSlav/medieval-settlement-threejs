import * as THREE from 'three';
import { addMesh, timberMaterial } from '../buildingMaterials.ts';

// Stern to bow, in metres. The narrow raised stem, broad middle and flared
// sides describe a shallow river skiff; the flat bottom rests on the shore.
const HULL_SECTIONS = [
  { z: -2.15, halfWidth: 0.42, bottom: 0.16, rim: 0.76 },
  { z: -1.8, halfWidth: 0.60, bottom: 0.07, rim: 0.70 },
  { z: -1.2, halfWidth: 0.74, bottom: 0.025, rim: 0.65 },
  { z: -0.6, halfWidth: 0.81, bottom: 0.025, rim: 0.63 },
  { z: 0, halfWidth: 0.82, bottom: 0.025, rim: 0.63 },
  { z: 0.6, halfWidth: 0.78, bottom: 0.035, rim: 0.66 },
  { z: 1.2, halfWidth: 0.65, bottom: 0.09, rim: 0.72 },
  { z: 1.75, halfWidth: 0.41, bottom: 0.21, rim: 0.81 },
  { z: 2.2, halfWidth: 0.14, bottom: 0.38, rim: 0.91 },
] as const;
const HULL_WALL_THICKNESS = 0.085;
const HULL_BOTTOM_THICKNESS = 0.11;
const HULL_END_THICKNESS = 0.12;

function hullSection(index: number, interior: boolean): THREE.Vector3[] {
  const section = HULL_SECTIONS[index];
  const width = section.halfWidth - (interior ? HULL_WALL_THICKNESS : 0);
  const bottom = section.bottom + (interior ? HULL_BOTTOM_THICKNESS : 0);
  const endInset = index === 0 ? HULL_END_THICKNESS
    : index === HULL_SECTIONS.length - 1 ? -HULL_END_THICKNESS : 0;
  const z = section.z + (interior ? endInset : 0);
  // Counter-clockwise in XY: port rim, bilge, bottom, starboard bilge/rim.
  return [
    new THREE.Vector3(-width, section.rim, z),
    new THREE.Vector3(-width * 0.78, bottom + 0.18, z),
    new THREE.Vector3(-width * 0.54, bottom, z),
    new THREE.Vector3(width * 0.54, bottom, z),
    new THREE.Vector3(width * 0.78, bottom + 0.18, z),
    new THREE.Vector3(width, section.rim, z),
  ];
}

/** Closed timber shell with a genuinely open cockpit and inward-facing lining. */
function createHullGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const triangle = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3): void => {
    positions.push(...a.toArray(), ...b.toArray(), ...c.toArray());
  };
  const quad = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3): void => {
    triangle(a, b, c);
    triangle(a, c, d);
  };
  const outer = HULL_SECTIONS.map((_, index) => hullSection(index, false));
  const inner = HULL_SECTIONS.map((_, index) => hullSection(index, true));
  const last = outer.length - 1;
  for (let section = 0; section < last; section++) {
    for (let panel = 0; panel < 5; panel++) {
      quad(outer[section][panel], outer[section][panel + 1],
        outer[section + 1][panel + 1], outer[section + 1][panel]);
      quad(inner[section][panel + 1], inner[section][panel],
        inner[section + 1][panel], inner[section + 1][panel + 1]);
    }
    // Seal the tops of both side walls without covering the cockpit.
    quad(outer[section][0], outer[section + 1][0], inner[section + 1][0], inner[section][0]);
    quad(outer[section + 1][5], outer[section][5], inner[section][5], inner[section + 1][5]);
  }
  for (let panel = 1; panel < 5; panel++) {
    triangle(outer[0][0], outer[0][panel + 1], outer[0][panel]);
    triangle(inner[0][0], inner[0][panel], inner[0][panel + 1]);
    triangle(outer[last][0], outer[last][panel], outer[last][panel + 1]);
    triangle(inner[last][0], inner[last][panel + 1], inner[last][panel]);
  }
  quad(outer[0][5], outer[0][0], inner[0][0], inner[0][5]);
  quad(outer[last][0], outer[last][5], inner[last][5], inner[last][0]);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  // Separate face vertices preserve the hard chines and the transom edges.
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  // addMesh supplies the shared timber's metre-based UVs and weathering.
  return geometry;
}

function addBoatMember(
  boat: THREE.Group,
  name: string,
  start: THREE.Vector3,
  end: THREE.Vector3,
  width: number,
  depth: number,
): void {
  const direction = end.clone().sub(start);
  const member = addMesh(boat, new THREE.BoxGeometry(width, direction.length() + 0.025, depth),
    timberMaterial('dark'), start.clone().add(end).multiplyScalar(0.5));
  member.name = name;
  member.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
}

export function createFishingBoatMesh(): THREE.Group {
  const boat = new THREE.Group();
  boat.name = 'Pulled-up fishing boat';
  addMesh(boat, createHullGeometry(), timberMaterial('weathered'), new THREE.Vector3())
    .name = 'Fishing boat closed hull';

  // Gunwales follow the same sheer as the hull; ribs follow its inner lining.
  for (let index = 0; index < HULL_SECTIONS.length - 1; index++) {
    for (const side of [0, 5]) {
      const start = hullSection(index, false)[side];
      const end = hullSection(index + 1, false)[side];
      addBoatMember(boat, 'Fishing boat gunwale', start, end, 0.09, 0.09);
    }
  }
  for (const index of [2, 4, 6]) {
    const section = hullSection(index, true);
    for (let panel = 0; panel < 5; panel++) {
      addBoatMember(boat, 'Fishing boat interior rib', section[panel], section[panel + 1], 0.055, 0.065);
    }
  }
  for (const index of [2, 5]) {
    const section = HULL_SECTIONS[index];
    addMesh(boat, new THREE.BoxGeometry((section.halfWidth - HULL_WALL_THICKNESS) * 1.85, 0.09, 0.3),
      timberMaterial('mid'), new THREE.Vector3(0, section.rim - 0.17, section.z))
      .name = 'Fishing boat bench seat';
  }
  return boat;
}
