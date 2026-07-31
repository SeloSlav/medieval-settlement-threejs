import * as THREE from 'three';
import type { Terrain } from '../terrain/Terrain.ts';
import type { BuildingState, ResidenceState } from '../resources/types.ts';
import type { DeliveryTripState } from '../logistics/deliveryTrips.ts';
import type { FireIncidentState } from './fireIncident.ts';
import { hashStringSeed } from '../utils/random.ts';
import { getBuildingDefinition } from '../resources/buildings.ts';
import {
  createFireEffect,
  disposeFireEffect,
  setFireEffectActive,
  updateFireEffect,
  type FireEffect,
} from './FireEffect.ts';

type FireVisual = {
  root: THREE.Group;
  effect: FireEffect;
  rubbleRoot: THREE.Group;
  rubble: THREE.Mesh[];
  incident: FireIncidentState;
};

type WaterJetVisual = {
  root: THREE.Group;
  stream: THREE.Mesh;
  droplets: THREE.Mesh[];
  phase: number;
  length: number;
};

const RUBBLE_GEOMETRY = new THREE.BoxGeometry(1, 1, 1);
const DROPLET_GEOMETRY = new THREE.SphereGeometry(0.065, 6, 4);
const STREAM_GEOMETRY = new THREE.CylinderGeometry(0.035, 0.065, 1, 7);
const RUBBLE_MATERIAL = new THREE.MeshStandardMaterial({
  color: 0x544c43,
  roughness: 1,
  metalness: 0,
});
const CHARRED_TIMBER_MATERIAL = new THREE.MeshStandardMaterial({
  color: 0x1c1815,
  roughness: 0.96,
  metalness: 0,
});
const ASH_MATERIAL = new THREE.MeshStandardMaterial({
  color: 0x302b27,
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
      const rubbleScale = fireRubbleScale(incident, buildings, residences);
      visual.rubbleRoot.scale.set(rubbleScale, 1, rubbleScale);
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
      const { incident } = visual;
      const intensity = THREE.MathUtils.clamp(incident.intensity, 0, 1);
      updateFireEffect(visual.effect, dt, intensity);
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
    RUBBLE_GEOMETRY.dispose();
    DROPLET_GEOMETRY.dispose();
    STREAM_GEOMETRY.dispose();
    RUBBLE_MATERIAL.dispose();
    CHARRED_TIMBER_MATERIAL.dispose();
    ASH_MATERIAL.dispose();
    WATER_MATERIAL.dispose();
  }

  private createFireVisual(incident: FireIncidentState): FireVisual {
    const root = new THREE.Group();
    root.name = `Fire incident ${incident.id}`;
    const seed = hashStringSeed(incident.id);
    const rubbleRoot = new THREE.Group();
    rubbleRoot.name = 'Collapsed structural ruin';
    const rubble: THREE.Mesh[] = [];
    const effect = createFireEffect({
      name: 'Reusable structural fire',
      scale: 1.45,
      intensity: incident.intensity,
      nightLighting: 1,
      spread: 1.05,
      flameCount: 8,
      smokeCount: 10,
      smokeRise: 5.8,
      smokeDrift: 1.25,
      smokeOpacity: 0.38,
      lightDistance: 28,
      lightIntensity: 17,
    });
    root.add(effect.root);
    root.add(rubbleRoot);

    const foundation = new THREE.Mesh(RUBBLE_GEOMETRY, ASH_MATERIAL);
    foundation.name = 'Scorched collapsed foundation';
    foundation.position.y = -0.7;
    foundation.scale.set(3.8, 0.12, 3.1);
    rubbleRoot.add(foundation);
    rubble.push(foundation);

    for (let index = 0; index < 16; index++) {
      const angle = index / 16 * Math.PI * 2
        + seededUnit(seed, index) * 0.42;
      const distance = 0.65 + seededUnit(seed, index + 31) * 1.65;
      const charredBeam = index % 3 === 0;
      const piece = new THREE.Mesh(
        RUBBLE_GEOMETRY,
        charredBeam ? CHARRED_TIMBER_MATERIAL : RUBBLE_MATERIAL,
      );
      piece.name = charredBeam ? 'Collapsed charred beam' : 'Fire-damaged masonry rubble';
      piece.position.set(
        Math.cos(angle) * distance,
        -0.58 + seededUnit(seed, index + 61) * 0.18,
        Math.sin(angle) * distance,
      );
      piece.rotation.set(
        seededUnit(seed, index + 91) * 0.55,
        angle + seededUnit(seed, index + 121) * 0.8,
        seededUnit(seed, index + 151) * 0.48,
      );
      piece.scale.set(
        charredBeam ? 1.8 + seededUnit(seed, index + 181) * 1.2 : 0.65 + index % 4 * 0.22,
        charredBeam ? 0.16 : 0.2 + index % 2 * 0.14,
        charredBeam ? 0.22 : 0.5 + index % 3 * 0.2,
      );
      rubbleRoot.add(piece);
      rubble.push(piece);
    }

    effect.elapsedSeconds = (seed % 100) / 10;
    return { root, effect, rubbleRoot, rubble, incident };
  }

  private applyIncidentState(visual: FireVisual): void {
    const burning = visual.incident.status === 'burning';
    const destroyed = visual.incident.status === 'destroyed';
    setFireEffectActive(visual.effect, burning);
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

function fireRubbleScale(
  incident: FireIncidentState,
  buildings: ReadonlyMap<string, BuildingState>,
  residences: ReadonlyMap<string, ResidenceState>,
): number {
  if (incident.targetKind === 'residence') {
    const tier = residences.get(incident.targetId)?.tier ?? 1;
    return 1.15 + tier * 0.12;
  }
  const building = buildings.get(incident.targetId);
  if (!building) return 1.4;
  return THREE.MathUtils.clamp(
    getBuildingDefinition(building.kind).pickRadius / 4.5,
    1.25,
    2.8,
  );
}

function seededUnit(seed: number, index: number): number {
  let value = (seed ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d) >>> 0;
  value ^= value >>> 15;
  return value / 0x1_0000_0000;
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
  disposeFireEffect(visual.effect);
  visual.root.removeFromParent();
}
