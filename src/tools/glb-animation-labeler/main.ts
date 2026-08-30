import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
  normalizeAnimationLabel,
  readGlbAnimationNames,
  rewriteGlbAnimationNames,
  validateAnimationLabels,
} from './glbBinary.ts';
import {
  countUnassignedAnimationLabels,
  getAvailableAnimationLabels,
  selectAnimationLabelCatalog,
} from './labelChoices.ts';
import './style.css';

const RECOMMENDED_LABELS = [
  'agree',
  'bow',
  'cheer',
  'chop',
  'clap',
  'cry',
  'dig',
  'fall',
  'flee_01',
  'greet_01',
  'greet_04',
  'hit_to_body_01',
  'idle',
  'laugh_01',
  'lift_heavy',
  'look_around',
  'run',
  'shovel',
  'sit',
  'slash',
  'standing_relax',
  'wait',
  'walk',
] as const;

const SOCIAL_LABELS_REMOVED_FROM_V002 = new Set<string>([
  'agree',
  'bow',
  'cheer',
  'clap',
  'cry',
  'greet_01',
  'laugh_01',
]);

type StoredMapping = {
  version: 1;
  digest: string;
  sourceFile: string;
  labels: string[];
  updatedAt: string;
};

type LoadedAsset = {
  file: File;
  bytes: ArrayBuffer;
  digest: string;
  gltf: GLTF;
  originalNames: string[];
  recommendedLabels: string[];
  labels: string[];
};

const root = mustElement<HTMLDivElement>('animation-labeler-root');
const fileInput = mustElement<HTMLInputElement>('glb-file');
const canvas = mustElement<HTMLCanvasElement>('viewer-canvas');
const viewerHost = mustElement<HTMLDivElement>('viewer-host');
const emptyState = mustElement<HTMLDivElement>('empty-state');
const busyState = mustElement<HTMLDivElement>('viewer-busy');
const currentClipLabel = mustElement<HTMLElement>('current-clip');
const clipPosition = mustElement<HTMLElement>('clip-position');
const timeline = mustElement<HTMLInputElement>('timeline');
const previousButton = mustElement<HTMLButtonElement>('previous-clip');
const restartButton = mustElement<HTMLButtonElement>('restart-clip');
const playButton = mustElement<HTMLButtonElement>('toggle-play');
const nextButton = mustElement<HTMLButtonElement>('next-clip');
const speedSelect = mustElement<HTMLSelectElement>('playback-speed');
const loopCheckbox = mustElement<HTMLInputElement>('loop-clip');
const skeletonCheckbox = mustElement<HTMLInputElement>('show-skeleton');
const resetCameraButton = mustElement<HTMLButtonElement>('reset-camera');
const semanticNameSelect = mustElement<HTMLSelectElement>('semantic-name');
const saveAndNextButton = mustElement<HTMLButtonElement>('save-and-next');
const unbindNameButton = mustElement<HTMLButtonElement>('unbind-name');
const saveProgressButton = mustElement<HTMLButtonElement>('save-progress');
const mappingProgress = mustElement<HTMLElement>('mapping-progress');
const animationCount = mustElement<HTMLElement>('animation-count');
const animationList = mustElement<HTMLOListElement>('animation-list');
const remainingNameCount = mustElement<HTMLElement>('remaining-name-count');
const downloadMapButton = mustElement<HTMLButtonElement>('download-map');
const downloadGlbButton = mustElement<HTMLButtonElement>('download-glb');
const fileSummary = mustElement<HTMLElement>('file-summary');
const status = mustElement<HTMLElement>('tool-status');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1b1e1a);
scene.fog = new THREE.Fog(0x1b1e1a, 8, 18);

const camera = new THREE.PerspectiveCamera(34, 1, 0.01, 100);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 0.7;
controls.maxDistance = 12;

const hemisphere = new THREE.HemisphereLight(0xdde5d2, 0x514632, 2.1);
scene.add(hemisphere);
const keyLight = new THREE.DirectionalLight(0xffe2ad, 4.2);
keyLight.position.set(3, 5, 4);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(1024, 1024);
scene.add(keyLight);
const fillLight = new THREE.DirectionalLight(0x9db4d2, 1.7);
fillLight.position.set(-4, 2.5, 1);
scene.add(fillLight);

