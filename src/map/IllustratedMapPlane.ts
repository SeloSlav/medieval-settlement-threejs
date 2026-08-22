import * as THREE from 'three';
import type { TerrainBounds } from '../terrain/Terrain.ts';
import { disposeObject3D } from '../utils/dispose.ts';
import {
  createIllustratedMapDeskCanvas,
  illustratedMapDeskMetrics,
  ILLUSTRATED_MAP_DESK_ALPHA_FADE_START,
  ILLUSTRATED_MAP_DESK_FADE_START,
  ILLUSTRATED_MAP_DESK_MARGIN_RATIO,
  ILLUSTRATED_MAP_DESK_TEXTURE_SEED,
} from './illustratedMapDeskSurface.ts';

export const ILLUSTRATED_MAP_STAMP_LIFT = 0.12;

export type IllustratedMapDebugMode = 'final' | 'plane';

/**
 * A deliberately separate, no-post scene for the final strategic camera tier.
 * The map keeps the world's X/Z coordinate ownership, so the ordinary RTS
 * orbit and pan rig can view it without a second set of controls.
 */
export class IllustratedMapPlane {
  readonly scene = new THREE.Scene();
  private readonly root = new THREE.Group();
  private readonly maxAnisotropy: number;
  private deskTexture: THREE.CanvasTexture | null = null;
  private mapTexture: THREE.CanvasTexture | null = null;
  private stampTexture: THREE.CanvasTexture | null = null;
  private deskMaterial: THREE.MeshBasicMaterial | null = null;
  private mapMaterial: THREE.MeshBasicMaterial | null = null;
  private stampMaterial: THREE.MeshBasicMaterial | null = null;
  private frameMaterial: THREE.MeshBasicMaterial | null = null;
  private desk: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> | null = null;
  private plane: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> | null = null;
  private stampPlane: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> | null = null;
  private frame: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> | null = null;
  private debugMode: IllustratedMapDebugMode = 'final';

  constructor(maxAnisotropy: number) {
    this.maxAnisotropy = maxAnisotropy;
    this.scene.name = 'Illustrated strategic map scene';
    this.scene.background = new THREE.Color(0x000000);
    this.root.name = 'World-aligned illustrated map';
    this.scene.add(this.root);
  }

  get ready(): boolean {
    return this.plane !== null;
  }

