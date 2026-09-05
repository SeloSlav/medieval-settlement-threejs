import * as THREE from 'three';
import { createPreferredRenderer } from '../scene/RendererBackend.ts';
import { createBuildingMesh } from '../buildings/BuildingMeshes.ts';
import { initializeBuildingMaterialLibrary } from '../buildings/buildingMaterials.ts';
import { batchCompletedBuildingStaticMeshes } from '../buildings/staticBuildingBatch.ts';
import { BuildingStaticBatches } from '../buildings/BuildingStaticBatches.ts';
import { ResidenceMarkers } from '../residences/ResidenceMarkers.ts';
import { createDefaultNeeds } from '../residences/residenceNeedState.ts';
import { SettlementCrowdRenderer, type CrowdRenderAgent } from '../settlement/SettlementCrowdRenderer.ts';
import { AnimalCombatRenderer, type AnimalCombatPose } from '../settlement/AnimalCombatRenderer.ts';

/** Offline renderer fixture: original assets, no server or save mutations. */
export async function createCityScaleFixture() {
  const backend = await createPreferredRenderer();
  const renderer = backend.renderer;
  renderer.setSize(1280, 720);
  renderer.setPixelRatio(1);
  document.body.style.margin = '0';
  document.body.append(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x99b5c8);
  scene.add(new THREE.HemisphereLight(0xd9e8ec, 0x59634f, 1.55));
  const sun = new THREE.DirectionalLight(0xffefd2, 5.2);
  sun.position.set(30, 55, 20);
  scene.add(sun);
  const camera = new THREE.PerspectiveCamera(45, 1280 / 720, 0.1, 2000);
  const structures = new THREE.Group();
  const people = new THREE.Group();
  const animals = new THREE.Group();
  scene.add(structures, people, animals);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(2000, 2000), new THREE.MeshStandardMaterial({ color: 0x697b47, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.03;
  scene.add(ground);
  await initializeBuildingMaterialLibrary(backend.maxAnisotropy);
  let batches = new BuildingStaticBatches(structures);
  let homes = new ResidenceMarkers(structures);
  const crowd = new SettlementCrowdRenderer({ parent: people });
  const dogs = new AnimalCombatRenderer(animals);
  if (!(await crowd.ready) || !(await dogs.ready)) throw new Error('Authored actors did not load');
  const agents: CrowdRenderAgent[] = [];
  const dogPoses: AnimalCombatPose[] = [];
  let elapsed = 0;
  let extent = 30;
  const view = { centerX: 0, centerZ: 0, viewRadius: 1500, orbitDistance: 80, peopleVisible: true, animalsVisible: true };
  function cameraView(angle = 0.7, distance = extent * 2.3) {
    camera.position.set(Math.sin(angle) * distance, distance * 0.65, Math.cos(angle) * distance);
    camera.lookAt(0, 1, 0);
    camera.updateMatrixWorld(true);
  }
  function configure(buildings: number, residences: number, population: number, dogCount: number) {
    batches.dispose();
    homes.dispose();
    structures.clear();
    batches = new BuildingStaticBatches(structures);
    homes = new ResidenceMarkers(structures);
    const columns = Math.ceil(Math.sqrt(buildings + residences));
    extent = Math.max(20, columns * 9);
    const position = (i: number) => ({ x: (i % columns - (columns - 1) / 2) * 18, z: (Math.floor(i / columns) - (columns - 1) / 2) * 18 });
    const kinds = ['stable', 'carpenter', 'smokehouse', 'weaver', 'potter_kiln', 'bakery'] as const;
    for (let i = 0; i < buildings; i++) {
      const marker = createBuildingMesh(kinds[i % kinds.length]!);
      const p = position(i);
      marker.position.set(p.x, 0, p.z);
      structures.add(marker);
      batchCompletedBuildingStaticMeshes(marker);
      batches.registerBuilding(`building-${i}`, marker);
    }
    batches.finalizeGeometryBuffers();
    homes.syncResidences(Array.from({ length: residences }, (_, i) => ({
      id: `home-${i}`, zoneId: 'fixture', parcelIndex: i, ...position(i + buildings), yaw: 0,
      population: 4, populationCapacity: 6, tier: 1 as const, settlementTicks: 0,
      needs: createDefaultNeeds(), abandoned: false, householdWealth: 8,
    })), () => 0);
    agents.length = 0;
    for (let i = 0; i < population; i++) agents.push({
      id: `person-${i}`, slot: i, x: 0, y: 0, z: 0, yaw: 0, appearanceSeed: i + 1,
      variant: i % 2 ? 'woman' : 'man', mode: 'walk', tunicColor: 0x76533a,
      skinColor: 0xc9946a, hairColor: 0x35251c, tool: null, movementSpeed: 1, active: true,
    });
    dogPoses.length = 0;
    for (let i = 0; i < dogCount; i++) dogPoses.push({ id: `dog-${i}`, faction: 'dog', x: i * 2, y: 0, z: 3, yaw: 0, moveSpeed: 1, status: 'advancing' });
    elapsed = 0;
    cameraView();
  }
  function update(dt: number) {
    elapsed += dt;
    for (let i = 0; i < agents.length; i++) {
      const agent = agents[i]!;
      agent.x = (i % 32 - 16) * 1.3 + Math.sin(elapsed * .15) * 4;
      agent.z = (Math.floor(i / 32) - 4) * 1.4;
      agent.yaw = Math.PI / 2;
    }
    const start = performance.now();
    crowd.syncAgents(agents, view, dt);
    const peopleMs = performance.now() - start;
    dogs.sync(dogPoses, view, dt);
    const dogsMs = performance.now() - start - peopleMs;
    return { peopleMs, dogsMs };
  }
  function render() { renderer.info.reset(); renderer.render(scene, camera); }
  return { scene, renderer, camera, structures, people, animals, configure, update, render, cameraView,
    stats: () => ({ buildings: batches.getStats(), crowd: crowd.authoredCrowdDiagnostics(), dogs: dogs.diagnostics(), render: { ...renderer.info.render }, adapter: backend.adapterEvidence }),
  };
}
