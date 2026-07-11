import * as THREE from 'three';
import { mapIconRevealOpacity } from '../grass/grassLodMath.ts';
import type { Terrain } from '../terrain/Terrain.ts';

const WORLD_ICON_LIFT = 2.4;

export type MapIconFrame = {
  camera: THREE.PerspectiveCamera;
  rect: DOMRect;
  terrain: Terrain;
};

export function beginMapIconFrame(
  root: HTMLElement,
  domElement: HTMLElement,
  terrain: Terrain,
  getCamera: () => THREE.PerspectiveCamera | null,
  getZoomPercent: () => number,
  isBlocked: () => boolean,
): MapIconFrame | null {
  const camera = getCamera();
  if (!camera) {
    root.hidden = true;
    return null;
  }

  const reveal = isBlocked() ? 0 : mapIconRevealOpacity(getZoomPercent());
  const show = reveal > 0.02;
  root.hidden = !show;
  root.style.opacity = reveal.toFixed(3);
  if (!show) return null;

  const rect = domElement.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    root.hidden = true;
    return null;
  }

  return { camera, rect, terrain };
}

export function placeProjectedMapButton(
  button: HTMLButtonElement,
  worldX: number,
  worldZ: number,
  worldPoint: THREE.Vector3,
  frame: MapIconFrame,
): boolean {
  worldPoint.set(
    worldX,
    frame.terrain.getHeightAt(worldX, worldZ) + WORLD_ICON_LIFT,
    worldZ,
  );
  worldPoint.project(frame.camera);

  if (worldPoint.z < -1 || worldPoint.z > 1) {
    button.hidden = true;
    return false;
  }

  const clientX = frame.rect.left + (worldPoint.x * 0.5 + 0.5) * frame.rect.width;
  const clientY = frame.rect.top + (-worldPoint.y * 0.5 + 0.5) * frame.rect.height;
  button.hidden = false;
  button.style.left = `${clientX}px`;
  button.style.top = `${clientY}px`;
  return true;
}

export function createMapIconRoot(uiRoot: HTMLElement, className: string): HTMLElement {
  const root = document.createElement('div');
  root.className = className;
  root.setAttribute('aria-hidden', 'true');
  uiRoot.appendChild(root);
  return root;
}
