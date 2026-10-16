import * as THREE from 'three';
import { DevelopmentProfiler } from '../performance/DevelopmentProfiler.ts';

export const RENDER_DIAGNOSTIC_CATEGORIES = [
  'buildings', 'people', 'carts', 'oxen', 'animals', 'trees', 'grass',
  'vegetation', 'crops', 'reeds', 'shrubs', 'groundPlants', 'groundScatter', 'sky',
] as const;
export type RenderDiagnosticCategory = typeof RENDER_DIAGNOSTIC_CATEGORIES[number];
export type BuildingDiagnosticMode = 'full' | 'placeholder' | 'hidden';
export const VEGETATION_DIAGNOSTIC_CATEGORIES: readonly RenderDiagnosticCategory[] = [
  'crops', 'reeds', 'shrubs', 'groundPlants',
];
type ProxyVisitor = (object: THREE.Object3D, width: number, height: number, depth: number) => void;
type Registration = {
  category: RenderDiagnosticCategory;
  proxies?: (visit: ProxyVisitor) => void;
};
const registrations = new WeakMap<THREE.Object3D, Registration>();
let registrationRevision = 0;

/** Register semantic render ownership, including independent color/shadow batches. */
export function registerRenderDiagnosticRoot(
  root: THREE.Object3D,
  category: RenderDiagnosticCategory,
  proxies?: Registration['proxies'],
): void {
  registrations.set(root, { category, proxies });
  registrationRevision++;
}

export type RenderDiagnosticSample = {
  frames: number;
  fps: number;
  meanMs: number;
  p95Ms: number;
  calls: number;
  triangles: number;
};

/** Temporary render substitutions. Simulation and animation retain their normal cadence. */
export class RenderDiagnostics {
  readonly profiler = new DevelopmentProfiler();
  private readonly scene: THREE.Scene;
  private readonly invalidateShadows: () => void;
  buildingMode: BuildingDiagnosticMode = 'full';
  private readonly hidden = new Set<RenderDiagnosticCategory>();
  private readonly roots: Array<{ root: THREE.Object3D; registration: Registration }> = [];
  private readonly suppressed: THREE.Object3D[] = [];
  private readonly proxyRoot = new THREE.Group();
  private readonly proxies: THREE.Mesh[] = [];
  private geometry: THREE.BoxGeometry | null = null;
  private material: THREE.MeshStandardMaterial | null = null;
  private readonly proxyLocal = new THREE.Matrix4();
  private readonly proxyOffset = new THREE.Vector3();
  private readonly proxyScale = new THREE.Vector3();
  private readonly identityRotation = new THREE.Quaternion();
  private collectedRevision = -1;
  private readonly intervals = new Float64Array(180);
  private readonly calls = new Float64Array(180);
  private readonly triangles = new Float64Array(180);
  private cursor = 0;
  private sampleCount = 0;
  private settleUntil = 0;
  baseline: RenderDiagnosticSample | null = null;

  constructor(scene: THREE.Scene, invalidateShadows: () => void) {
    this.scene = scene;
    this.invalidateShadows = invalidateShadows;
    this.proxyRoot.name = 'Diagnostic building placeholders';
    this.proxyRoot.visible = false;
    scene.add(this.proxyRoot);
  }

  isHidden(category: RenderDiagnosticCategory): boolean { return this.hidden.has(category); }

  isEffectivelyHidden(category: RenderDiagnosticCategory): boolean {
    return this.hidden.has(category)
      || (category === 'buildings' && this.buildingMode === 'hidden')
      || (this.hidden.has('vegetation') && VEGETATION_DIAGNOSTIC_CATEGORIES.includes(category));
  }

  setHidden(category: RenderDiagnosticCategory, hidden: boolean): void {
    if (this.hidden.has(category) === hidden) return;
    if (hidden) this.hidden.add(category);
    else this.hidden.delete(category);
    this.changed();
  }

  setBuildingMode(mode: BuildingDiagnosticMode): void {
    if (this.buildingMode === mode) return;
    this.buildingMode = mode;
    this.changed();
  }

  reset(): void {
    this.hidden.clear();
    this.buildingMode = 'full';
    this.changed();
  }

  isActive(): boolean { return this.hidden.size > 0 || this.buildingMode !== 'full'; }

  getState(): { buildings: BuildingDiagnosticMode; hidden: RenderDiagnosticCategory[]; effectiveHidden: RenderDiagnosticCategory[] } {
    const hidden = [...this.hidden].sort();
    const effectiveHidden = RENDER_DIAGNOSTIC_CATEGORIES.filter(category => this.isEffectivelyHidden(category)).sort();
    return { buildings: this.buildingMode, hidden, effectiveHidden };
  }

