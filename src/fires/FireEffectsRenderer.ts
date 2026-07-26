import * as THREE from 'three';
import type { Terrain } from '../terrain/Terrain.ts';
import type { BuildingState, ResidenceState } from '../resources/types.ts';
import type { DeliveryTripState } from '../logistics/deliveryTrips.ts';
import type { FireIncidentState } from './fireIncident.ts';
import { hashStringSeed } from '../utils/random.ts';

type FireVisual = {
  root: THREE.Group;
  flames: THREE.Mesh[];
  smoke: THREE.Mesh[];
  rubble: THREE.Mesh[];
  light: THREE.PointLight;
  incident: FireIncidentState;
  phase: number;
};

type WaterJetVisual = {
  root: THREE.Group;
  stream: THREE.Mesh;
  droplets: THREE.Mesh[];
  phase: number;
  length: number;
};

const FLAME_GEOMETRY = new THREE.ConeGeometry(0.42, 1.7, 7);
const SMOKE_GEOMETRY = new THREE.SphereGeometry(0.58, 7, 5);
const RUBBLE_GEOMETRY = new THREE.BoxGeometry(1, 1, 1);
const DROPLET_GEOMETRY = new THREE.SphereGeometry(0.065, 6, 4);
const STREAM_GEOMETRY = new THREE.CylinderGeometry(0.035, 0.065, 1, 7);
const FLAME_OUTER = new THREE.MeshBasicMaterial({
  color: 0xf05a20,
  transparent: true,
  opacity: 0.72,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
});
const FLAME_INNER = new THREE.MeshBasicMaterial({
  color: 0xffd35a,
  transparent: true,
  opacity: 0.82,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
});
const SMOKE_MATERIAL = new THREE.MeshLambertMaterial({
  color: 0x2e3032,
  transparent: true,
  opacity: 0.34,
  depthWrite: false,
});
const RUBBLE_MATERIAL = new THREE.MeshStandardMaterial({
  color: 0x24211e,
  roughness: 1,
  metalness: 0,
});
const WATER_MATERIAL = new THREE.MeshBasicMaterial({
  color: 0x78c9ee,
  transparent: true,
  opacity: 0.68,
  depthWrite: false,
});

export class FireEffectsRenderer {
  private readonly terrain: Terrain;
  private readonly root = new THREE.Group();
  private readonly visuals = new Map<string, FireVisual>();
  private readonly waterJets = new Map<string, WaterJetVisual>();
  private incidents = new Map<string, FireIncidentState>();
  private trips = new Map<string, DeliveryTripState>();

  constructor(terrain: Terrain, parent: THREE.Group) {
    this.terrain = terrain;
    this.root.name = 'Structural fire and firefighting effects';
    parent.add(this.root);
  }

  syncIncidents(
    incidents: Iterable<FireIncidentState>,
    buildings: ReadonlyMap<string, BuildingState>,
    residences: ReadonlyMap<string, ResidenceState>,
  ): void {
    const list = [...incidents];
    this.incidents = new Map(list.map((incident) => [incident.id, incident]));
    const nextIds = new Set<string>();

    for (const incident of list) {
      nextIds.add(incident.id);
      let visual = this.visuals.get(incident.id);
      if (!visual) {
        visual = this.createFireVisual(incident);
        this.visuals.set(incident.id, visual);
        this.root.add(visual.root);
      }
      visual.incident = incident;
      const y = this.terrain.getHeightAt(incident.x, incident.z);
      const structureHeight = fireEffectHeight(incident, buildings, residences);
      visual.root.position.set(
        incident.x,
        y + (incident.status === 'burning' ? structureHeight : 0.75),
        incident.z,
      );
      this.applyIncidentState(visual);
    }

    for (const [id, visual] of this.visuals) {
      if (nextIds.has(id)) continue;
      visual.root.removeFromParent();
      disposeFireVisual(visual);
      this.visuals.delete(id);
    }
  }

  syncTrips(trips: Iterable<DeliveryTripState>): void {
    this.trips = new Map([...trips].map((trip) => [trip.id, trip]));
  }