const stage = new THREE.Group();
scene.add(stage);
const grid = new THREE.GridHelper(12, 24, 0x5d624f, 0x33372f);
grid.position.y = -0.002;
stage.add(grid);
const floor = new THREE.Mesh(
  new THREE.CircleGeometry(5.5, 96),
  new THREE.MeshStandardMaterial({ color: 0x20231d, roughness: 1, metalness: 0 }),
);
floor.rotation.x = -Math.PI / 2;
floor.position.y = -0.006;
floor.receiveShadow = true;
stage.add(floor);

let asset: LoadedAsset | null = null;
let model: THREE.Object3D | null = null;
let mixer: THREE.AnimationMixer | null = null;
let action: THREE.AnimationAction | null = null;
let skeletonHelper: THREE.SkeletonHelper | null = null;
let selectedClipIndex = -1;
let playing = true;
let timelineDragging = false;
let defaultCameraPosition = new THREE.Vector3(1.4, 0.95, 2.3);
let defaultCameraTarget = new THREE.Vector3(0, 0.5, 0);

fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (file) void loadFile(file);
});
previousButton.addEventListener('click', () => selectClip(selectedClipIndex - 1));
nextButton.addEventListener('click', () => selectClip(selectedClipIndex + 1));
restartButton.addEventListener('click', restartClip);
playButton.addEventListener('click', togglePlayback);
speedSelect.addEventListener('change', syncPlaybackSpeed);
loopCheckbox.addEventListener('change', syncLoopMode);
skeletonCheckbox.addEventListener('change', syncSkeletonVisibility);
resetCameraButton.addEventListener('click', resetCamera);
saveProgressButton.addEventListener('click', () => saveProgress(true));
saveAndNextButton.addEventListener('click', saveCurrentAndAdvance);
unbindNameButton.addEventListener('click', unbindCurrentName);
downloadMapButton.addEventListener('click', downloadMapping);
downloadGlbButton.addEventListener('click', downloadLabeledGlb);
semanticNameSelect.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') saveCurrentAndAdvance();
});
timeline.addEventListener('pointerdown', () => {
  timelineDragging = true;
});
timeline.addEventListener('pointerup', () => {
  timelineDragging = false;
});
timeline.addEventListener('input', () => {
  if (!action) return;
  action.time = Number.parseFloat(timeline.value);
  mixer?.update(0);
  updateTimeReadout();
});
window.addEventListener('keydown', (event) => {
  const target = event.target as HTMLElement | null;
  if (target?.matches('input, select, textarea, button')) return;
  if (event.code === 'Space') {
    event.preventDefault();
    togglePlayback();
  } else if (event.code === 'ArrowLeft') {
    selectClip(selectedClipIndex - 1);
  } else if (event.code === 'ArrowRight') {
    selectClip(selectedClipIndex + 1);
  }
});

const resizeObserver = new ResizeObserver(resizeRenderer);
resizeObserver.observe(viewerHost);

const timer = new THREE.Timer();
timer.connect(document);
renderer.setAnimationLoop((timestamp) => {
  timer.update(timestamp);
  const delta = Math.min(0.05, timer.getDelta());
  if (mixer && playing) mixer.update(delta);
  if (!timelineDragging) updateTimeReadout();
  controls.update();
  renderer.render(scene, camera);
});
window.addEventListener('beforeunload', () => timer.dispose(), { once: true });
resetCamera();

async function loadFile(file: File): Promise<void> {
  setBusy(true);
  setStatus(`Reading ${file.name}…`);
  try {
    const bytes = await file.arrayBuffer();
    const originalNames = readGlbAnimationNames(bytes);
    if (originalNames.length === 0) throw new Error('This GLB does not contain any animations.');
    const digest = await sha256(bytes);
    const gltf = await new GLTFLoader().parseAsync(bytes.slice(0), '');
    if (gltf.animations.length !== originalNames.length) {
      throw new Error('The GLB animation metadata does not match the loaded scene.');
    }
    const labels = loadStoredLabels(digest, originalNames.length);
    const recommendedLabels = selectAnimationLabelCatalog(
      RECOMMENDED_LABELS,
      SOCIAL_LABELS_REMOVED_FROM_V002,
      originalNames.length,
    );

    disposeLoadedModel();
    asset = {
      file,
      bytes,
      digest,
      gltf,
      originalNames,
      recommendedLabels,
      labels,
    };
    model = gltf.scene;
    prepareModel(model);
    stage.add(model);
    mixer = new THREE.AnimationMixer(model);
    skeletonHelper = new THREE.SkeletonHelper(model);
    skeletonHelper.visible = skeletonCheckbox.checked;
    const helperMaterials = Array.isArray(skeletonHelper.material)
      ? skeletonHelper.material
      : [skeletonHelper.material];
    helperMaterials.forEach((material) => {
      material.depthTest = false;
    });
    skeletonHelper.renderOrder = 10;
    stage.add(skeletonHelper);
    frameModel(model);
    buildAnimationList();
    setControlsEnabled(true);
    selectClip(0);
    emptyState.hidden = true;
    fileSummary.textContent = `${file.name} · ${formatBytes(file.size)} · ${gltf.animations.length} animations`;
    setStatus(labels.some(Boolean) ? 'Restored saved labels for this exact GLB.' : 'Model loaded. Select a clip and identify its motion.');
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'Unable to load the GLB.', true);
  } finally {
    setBusy(false);
  }
}