  setCanvases(
    canvas: HTMLCanvasElement,
    stampCanvas: HTMLCanvasElement,
    bounds: TerrainBounds,
  ): void {
    this.clearPlane();

    const width = bounds.maxX - bounds.minX;
    const depth = bounds.maxZ - bounds.minZ;
    const centerX = (bounds.minX + bounds.maxX) * 0.5;
    const centerZ = (bounds.minZ + bounds.maxZ) * 0.5;
    const border = Math.max(width, depth) * 0.018;
    const deskMetrics = illustratedMapDeskMetrics(bounds);

    this.deskTexture = new THREE.CanvasTexture(createIllustratedMapDeskCanvas());
    this.deskTexture.name = 'Illustrated map procedural dark oak desk';
    this.deskTexture.colorSpace = THREE.SRGBColorSpace;
    this.deskTexture.anisotropy = this.maxAnisotropy;
    this.deskTexture.magFilter = THREE.LinearFilter;
    this.deskTexture.minFilter = THREE.LinearMipmapLinearFilter;
    this.deskTexture.generateMipmaps = true;
    this.deskTexture.wrapS = THREE.ClampToEdgeWrapping;
    this.deskTexture.wrapT = THREE.ClampToEdgeWrapping;
    this.deskTexture.needsUpdate = true;

    this.mapTexture = new THREE.CanvasTexture(canvas);
    this.mapTexture.name = 'Illustrated strategic map parchment';
    this.mapTexture.colorSpace = THREE.SRGBColorSpace;
    this.mapTexture.anisotropy = this.maxAnisotropy;
    this.mapTexture.magFilter = THREE.LinearFilter;
    this.mapTexture.minFilter = THREE.LinearMipmapLinearFilter;
    this.mapTexture.generateMipmaps = true;
    this.mapTexture.wrapS = THREE.ClampToEdgeWrapping;
    this.mapTexture.wrapT = THREE.ClampToEdgeWrapping;
    this.mapTexture.needsUpdate = true;

    this.stampTexture = new THREE.CanvasTexture(stampCanvas);
    this.stampTexture.name = 'Illustrated strategic map resource stamps';
    this.stampTexture.colorSpace = THREE.SRGBColorSpace;
    this.stampTexture.anisotropy = this.maxAnisotropy;
    this.stampTexture.magFilter = THREE.LinearFilter;
    this.stampTexture.minFilter = THREE.LinearMipmapLinearFilter;
    this.stampTexture.generateMipmaps = true;
    this.stampTexture.wrapS = THREE.ClampToEdgeWrapping;
    this.stampTexture.wrapT = THREE.ClampToEdgeWrapping;
    this.stampTexture.needsUpdate = true;

    this.mapMaterial = new THREE.MeshBasicMaterial({
      map: this.mapTexture,
      color: 0xffffff,
      side: THREE.DoubleSide,
      toneMapped: false,
      // The parchment deliberately owns the pixels inside the dark backing.
      // At kilometer-scale map distances a tiny coplanar Y offset is not
      // representable reliably in the depth buffer, so make that ownership
      // explicit instead of inviting z-fighting.
      depthTest: false,
      depthWrite: false,
    });
    this.deskMaterial = new THREE.MeshBasicMaterial({
      map: this.deskTexture,
      color: 0xffffff,
      side: THREE.DoubleSide,
      // Keep the desk in the opaque render list with the parchment so its
      // negative renderOrder is honoured across WebGL and WebGPU. The canvas
      // also fades its RGB to black; its alpha fade is used by the DOM map.
      transparent: false,
      toneMapped: false,
      depthTest: false,
      depthWrite: false,
    });
    this.stampMaterial = new THREE.MeshBasicMaterial({
      map: this.stampTexture,
      color: 0xffffff,
      side: THREE.DoubleSide,
      transparent: true,
      alphaTest: 0.01,
      toneMapped: false,
      // Stamps deliberately render over the parchment regardless of the
      // terrain ink beneath them. A separate transparent plane also keeps
      // their alpha crisp instead of baking it into the terrain texture.
      depthTest: false,
      depthWrite: false,
    });
    this.frameMaterial = new THREE.MeshBasicMaterial({
      color: 0x120b07,
      side: THREE.DoubleSide,
      transparent: false,
      toneMapped: false,
      depthTest: false,
      depthWrite: false,
    });

    this.desk = new THREE.Mesh(
      new THREE.PlaneGeometry(deskMetrics.width, deskMetrics.depth),
      this.deskMaterial,
    );
    this.desk.name = 'Illustrated map procedural dark oak desk surround';
    this.desk.rotation.x = -Math.PI / 2;
    this.desk.position.set(deskMetrics.centerX, -0.08, deskMetrics.centerZ);
    this.desk.renderOrder = -1;

    this.frame = new THREE.Mesh(
      new THREE.PlaneGeometry(width + border * 2, depth + border * 2),
      this.frameMaterial,
    );
    this.frame.name = 'Illustrated map dark edge';
    this.frame.rotation.x = -Math.PI / 2;
    this.frame.position.set(centerX, 0, centerZ);
    this.frame.renderOrder = 0;

    this.plane = new THREE.Mesh(
      new THREE.PlaneGeometry(width, depth),
      this.mapMaterial,
    );
    this.plane.name = 'Illustrated map parchment plane';
    this.plane.rotation.x = -Math.PI / 2;
    this.plane.position.set(centerX, 0, centerZ);
    this.plane.renderOrder = 1;

    this.stampPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(width, depth),
      this.stampMaterial,
    );
    this.stampPlane.name = 'Illustrated map resource stamp layer';
    this.stampPlane.rotation.x = -Math.PI / 2;
    this.stampPlane.position.set(centerX, ILLUSTRATED_MAP_STAMP_LIFT, centerZ);
    this.stampPlane.renderOrder = 2;