  tick(dt: number): void {
    for (const visual of this.visuals.values()) {
      if (visual.incident.status !== 'burning') continue;
      visual.phase += dt;
      const { incident } = visual;
      const intensity = THREE.MathUtils.clamp(incident.intensity, 0, 1);
      for (const [index, flame] of visual.flames.entries()) {
        const flicker = 0.84
          + Math.sin(visual.phase * (7.5 + index * 0.8) + index * 2.17) * 0.14
          + Math.sin(visual.phase * 13.1 + index) * 0.05;
        flame.scale.y = Math.max(0.05, (0.5 + intensity * 1.15) * flicker);
        flame.scale.x = 0.72 + intensity * 0.68 + (1 - flicker) * 0.3;
        flame.scale.z = flame.scale.x;
      }
      for (const [index, smoke] of visual.smoke.entries()) {
        const age = (visual.phase * (0.12 + intensity * 0.16) + index / visual.smoke.length) % 1;
        smoke.position.y = 1.2 + age * (4.5 + intensity * 3.2);
        smoke.position.x = Math.sin(age * 4.1 + index * 2.3) * (0.35 + age * 1.4);
        smoke.position.z = Math.cos(age * 3.6 + index * 1.7) * (0.28 + age * 1.1);
        smoke.scale.setScalar(0.55 + age * 1.6 + intensity * 0.45);
        const material = smoke.material as THREE.MeshLambertMaterial;
        material.opacity = 0.34 * Math.sin(Math.PI * age);
      }
      visual.light.intensity = 5 + intensity * 12 + Math.sin(visual.phase * 11.3) * 1.8;
    }
    this.syncWaterJets();
    for (const jet of this.waterJets.values()) {
      jet.phase += dt;
      for (const [index, droplet] of jet.droplets.entries()) {
        const t = (jet.phase * 1.8 + index / jet.droplets.length) % 1;
        droplet.position.set(0, (t - 0.5) * jet.length, Math.sin(t * Math.PI) * 0.15);
      }
    }
  }

  dispose(): void {
    for (const visual of this.visuals.values()) disposeFireVisual(visual);
    this.visuals.clear();
    for (const jet of this.waterJets.values()) jet.root.removeFromParent();
    this.waterJets.clear();
    this.root.removeFromParent();
    FLAME_GEOMETRY.dispose();
    SMOKE_GEOMETRY.dispose();
    RUBBLE_GEOMETRY.dispose();
    DROPLET_GEOMETRY.dispose();
    STREAM_GEOMETRY.dispose();
    FLAME_OUTER.dispose();
    FLAME_INNER.dispose();
    SMOKE_MATERIAL.dispose();
    RUBBLE_MATERIAL.dispose();
    WATER_MATERIAL.dispose();
  }

  private createFireVisual(incident: FireIncidentState): FireVisual {
    const root = new THREE.Group();
    root.name = `Fire incident ${incident.id}`;
    const seed = hashStringSeed(incident.id);
    const flames: THREE.Mesh[] = [];
    const smoke: THREE.Mesh[] = [];
    const rubble: THREE.Mesh[] = [];

    for (let index = 0; index < 7; index++) {
      const angle = index / 7 * Math.PI * 2 + (seed % 37) * 0.07;
      const radius = index === 0 ? 0 : 0.45 + (index % 3) * 0.32;
      const flame = new THREE.Mesh(
        FLAME_GEOMETRY,
        index % 3 === 0 ? FLAME_INNER : FLAME_OUTER,
      );
      flame.name = 'Animated structural flame';
      flame.position.set(Math.cos(angle) * radius, 0.85, Math.sin(angle) * radius);
      flame.rotation.y = angle;
      flame.renderOrder = 18;
      root.add(flame);
      flames.push(flame);
    }

    for (let index = 0; index < 9; index++) {
      const puff = new THREE.Mesh(SMOKE_GEOMETRY, SMOKE_MATERIAL.clone());
      puff.name = 'Animated structural smoke';
      puff.renderOrder = 17;
      root.add(puff);
      smoke.push(puff);
    }

    for (let index = 0; index < 8; index++) {
      const angle = index / 8 * Math.PI * 2 + 0.4;
      const piece = new THREE.Mesh(RUBBLE_GEOMETRY, RUBBLE_MATERIAL);
      piece.name = 'Fire-damaged rubble';
      piece.position.set(Math.cos(angle) * (1 + index % 2), -0.65, Math.sin(angle) * (1 + index % 2));
      piece.rotation.set(index * 0.22, angle, index * 0.17);
      piece.scale.set(0.8 + index % 3 * 0.3, 0.22 + index % 2 * 0.18, 0.55 + index % 4 * 0.18);
      root.add(piece);
      rubble.push(piece);
    }

    const light = new THREE.PointLight(0xff6a2b, 10, 28, 1.65);
    light.name = 'Fire glow';
    light.position.y = 1.2;
    root.add(light);

    return { root, flames, smoke, rubble, light, incident, phase: (seed % 100) / 10 };
  }