function prepareModel(rootObject: THREE.Object3D): void {
  rootObject.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  });
  rootObject.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(rootObject);
  const center = bounds.getCenter(new THREE.Vector3());
  rootObject.position.x -= center.x;
  rootObject.position.y -= bounds.min.y;
  rootObject.position.z -= center.z;
  rootObject.updateMatrixWorld(true);
}

function frameModel(rootObject: THREE.Object3D): void {
  const bounds = new THREE.Box3().setFromObject(rootObject);
  const size = bounds.getSize(new THREE.Vector3());
  const height = Math.max(0.2, size.y);
  const radius = Math.max(height * 0.58, size.x, size.z, 0.5);
  defaultCameraTarget = new THREE.Vector3(0, height * 0.48, 0);
  defaultCameraPosition = new THREE.Vector3(radius * 1.55, height * 0.62, radius * 2.55);
  camera.near = Math.max(0.005, radius / 100);
  camera.far = Math.max(30, radius * 30);
  camera.updateProjectionMatrix();
  controls.minDistance = radius * 0.65;
  controls.maxDistance = radius * 9;
  resetCamera();
}

function disposeLoadedModel(): void {
  action?.stop();
  mixer?.stopAllAction();
  if (skeletonHelper) {
    stage.remove(skeletonHelper);
    skeletonHelper.geometry.dispose();
    const helperMaterials = Array.isArray(skeletonHelper.material)
      ? skeletonHelper.material
      : [skeletonHelper.material];
    helperMaterials.forEach((material) => material.dispose());
  }
  if (model) {
    stage.remove(model);
    model.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry.dispose();
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) {
        for (const value of Object.values(material)) {
          if (value instanceof THREE.Texture) value.dispose();
        }
        material.dispose();
      }
    });
  }
  model = null;
  mixer = null;
  action = null;
  skeletonHelper = null;
}

function selectClip(requestedIndex: number): void {
  if (!asset || !mixer) return;
  const count = asset.gltf.animations.length;
  const index = ((requestedIndex % count) + count) % count;
  action?.stop();
  selectedClipIndex = index;
  const clip = asset.gltf.animations[index]!;
  action = mixer.clipAction(clip);
  syncLoopMode();
  action.reset().play();
  action.paused = false;
  playing = true;
  playButton.textContent = 'Pause';
  timeline.max = String(clip.duration);
  timeline.value = '0';
  currentClipLabel.textContent = `#${index + 1} · ${asset.originalNames[index]}`;
  populateSemanticNameOptions(index);
  updateTimeReadout();
  renderAnimationSelection();
}

function populateSemanticNameOptions(clipIndex: number): void {
  if (!asset) return;
  const currentLabel = asset.labels[clipIndex] ?? '';
  const availableLabels = getAvailableAnimationLabels(
    asset.recommendedLabels,
    asset.labels,
    clipIndex,
  );

  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.disabled = true;
  placeholder.textContent = availableLabels.length === 1
    ? 'Select the final remaining name'
    : `Select one of ${availableLabels.length} available names`;
  semanticNameSelect.replaceChildren(placeholder);

  for (const label of availableLabels) {
    const option = document.createElement('option');
    option.value = label;
    option.textContent = label;
    semanticNameSelect.append(option);
  }

  semanticNameSelect.value = currentLabel;
  if (!currentLabel) placeholder.selected = true;
  unbindNameButton.disabled = !currentLabel;

  const remainingCount = Math.min(
    countUnassignedAnimationLabels(asset.recommendedLabels, asset.labels),
    asset.labels.filter((label) => !label).length,
  );
  remainingNameCount.textContent = remainingCount === 1
    ? '1 name remaining'
    : `${remainingCount} names remaining`;
}

