import * as THREE from 'three';
import type { Terrain } from '../terrain/Terrain.ts';
import { resolveResourceIconOpacity } from './resourceMapIconPreference.ts';
import {
  clearProjectedMapButtonHitBounds,
  setProjectedMapButtonHitBounds,
} from './projectedMapButtonHitBounds.ts';

const WORLD_ICON_LIFT = 2.4;

export type MapIconFrame = {
  camera: THREE.PerspectiveCamera;
  rect: DOMRect;
  terrain: Terrain;
  projectionRevision: number;
};

type MapIconFrameState = {
  frame: MapIconFrame;
  projectionMatrix: THREE.Matrix4;
  matrixWorldInverse: THREE.Matrix4;
  rectLeft: number;
  rectTop: number;
  rectWidth: number;
  rectHeight: number;
};

type ProjectedButtonState = {
  projectionRevision: number;
  worldX: number;
  worldY: number;
  worldZ: number;
  hitWorldWidth: number;
  hitWorldDepth: number;
  visible: boolean;
};

const frameStates = new WeakMap<HTMLElement, MapIconFrameState>();
const projectedButtonStates = new WeakMap<HTMLButtonElement, ProjectedButtonState>();
const projectedHitCorner = new THREE.Vector3();

export function beginMapIconFrame(
  root: HTMLElement,
  domElement: HTMLElement,
  terrain: Terrain,
  getCamera: () => THREE.PerspectiveCamera | null,
  getZoomPercent: () => number,
  isBlocked: () => boolean,
  getFrameRect?: () => DOMRect,
  forceVisible = false,
): MapIconFrame | null {
  const camera = getCamera();
  if (!camera) {
    setHiddenIfChanged(root, true);
    return null;
  }

  // The DOM overlay is projected before SceneManager renders. Three.js normally
  // refreshes matrixWorldInverse during that render, which left icons using the
  // previous frame's view matrix while middle-mouse rotation was active.
  camera.updateMatrixWorld();

  const reveal = isBlocked()
    ? 0
    : forceVisible
      ? 1
      : resolveResourceIconOpacity(getZoomPercent());
  const show = reveal > 0.02;
  setHiddenIfChanged(root, !show);
  const opacity = reveal.toFixed(3);
  if (root.style.opacity !== opacity) root.style.opacity = opacity;
  if (!show) return null;

  const rect = getFrameRect?.() ?? domElement.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    setHiddenIfChanged(root, true);
    return null;
  }

  let state = frameStates.get(root);
  if (!state) {
    state = {
      frame: { camera, rect, terrain, projectionRevision: 1 },
      projectionMatrix: camera.projectionMatrix.clone(),
      matrixWorldInverse: camera.matrixWorldInverse.clone(),
      rectLeft: rect.left,
      rectTop: rect.top,
      rectWidth: rect.width,
      rectHeight: rect.height,
    };
    frameStates.set(root, state);
    return state.frame;
  }
  const projectionChanged = !state.projectionMatrix.equals(camera.projectionMatrix)
    || !state.matrixWorldInverse.equals(camera.matrixWorldInverse)
    || state.rectLeft !== rect.left
    || state.rectTop !== rect.top
    || state.rectWidth !== rect.width
    || state.rectHeight !== rect.height;
  if (projectionChanged) {
    state.projectionMatrix.copy(camera.projectionMatrix);
    state.matrixWorldInverse.copy(camera.matrixWorldInverse);
    state.rectLeft = rect.left;
    state.rectTop = rect.top;
    state.rectWidth = rect.width;
    state.rectHeight = rect.height;
    state.frame.projectionRevision += 1;
  }
  state.frame.camera = camera;
  state.frame.rect = rect;
  state.frame.terrain = terrain;
  return state.frame;
}