    this.root.add(this.desk, this.frame, this.plane, this.stampPlane);
    this.applyDebugMode();
    this.scene.userData.illustratedMapContract = {
      bounds: { ...bounds },
      coordinateFrame: 'world-xz',
      renderPath: 'direct-no-post',
      background: 'black',
      resolution: `${canvas.width}x${canvas.height}`,
      stampResolution: `${stampCanvas.width}x${stampCanvas.height}`,
      desk: {
        source: 'deterministic-procedural-canvas',
        textureSeed: ILLUSTRATED_MAP_DESK_TEXTURE_SEED,
        marginRatio: ILLUSTRATED_MAP_DESK_MARGIN_RATIO,
        fadeStart: ILLUSTRATED_MAP_DESK_FADE_START,
        alphaFadeStart: ILLUSTRATED_MAP_DESK_ALPHA_FADE_START,
        edgeComposite: 'colour-to-black-opaque-plane',
        width: deskMetrics.width,
        depth: deskMetrics.depth,
      },
      layers: ['desk-surround', 'parchment-shadow', 'parchment', 'resource-stamps'],
    };
  }

  setElevation(elevation: number): void {
    this.root.position.y = elevation;
  }

  invalidateTextures(): void {
    if (this.mapTexture) this.mapTexture.needsUpdate = true;
    if (this.stampTexture) this.stampTexture.needsUpdate = true;
  }

  setDebugMode(mode: IllustratedMapDebugMode): void {
    if (this.debugMode === mode) return;
    this.debugMode = mode;
    this.applyDebugMode();
  }

  dispose(): void {
    this.clearPlane();
    this.scene.remove(this.root);
  }

  private applyDebugMode(): void {
    if (!this.deskMaterial || !this.mapMaterial || !this.frameMaterial || !this.stampMaterial) return;
    const diagnostic = this.debugMode === 'plane';
    this.deskMaterial.color.setHex(diagnostic ? 0x6d3f27 : 0xffffff);
    this.mapMaterial.wireframe = diagnostic;
    this.mapMaterial.color.setHex(diagnostic ? 0xd7b86d : 0xffffff);
    this.frameMaterial.color.setHex(diagnostic ? 0x6d2418 : 0x120b07);
    this.stampMaterial.opacity = diagnostic ? 0.58 : 1;
    this.scene.background = new THREE.Color(diagnostic ? 0x101010 : 0x000000);
    this.deskMaterial.needsUpdate = true;
    this.mapMaterial.needsUpdate = true;
    this.stampMaterial.needsUpdate = true;
  }

  private clearPlane(): void {
    if (this.stampPlane) {
      this.root.remove(this.stampPlane);
      disposeObject3D(this.stampPlane);
      this.stampPlane = null;
    }
    if (this.plane) {
      this.root.remove(this.plane);
      disposeObject3D(this.plane);
      this.plane = null;
    }
    if (this.frame) {
      this.root.remove(this.frame);
      disposeObject3D(this.frame);
      this.frame = null;
    }
    if (this.desk) {
      this.root.remove(this.desk);
      disposeObject3D(this.desk);
      this.desk = null;
    }
    this.deskMaterial?.dispose();
    this.mapMaterial?.dispose();
    this.stampMaterial?.dispose();
    this.frameMaterial?.dispose();
    this.deskTexture?.dispose();
    this.mapTexture?.dispose();
    this.stampTexture?.dispose();
    this.deskTexture = null;
    this.mapTexture = null;
    this.stampTexture = null;
    this.deskMaterial = null;
    this.mapMaterial = null;
    this.stampMaterial = null;
    this.frameMaterial = null;
  }
}