  private applyIncidentState(visual: FireVisual): void {
    const burning = visual.incident.status === 'burning';
    const destroyed = visual.incident.status === 'destroyed';
    for (const flame of visual.flames) flame.visible = burning;
    for (const puff of visual.smoke) {
      puff.visible = burning;
    }
    if (!burning) {
      // Resolved incidents persist until repair, so retire their animated
      // particles instead of paying the per-frame and object cost forever.
      for (const flame of visual.flames) flame.removeFromParent();
      visual.flames.length = 0;
      for (const puff of visual.smoke) {
        puff.removeFromParent();
        (puff.material as THREE.Material).dispose();
      }
      visual.smoke.length = 0;
      visual.light.intensity = 0;
      visual.light.removeFromParent();
    }
    const visibleRubble = destroyed
      ? visual.rubble.length
      : Math.max(1, Math.ceil(visual.incident.damage * visual.rubble.length));
    for (const [index, rubble] of visual.rubble.entries()) {
      rubble.visible = !burning && index < visibleRubble;
    }
  }

  private syncWaterJets(): void {
    const activeIds = new Set<string>();
    for (const trip of this.trips.values()) {
      if (trip.destinationKind !== 'fire' || trip.phase !== 'unloading') continue;
      const incident = [...this.incidents.values()].find((candidate) =>
        (trip.targetBuildingId && candidate.targetKind === 'building'
          && candidate.targetId === trip.targetBuildingId)
        || (trip.residenceId && candidate.targetKind === 'residence'
          && candidate.targetId === trip.residenceId));
      if (!incident || incident.status !== 'burning') continue;
      activeIds.add(trip.id);
      let jet = this.waterJets.get(trip.id);
      if (!jet) {
        jet = this.createWaterJet();
        this.waterJets.set(trip.id, jet);
        this.root.add(jet.root);
      }
      const start = new THREE.Vector3(
        trip.x,
        this.terrain.getHeightAt(trip.x, trip.z) + 1.1,
        trip.z,
      );
      const fireVisual = this.visuals.get(incident.id);
      const end = fireVisual
        ? fireVisual.root.position.clone().add(new THREE.Vector3(0, 0.8, 0))
        : new THREE.Vector3(incident.x, this.terrain.getHeightAt(incident.x, incident.z) + 4, incident.z);
      orientCylinderBetween(jet, start, end);
    }
    for (const [id, jet] of this.waterJets) {
      if (activeIds.has(id)) continue;
      jet.root.removeFromParent();
      this.waterJets.delete(id);
    }
  }

  private createWaterJet(): WaterJetVisual {
    const root = new THREE.Group();
    root.name = 'Visible bucket-water suppression';
    const stream = new THREE.Mesh(STREAM_GEOMETRY, WATER_MATERIAL);
    stream.renderOrder = 19;
    root.add(stream);
    const droplets: THREE.Mesh[] = [];
    for (let index = 0; index < 8; index++) {
      const droplet = new THREE.Mesh(DROPLET_GEOMETRY, WATER_MATERIAL);
      droplet.renderOrder = 19;
      root.add(droplet);
      droplets.push(droplet);
    }
    return { root, stream, droplets, phase: 0, length: 1 };
  }
}

function fireEffectHeight(
  incident: FireIncidentState,
  buildings: ReadonlyMap<string, BuildingState>,
  residences: ReadonlyMap<string, ResidenceState>,
): number {
  if (incident.targetKind === 'residence') {
    const tier = residences.get(incident.targetId)?.tier ?? 1;
    return 3.6 + tier * 0.7;
  }
  const building = buildings.get(incident.targetId);
  if (!building) return 4;
  return THREE.MathUtils.clamp(3.2 + Math.sqrt(Math.max(0, building.workRadius)) * 0.16, 3.4, 7);
}

function orientCylinderBetween(
  jet: WaterJetVisual,
  start: THREE.Vector3,
  end: THREE.Vector3,
): void {
  const direction = end.clone().sub(start);
  const length = Math.max(0.1, direction.length());
  jet.length = length;
  jet.root.position.copy(start).add(end).multiplyScalar(0.5);
  jet.root.scale.set(1, 1, 1);
  jet.stream.scale.set(1, length, 1);
  jet.root.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    direction.normalize(),
  );
}

function disposeFireVisual(visual: FireVisual): void {
  for (const smoke of visual.smoke) {
    (smoke.material as THREE.Material).dispose();
  }
  visual.root.removeFromParent();
}