  private changed(): void {
    this.profiler.togglesChanged(this.getState());
    this.sampleCount = this.cursor = 0;
    this.collectedRevision = -1;
    this.roots.length = 0;
    // Exclude the switch, command-cache rebuild and first shader compilation.
    this.settleUntil = performance.now() + 1500;
    this.invalidateShadows();
  }

  /** Called after normal scene updates and before submitting either color or shadows. */
  beginRender(): void {
    if (!this.isActive()) return;
    if (this.collectedRevision !== registrationRevision) {
      this.roots.length = 0;
      const collect = (root: THREE.Object3D): void => {
        const registration = registrations.get(root);
        if (registration) {
          this.roots.push({ root, registration });
          return;
        }
        for (const child of root.children) collect(child);
      };
      collect(this.scene);
      this.collectedRevision = registrationRevision;
    }
    let proxyCount = 0;
    const visit: ProxyVisitor = (object, width, height, depth) => {
      if (!object.visible || !object.parent) return;
      let proxy = this.proxies[proxyCount++];
      if (!proxy) {
        this.geometry ??= new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
        this.material ??= new THREE.MeshStandardMaterial({ color: 0xb99c74, roughness: 1 });
        proxy = new THREE.Mesh(this.geometry, this.material);
        proxy.name = 'Single-mesh building placeholder';
        proxy.castShadow = proxy.receiveShadow = true;
        proxy.matrixAutoUpdate = false;
        this.proxyRoot.add(proxy);
        this.proxies.push(proxy);
      }
      proxy.visible = true;
      this.proxyScale.set(width, height, depth);
      this.proxyOffset.set(0, 0, 0);
      this.proxyLocal.compose(this.proxyOffset, this.identityRotation, this.proxyScale);
      proxy.matrix.multiplyMatrices(object.matrixWorld, this.proxyLocal);
      proxy.matrixWorld.copy(proxy.matrix);
    };
    // Generate proxies before suppressing their owning roots.
    if (this.buildingMode === 'placeholder' && !this.hidden.has('buildings')) {
      for (const { root, registration } of this.roots) {
        if (root.parent && root.visible && registration.category === 'buildings') registration.proxies?.(visit);
      }
    }
    for (let i = proxyCount; i < this.proxies.length; i++) this.proxies[i].visible = false;
    this.proxyRoot.visible = proxyCount > 0;
    for (const { root, registration: { category } } of this.roots) {
      const hidden = this.isEffectivelyHidden(category)
        || (category === 'buildings' && this.buildingMode === 'placeholder');
      if (hidden && root.parent && root.visible) {
        root.visible = false;
        this.suppressed.push(root);
      }
    }
  }

  /** Restore presentation-owned visibility, even when rendering throws. */
  endRender(): void {
    for (const root of this.suppressed) root.visible = true;
    this.suppressed.length = 0;
    this.proxyRoot.visible = false;
  }

  recordFrame(intervalMs: number, stats: { calls: number; triangles: number }): void {
    if (!Number.isFinite(intervalMs) || intervalMs <= 0 || intervalMs > 1000 || performance.now() < this.settleUntil) return;
    this.intervals[this.cursor] = intervalMs;
    this.calls[this.cursor] = stats.calls;
    this.triangles[this.cursor] = stats.triangles;
    this.cursor = (this.cursor + 1) % this.intervals.length;
    this.sampleCount = Math.min(this.sampleCount + 1, this.intervals.length);
  }

  getSample(): RenderDiagnosticSample | null {
    if (this.sampleCount < 10) return null;
    const times = Array.from(this.intervals.subarray(0, this.sampleCount)).sort((a, b) => a - b);
    const mean = times.reduce((sum, value) => sum + value, 0) / times.length;
    const average = (values: Float64Array) => values.subarray(0, this.sampleCount).reduce((sum, value) => sum + value, 0) / this.sampleCount;
    return { frames: this.sampleCount, fps: 1000 / mean, meanMs: mean,
      p95Ms: times[Math.ceil(times.length * 0.95) - 1], calls: average(this.calls), triangles: average(this.triangles) };
  }

  captureBaseline(): void { this.baseline = this.getSample(); }

  dispose(): void {
    this.profiler.dispose();
    this.endRender();
    this.proxyRoot.removeFromParent();
    this.geometry?.dispose();
    this.material?.dispose();
    this.roots.length = this.proxies.length = 0;
  }
}