function restartClip(): void {
  if (!action) return;
  action.reset().play();
  action.paused = !playing;
  updateTimeReadout();
}

function togglePlayback(): void {
  if (!action) return;
  playing = !playing;
  action.paused = !playing;
  playButton.textContent = playing ? 'Pause' : 'Play';
}

function syncPlaybackSpeed(): void {
  if (mixer) mixer.timeScale = Number.parseFloat(speedSelect.value);
}

function syncLoopMode(): void {
  if (!action) return;
  action.setLoop(loopCheckbox.checked ? THREE.LoopRepeat : THREE.LoopOnce, loopCheckbox.checked ? Infinity : 1);
  action.clampWhenFinished = !loopCheckbox.checked;
}

function syncSkeletonVisibility(): void {
  if (skeletonHelper) skeletonHelper.visible = skeletonCheckbox.checked;
}

function resetCamera(): void {
  camera.position.copy(defaultCameraPosition);
  controls.target.copy(defaultCameraTarget);
  controls.update();
}

function saveCurrentAndAdvance(): void {
  if (!asset || selectedClipIndex < 0) return;
  const normalized = normalizeAnimationLabel(semanticNameSelect.value);
  if (!normalized || !/^[a-z][a-z0-9_]*$/.test(normalized)) {
    setStatus('Choose one of the remaining animation names.', true);
    semanticNameSelect.focus();
    return;
  }
  const duplicateIndex = asset.labels.findIndex(
    (label, index) => index !== selectedClipIndex && label === normalized,
  );
  if (duplicateIndex >= 0) {
    setStatus(`${normalized} is already assigned to clip #${duplicateIndex + 1}.`, true);
    return;
  }
  asset.labels[selectedClipIndex] = normalized;
  semanticNameSelect.value = normalized;
  saveProgress(false);
  buildAnimationList();
  const nextUnnamed = findNextUnnamed(selectedClipIndex);
  if (nextUnnamed >= 0) {
    selectClip(nextUnnamed);
    setStatus(`Saved ${normalized}. Playing the next unnamed clip.`);
  } else {
    selectClip(selectedClipIndex);
    setStatus('All animations are named. The labeled GLB is ready to download.');
  }
}

function unbindCurrentName(): void {
  if (!asset || selectedClipIndex < 0) return;
  const releasedLabel = asset.labels[selectedClipIndex];
  if (!releasedLabel) {
    setStatus('This animation does not have a name to unbind.', true);
    return;
  }
  asset.labels[selectedClipIndex] = '';
  saveProgress(false);
  buildAnimationList();
  populateSemanticNameOptions(selectedClipIndex);
  semanticNameSelect.focus();
  setStatus(`Unbound ${releasedLabel}. It is available in the dropdown again.`);
}

function findNextUnnamed(fromIndex: number): number {
  if (!asset) return -1;
  for (let offset = 1; offset <= asset.labels.length; offset += 1) {
    const index = (fromIndex + offset) % asset.labels.length;
    if (!asset.labels[index]) return index;
  }
  return -1;
}

function saveProgress(announce: boolean): void {
  if (!asset) return;
  const mapping: StoredMapping = {
    version: 1,
    digest: asset.digest,
    sourceFile: asset.file.name,
    labels: [...asset.labels],
    updatedAt: new Date().toISOString(),
  };
  localStorage.setItem(storageKey(asset.digest), JSON.stringify(mapping));
  updateProgress();
  if (announce) setStatus('Label progress saved in this browser.');
}

function loadStoredLabels(digest: string, count: number): string[] {
  try {
    const raw = localStorage.getItem(storageKey(digest));
    if (!raw) return Array.from({ length: count }, () => '');
    const parsed = JSON.parse(raw) as Partial<StoredMapping>;
    if (parsed.version !== 1 || parsed.digest !== digest || parsed.labels?.length !== count) {
      return Array.from({ length: count }, () => '');
    }
    return parsed.labels.map((label) => normalizeAnimationLabel(label));
  } catch {
    return Array.from({ length: count }, () => '');
  }
}

function buildAnimationList(): void {
  animationList.replaceChildren();
  if (!asset) return;
  for (let index = 0; index < asset.gltf.animations.length; index += 1) {
    const clip = asset.gltf.animations[index]!;
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'animation-row';
    button.dataset.index = String(index);
    button.innerHTML = `
      <span class="animation-index">${String(index + 1).padStart(2, '0')}</span>
      <span class="animation-names">
        <strong>${escapeHtml(asset.labels[index] || 'Unnamed')}</strong>
        <span class="${asset.labels[index] ? '' : 'is-unassigned'}">${escapeHtml(asset.originalNames[index] ?? clip.name)}</span>
      </span>
      <span class="animation-duration">${clip.duration.toFixed(2)} s</span>
    `;
    button.addEventListener('click', () => selectClip(index));
    item.append(button);
    animationList.append(item);
  }
  animationCount.textContent = `${asset.gltf.animations.length} clips`;
  renderAnimationSelection();
  updateProgress();
}

