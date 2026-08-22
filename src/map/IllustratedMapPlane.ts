import * as THREE from 'three';
import type { TerrainBounds } from '../terrain/Terrain.ts';
import { disposeObject3D } from '../utils/dispose.ts';

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
  private mapTexture: THREE.CanvasTexture | null = null;
  private stampTexture: THREE.CanvasTexture | null = null;
  private mapMaterial: THREE.MeshBasicMaterial | null = null;
  private stampMaterial: THREE.MeshBasicMaterial | null = null;
  private frameMaterial: THREE.MeshBasicMaterial | null = null;
  private plane: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> | null = null;
  private stampPlane: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> | null = null;
  private frame: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> | null = null;
  private debugMode: IllustratedMapDebugMode = 'final';

  constructor(maxAnisotropy: number) {
    this.maxAnisotropy = maxAnisotropy;
    this.scene.name = 'Illustrated strategic map scene';
    this.scene.background = new THREE.Color(0x241f16);
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

    this.mapTexture = new THREE.CanvasTexture(canvas);
    this.mapTexture.name = 'Illustrated strategic map parchment';
    this.mapTexture.colorSpace = THREE.SRGBColorSpace;
    this.mapTexture.anisotropy = this.maxAnisotropy;
    this.mapTexture.wrapS = THREE.ClampToEdgeWrapping;
    this.mapTexture.wrapT = THREE.ClampToEdgeWrapping;
    this.mapTexture.needsUpdate = true;

    this.stampTexture = new THREE.CanvasTexture(stampCanvas);
    this.stampTexture.name = 'Illustrated strategic map resource stamps';
    this.stampTexture.colorSpace = THREE.SRGBColorSpace;
    this.stampTexture.anisotropy = this.maxAnisotropy;
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
      color: 0x332819,
      side: THREE.DoubleSide,
      toneMapped: false,
    });

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
    this.stampPlane.position.set(centerX, 0.12, centerZ);
    this.stampPlane.renderOrder = 2;

    this.root.add(this.frame, this.plane, this.stampPlane);
    this.applyDebugMode();
    this.scene.userData.illustratedMapContract = {
      bounds: { ...bounds },
      coordinateFrame: 'world-xz',
      renderPath: 'direct-no-post',
      resolution: `${canvas.width}x${canvas.height}`,
      stampResolution: `${stampCanvas.width}x${stampCanvas.height}`,
      layers: ['frame', 'parchment', 'resource-stamps'],
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
    if (!this.mapMaterial || !this.frameMaterial || !this.stampMaterial) return;
    const diagnostic = this.debugMode === 'plane';
    this.mapMaterial.wireframe = diagnostic;
    this.mapMaterial.color.setHex(diagnostic ? 0xd7b86d : 0xffffff);
    this.frameMaterial.color.setHex(diagnostic ? 0x6d2418 : 0x332819);
    this.stampMaterial.opacity = diagnostic ? 0.58 : 1;
    this.scene.background = new THREE.Color(diagnostic ? 0x101010 : 0x241f16);
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
    this.mapMaterial?.dispose();
    this.stampMaterial?.dispose();
    this.frameMaterial?.dispose();
    this.mapTexture?.dispose();
    this.stampTexture?.dispose();
    this.mapTexture = null;
    this.stampTexture = null;
    this.mapMaterial = null;
    this.stampMaterial = null;
    this.frameMaterial = null;
  }
}