export function placeProjectedMapButton(
  button: HTMLButtonElement,
  worldX: number,
  worldZ: number,
  worldPoint: THREE.Vector3,
  frame: MapIconFrame,
  worldYOverride?: number,
  hitWorldWidth = 0,
  hitWorldDepth = 0,
): boolean {
  const worldY = worldYOverride
    ?? frame.terrain.getHeightAt(worldX, worldZ) + WORLD_ICON_LIFT;
  const previous = projectedButtonStates.get(button);
  if (
    previous
    && previous.projectionRevision === frame.projectionRevision
    && previous.worldX === worldX
    && previous.worldY === worldY
    && previous.worldZ === worldZ
    && previous.hitWorldWidth === hitWorldWidth
    && previous.hitWorldDepth === hitWorldDepth
    && button.hidden === !previous.visible
  ) {
    return previous.visible;
  }
  worldPoint.set(
    worldX,
    worldY,
    worldZ,
  );
  worldPoint.project(frame.camera);

  if (worldPoint.z < -1 || worldPoint.z > 1) {
    setHiddenIfChanged(button, true);
    clearProjectedMapButtonHitBounds(button);
    updateProjectedButtonState(
      button,
      frame.projectionRevision,
      worldX,
      worldY,
      worldZ,
      hitWorldWidth,
      hitWorldDepth,
      false,
    );
    return false;
  }

  const clientX = frame.rect.left + (worldPoint.x * 0.5 + 0.5) * frame.rect.width;
  const clientY = frame.rect.top + (-worldPoint.y * 0.5 + 0.5) * frame.rect.height;
  setHiddenIfChanged(button, false);
  const left = `${clientX}px`;
  const top = `${clientY}px`;
  if (button.style.left !== left) button.style.left = left;
  if (button.style.top !== top) button.style.top = top;
  syncProjectedButtonHitArea(
    button,
    worldX,
    worldY,
    worldZ,
    hitWorldWidth,
    hitWorldDepth,
    frame,
    clientX,
    clientY,
  );
  updateProjectedButtonState(
    button,
    frame.projectionRevision,
    worldX,
    worldY,
    worldZ,
    hitWorldWidth,
    hitWorldDepth,
    true,
  );
  return true;
}

function updateProjectedButtonState(
  button: HTMLButtonElement,
  projectionRevision: number,
  worldX: number,
  worldY: number,
  worldZ: number,
  hitWorldWidth: number,
  hitWorldDepth: number,
  visible: boolean,
): void {
  const state = projectedButtonStates.get(button);
  if (state) {
    state.projectionRevision = projectionRevision;
    state.worldX = worldX;
    state.worldY = worldY;
    state.worldZ = worldZ;
    state.hitWorldWidth = hitWorldWidth;
    state.hitWorldDepth = hitWorldDepth;
    state.visible = visible;
  } else {
    projectedButtonStates.set(button, {
      projectionRevision,
      worldX,
      worldY,
      worldZ,
      hitWorldWidth,
      hitWorldDepth,
      visible,
    });
  }
}

function syncProjectedButtonHitArea(
  button: HTMLButtonElement,
  worldX: number,
  worldY: number,
  worldZ: number,
  hitWorldWidth: number,
  hitWorldDepth: number,
  frame: MapIconFrame,
  clientX: number,
  clientY: number,
): void {
  if (hitWorldWidth <= 0 || hitWorldDepth <= 0) {
    clearProjectedMapButtonHitBounds(button);
    for (const property of ['width', 'height', 'margin-left', 'margin-top']) {
      button.style.removeProperty(property);
    }
    return;
  }

  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  const halfWidth = hitWorldWidth * 0.5;
  const halfDepth = hitWorldDepth * 0.5;
  for (const offsetX of [-halfWidth, halfWidth]) {
    for (const offsetZ of [-halfDepth, halfDepth]) {
      projectedHitCorner.set(worldX + offsetX, worldY, worldZ + offsetZ);
      projectedHitCorner.project(frame.camera);
      const clientX = (projectedHitCorner.x * 0.5 + 0.5) * frame.rect.width;
      const clientY = (-projectedHitCorner.y * 0.5 + 0.5) * frame.rect.height;
      minX = Math.min(minX, clientX);
      maxX = Math.max(maxX, clientX);
      minY = Math.min(minY, clientY);
      maxY = Math.max(maxY, clientY);
    }
  }

  const width = Math.max(24, maxX - minX + 8);
  const height = Math.max(24, maxY - minY + 8);
  setStyleIfChanged(button, 'width', `${width}px`);
  setStyleIfChanged(button, 'height', `${height}px`);
  setStyleIfChanged(button, 'margin-left', `${-width * 0.5}px`);
  setStyleIfChanged(button, 'margin-top', `${-height * 0.5}px`);
  setProjectedMapButtonHitBounds(button, clientX, clientY, width, height);
}

function setStyleIfChanged(
  element: HTMLElement,
  property: string,
  value: string,
): void {
  if (element.style.getPropertyValue(property) !== value) {
    element.style.setProperty(property, value);
  }
}

function setHiddenIfChanged(element: HTMLElement, hidden: boolean): void {
  if (element.hidden !== hidden) element.hidden = hidden;
}

export function createMapIconRoot(uiRoot: HTMLElement, className: string): HTMLElement {
  const root = document.createElement('div');
  root.className = className;
  root.setAttribute('aria-hidden', 'true');
  uiRoot.appendChild(root);
  return root;
}