function renderAnimationSelection(): void {
  for (const element of animationList.querySelectorAll<HTMLButtonElement>('.animation-row')) {
    element.classList.toggle('is-selected', Number(element.dataset.index) === selectedClipIndex);
  }
  animationList.querySelector<HTMLElement>(`.animation-row[data-index="${selectedClipIndex}"]`)
    ?.scrollIntoView({ block: 'nearest' });
}

function updateProgress(): void {
  if (!asset) {
    mappingProgress.textContent = '0 / 0 named';
    return;
  }
  const named = asset.labels.filter(Boolean).length;
  mappingProgress.textContent = `${named} / ${asset.labels.length} named`;
  const validation = validateAnimationLabels(asset.labels);
  downloadGlbButton.disabled = !validation.complete;
}

function downloadMapping(): void {
  if (!asset) return;
  const currentAsset = asset;
  saveProgress(false);
  const payload = {
    version: 1,
    sourceFile: currentAsset.file.name,
    sourceSha256: currentAsset.digest,
    generatedAt: new Date().toISOString(),
    animations: currentAsset.gltf.animations.map((clip, index) => ({
      index,
      originalName: currentAsset.originalNames[index],
      durationSeconds: Number(clip.duration.toFixed(6)),
      semanticName: currentAsset.labels[index] || null,
    })),
  };
  downloadBlob(
    new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }),
    `${fileStem(currentAsset.file.name)}-animation-map.json`,
  );
  setStatus('Animation mapping JSON downloaded.');
}

function downloadLabeledGlb(): void {
  if (!asset) return;
  const validation = validateAnimationLabels(asset.labels);
  if (!validation.complete) {
    setStatus(`Name all ${asset.labels.length} animations with unique semantic names first.`, true);
    return;
  }
  const labeled = rewriteGlbAnimationNames(asset.bytes, asset.labels);
  downloadBlob(
    new Blob([labeled], { type: 'model/gltf-binary' }),
    `${fileStem(asset.file.name)}-labeled.glb`,
  );
  setStatus('Losslessly labeled GLB downloaded. Geometry, textures, skin, and animation data were preserved.');
}

function updateTimeReadout(): void {
  const clip = asset?.gltf.animations[selectedClipIndex];
  if (!clip || !action) {
    clipPosition.textContent = '0.00 / 0.00 s';
    return;
  }
  const time = Math.min(clip.duration, Math.max(0, action.time));
  clipPosition.textContent = `${time.toFixed(2)} / ${clip.duration.toFixed(2)} s`;
  if (!timelineDragging) timeline.value = String(time);
}

function setControlsEnabled(enabled: boolean): void {
  for (const control of [
    timeline,
    previousButton,
    restartButton,
    playButton,
    nextButton,
    speedSelect,
    loopCheckbox,
    skeletonCheckbox,
    resetCameraButton,
    semanticNameSelect,
    saveAndNextButton,
    unbindNameButton,
    saveProgressButton,
    downloadMapButton,
  ]) {
    control.disabled = !enabled;
  }
  if (!enabled) downloadGlbButton.disabled = true;
}

function setBusy(busy: boolean): void {
  busyState.hidden = !busy;
  fileInput.disabled = busy;
  root.classList.toggle('is-busy', busy);
}

function setStatus(message: string, error = false): void {
  status.textContent = message;
  status.classList.toggle('is-error', error);
}

function resizeRenderer(): void {
  const width = Math.max(1, viewerHost.clientWidth);
  const height = Math.max(1, viewerHost.clientHeight);
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

function storageKey(digest: string): string {
  return `selo-empire-glb-animation-labeler:v1:${digest}`;
}

async function sha256(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes.slice(0));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function fileStem(fileName: string): string {
  return fileName.replace(/\s*\(\d+\)(?=\.glb$)/i, '').replace(/\.glb$/i, '');
}

function formatBytes(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(1)} KiB`;
  return `${(bytes / 1_048_576).toFixed(2)} MiB`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function mustElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id}`);
  return element as T;
}
