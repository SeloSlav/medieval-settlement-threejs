import * as THREE from 'three';
import type { TerrainBounds } from '../terrain/Terrain.ts';
import {
  BASELINE_ORBIT_DISTANCE,
  CLOSE_FOV,
  DEFAULT_FOV,
  MIN_CAMERA_TERRAIN_CLEARANCE,
  CLOSE_BACK_DISTANCE,
  CLOSE_HEIGHT_ABOVE_TERRAIN,
  CLOSE_LOOK_AHEAD,
  CLOSE_LOOK_HEIGHT_OFFSET,
  CLOSE_PAN_SPEED_SCALE,
  RTS_ORBIT_DISTANCE,
  RTS_ORBIT_YAW,
  RTS_ORBIT_PITCH,
  CAMERA_ZOOM_STEP_MULTIPLIER,
  LIVE_WORLD_MIN_ZOOM_PERCENT,
  LIVE_WORLD_OVERVIEW_ZOOM_PERCENT,
  ILLUSTRATED_MAP_MIN_PITCH,
  computeCloseCurveStartDistance,
  computeIllustratedMapFarPlane,
  computeIllustratedMapZoomStops,
  computeMaxOrbitDistance,
  evalCloseBlendFromDistance,
  evalCloseCurveProgress,
  orbitNearPlaneForHeight,
} from './CameraCurves.ts';

const MIN_PITCH = THREE.MathUtils.degToRad(5);
const MAX_PITCH = THREE.MathUtils.degToRad(70);
const BASELINE_ZOOM_PERCENT = 100;
const MAX_ZOOM_PERCENT = 1000;
const MIN_DISTANCE = BASELINE_ORBIT_DISTANCE / (MAX_ZOOM_PERCENT / BASELINE_ZOOM_PERCENT);
const LIVE_WORLD_OVERVIEW_DISTANCE = BASELINE_ORBIT_DISTANCE
  / (LIVE_WORLD_OVERVIEW_ZOOM_PERCENT / BASELINE_ZOOM_PERCENT);
const LIVE_WORLD_MAX_DISTANCE = BASELINE_ORBIT_DISTANCE
  / (LIVE_WORLD_MIN_ZOOM_PERCENT / BASELINE_ZOOM_PERCENT);
/** A short exponential glide removes wheel-step pops without adding floaty inertia. */
const ZOOM_DAMPING = 16;
/** End the invisible tail of the glide once it is within 0.1% of its stop. */
const ZOOM_SETTLE_RATIO = 0.001;
/** Smooth raw drag deltas without making the camera feel detached from the pointer. */
const POINTER_MOTION_DAMPING = 18;
/** Apply the last imperceptible fraction exactly so drag input never gets lost. */
const POINTER_MOTION_SETTLE_PIXELS = 0.01;
/** Keyboard panning shares the short, responsive drag glide. */
const KEY_PAN_DAMPING = POINTER_MOTION_DAMPING;
/** Snap the final normalized velocity tail after preserving its full travel. */
const KEY_PAN_SETTLE_SPEED = 0.0001;
const WHEEL_ZOOM_STEP_DELTA = 80;
const WHEEL_LINE_PIXEL_SCALE = 32;
const WHEEL_PAGE_PIXEL_FALLBACK = 800;
const WHEEL_ACCUMULATION_TIMEOUT_MS = 240;
const DISTANCE_EPSILON = 0.01;
const ROTATE_SENSITIVITY = 0.005;
const PITCH_SENSITIVITY = 0.004;
const RMB_PAN_MULTIPLIER = 0.105;
const KEY_PAN_SPEED = 34;
/** Preserve responsive arrow-key travel as the close camera tightens beyond 350%. */
const KEY_PAN_CLOSE_ZOOM_START_PERCENT = 350;
const KEY_PAN_MAX_ZOOM_MULTIPLIER = 2.4;
const KEY_ROTATE_SPEED = 2.8;
const INSPECT_FOCUS_DISTANCE = 90;
/** Keep the resident render set stable until a wheel/trackpad zoom burst settles. */
const WHEEL_NAVIGATION_GRACE_MS = 220;
const KEYBOARD_PAN_KEYS = new Set([
  'w',
  'a',
  's',
  'd',
  'arrowup',
  'arrowdown',
  'arrowleft',
  'arrowright',
]);
const NAVIGATION_KEYS = new Set([
  ...KEYBOARD_PAN_KEYS,
  'q',
  'e',
]);

export type CameraControllerConfig = {
  camera: THREE.PerspectiveCamera;
  target: THREE.Vector3;
  domElement: HTMLElement;
  bounds: TerrainBounds;
  getHeightAt: (x: number, z: number) => number;
  getCursorOverride?: () => string | null;
  shouldIgnoreInput?: (event: MouseEvent | WheelEvent) => boolean;
  isIllustratedMapReady?: () => boolean;
  onViewChanged?: () => void;
  /** Commits either render owner only at the transition's transparent midpoint. */
  onIllustratedMapModeTransition?: (
    active: boolean,
    commit: () => void,
  ) => (() => void) | void;
  onIllustratedMapModeChanged?: (active: boolean) => void;
  /** The owner already renders every animation frame, so view changes only invalidate that frame. */
  continuousRenderLoop?: boolean;
  /** Keep the ordinary orbit pose at every distance for isolated asset inspection. */
  orbitOnly?: boolean;
  /** Preserve an authored inspection lens instead of adopting the live-world FOV. */
  orbitFov?: number;
  /** Optional scale-aware orbit envelope for isolated preview scenes. */
  minimumOrbitDistance?: number;
  maximumOrbitDistance?: number;
};

export class CameraController {
  private readonly config: CameraControllerConfig;
  private readonly minimumOrbitDistance: number;
  private readonly liveWorldMaxDistance: number;
  private illustratedMapZoomStops: readonly number[] = [];
  private illustratedMapFarPlane = 0;
  private currentDistance = RTS_ORBIT_DISTANCE;
  private targetDistance = RTS_ORBIT_DISTANCE;
  private currentYaw = RTS_ORBIT_YAW;
  private currentPitch = RTS_ORBIT_PITCH;
  private readonly orbitPosition = new THREE.Vector3();
  private readonly orbitDirection = new THREE.Vector3();
  private readonly closePosition = new THREE.Vector3();
  private readonly lookAtPoint = new THREE.Vector3();
  private readonly forward = new THREE.Vector3();
  private readonly keys = new Set<string>();
  private inputEnabled = true;
  private isPanning = false;
  private isRotating = false;
  private lastMouseX = 0;
  private lastMouseY = 0;
  private pendingPanX = 0;
  private pendingPanY = 0;
  private pendingRotateX = 0;
  private pendingRotateY = 0;
  private keyboardPanVelocityX = 0;
  private keyboardPanVelocityY = 0;
  private activeCursor = '';
  private viewChangeFrame = 0;
  private viewportChangeFrame = 0;
  private navigationAnimationFrame = 0;
  private lastNavigationAnimationTimeMs = Number.NaN;
  private wheelNavigationUntilMs = 0;
  private accumulatedWheelDeltaY = 0;
  private lastWheelDeltaTimeMs = Number.NEGATIVE_INFINITY;
  private illustratedMapEntryPending = false;
  private illustratedMapModeTransitionTarget: boolean | null = null;
  private cancelIllustratedMapModeTransition: (() => void) | null = null;
  private illustratedMapExitPending = false;
  private illustratedMapActive = false;
  private illustratedMapZoomTier = 0;
  private worldFarBeforeIllustratedMap: number | null = null;
  private framedAspect = Number.NaN;
  private framedYaw = Number.NaN;
  private framedPitch = Number.NaN;
  private framedTargetX = Number.NaN;
  private framedTargetZ = Number.NaN;

  constructor(config: CameraControllerConfig) {
    this.config = config;
    this.minimumOrbitDistance = Math.max(
      0.1,
      config.minimumOrbitDistance ?? MIN_DISTANCE,
    );
    this.liveWorldMaxDistance = Math.max(
      this.minimumOrbitDistance,
      config.maximumOrbitDistance ?? Math.min(
        LIVE_WORLD_MAX_DISTANCE,
        computeMaxOrbitDistance(
          config.bounds,
          config.orbitFov ?? DEFAULT_FOV,
          RTS_ORBIT_PITCH,
        ),
      ),
    );
    this.config.target.set(0, config.getHeightAt(0, 0), 0);
    this.refreshIllustratedMapFraming(true);
    this.applyRtsOrbitView();
    config.domElement.addEventListener('mousedown', this.onMouseDown, { capture: true });
    config.domElement.addEventListener('wheel', this.onWheel, { passive: false, capture: true });
    config.domElement.addEventListener('contextmenu', this.onContextMenu);
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onWindowBlur);
    window.addEventListener('resize', this.onViewportResize);
  }

  getZoomPercent(): number {
    return (BASELINE_ORBIT_DISTANCE / this.currentDistance) * BASELINE_ZOOM_PERCENT;
  }

  getHudZoomPercent(): number {
    return this.getZoomPercent();
  }

  getOrbitDistance(): number {
    return this.currentDistance;
  }

  getYaw(): number {
    return this.currentYaw;
  }

  isIllustratedMapActive(): boolean {
    return this.illustratedMapActive;
  }

  isNavigationActive(): boolean {
    if (!this.inputEnabled) return false;
    if (this.illustratedMapModeTransitionTarget !== null) return true;
    if (this.isPanning || this.isRotating) return true;
    if (this.hasAnimatedNavigationMotion()) return true;
    if (performance.now() < this.wheelNavigationUntilMs) return true;
    return false;
  }

  getTargetPosition(out = new THREE.Vector3()): THREE.Vector3 {
    return out.copy(this.config.target);
  }

  focusWorldPosition(
    x: number,
    z: number,
    maxDistance = INSPECT_FOCUS_DISTANCE,
  ): void {
    this.exitIllustratedMap(true);
    this.applyWorldFocus(
      x,
      z,
      Math.min(this.currentDistance, maxDistance),
    );
  }

  /**
   * Centers a world point at a requested HUD zoom without changing the current
   * orbit orientation. Requests outside the live-world zoom envelope settle at
   * its nearest bound rather than handing render ownership to the paper map.
   */
  focusWorldPositionAtZoom(x: number, z: number, zoomPercent: number): void {
    this.exitIllustratedMap(true);
    const requestedZoom = Number.isFinite(zoomPercent)
      ? zoomPercent
      : BASELINE_ZOOM_PERCENT;
    const clampedZoom = THREE.MathUtils.clamp(
      requestedZoom,
      LIVE_WORLD_MIN_ZOOM_PERCENT,
      MAX_ZOOM_PERCENT,
    );
    const distance = BASELINE_ORBIT_DISTANCE
      / (clampedZoom / BASELINE_ZOOM_PERCENT);
    this.applyWorldFocus(x, z, distance);
  }

  private applyWorldFocus(x: number, z: number, distance: number): void {
    this.config.target.set(x, this.config.getHeightAt(x, z), z);
    this.clampTarget();
    this.currentDistance = this.clampDistance(distance);
    this.targetDistance = this.currentDistance;
    this.illustratedMapEntryPending = false;
    this.illustratedMapExitPending = false;
    this.resetPointerMotion();
    this.resetKeyboardPanMotion();
    this.keys.clear();
    this.cancelNavigationAnimation();
    this.updateCamera();
    this.notifyViewChanged();
  }

  setInputEnabled(enabled: boolean): void {
    this.inputEnabled = enabled;
    if (enabled) {
      this.ensureNavigationAnimation();
      return;
    }
    this.isPanning = false;
    this.isRotating = false;
    this.wheelNavigationUntilMs = 0;
    this.resetPointerMotion();
    this.resetKeyboardPanMotion();
    if (!this.illustratedMapActive) {
      this.targetDistance = this.currentDistance;
      this.illustratedMapEntryPending = false;
      this.illustratedMapExitPending = false;
    }
    this.cancelNavigationAnimation();
    this.resetWheelAccumulator();
    this.keys.clear();
  }

  applyRtsOrbitView(): void {
    this.exitIllustratedMap(true);
    this.currentPitch = RTS_ORBIT_PITCH;
    this.currentDistance = THREE.MathUtils.clamp(
      RTS_ORBIT_DISTANCE,
      this.getMinDistance(),
      this.liveWorldMaxDistance,
    );
    this.targetDistance = this.currentDistance;
    this.illustratedMapEntryPending = false;
    this.illustratedMapExitPending = false;
    this.resetPointerMotion();
    this.resetKeyboardPanMotion();
    this.keys.clear();
    this.cancelNavigationAnimation();
    this.updateCamera();
  }

  applyShowcaseView(
    x: number,
    z: number,
    yaw = THREE.MathUtils.degToRad(-38),
    pitch = THREE.MathUtils.degToRad(14),
    distance = 70,
  ): void {
    this.exitIllustratedMap(true);
    this.config.target.set(x, this.config.getHeightAt(x, z), z);
    this.clampTarget();
    this.currentYaw = this.normalizeAngle(yaw);
    this.currentPitch = THREE.MathUtils.clamp(pitch, MIN_PITCH, MAX_PITCH);
    this.currentDistance = this.clampDistance(distance);
    this.targetDistance = this.currentDistance;
    this.illustratedMapEntryPending = false;
    this.illustratedMapExitPending = false;
    this.resetPointerMotion();
    this.resetKeyboardPanMotion();
    this.keys.clear();
    this.cancelNavigationAnimation();
    this.updateCamera();
    this.notifyViewChanged();
  }

  syncFromFirstPerson(x: number, z: number, yaw: number): void {
    this.exitIllustratedMap(true);
    const terrainY = this.config.getHeightAt(x, z);
    this.config.target.set(x, terrainY, z);
    this.currentYaw = this.normalizeAngle(yaw);
    this.applyRtsOrbitView();
  }

  update(dt: number): void {
    if (!this.inputEnabled) return;
    const animatedMotionChanged = this.updateAnimatedNavigationMotion(dt);

    this.updateCamera();
    this.applyCursor();
    if (animatedMotionChanged) this.notifyViewChanged();
    if (!this.hasAnimatedNavigationMotion()) this.cancelNavigationAnimation();
  }

  dispose(): void {
    if (this.viewChangeFrame !== 0) {
      cancelAnimationFrame(this.viewChangeFrame);
      this.viewChangeFrame = 0;
    }
    if (this.viewportChangeFrame !== 0) {
      cancelAnimationFrame(this.viewportChangeFrame);
      this.viewportChangeFrame = 0;
    }
    this.cancelNavigationAnimation();
    const el = this.config.domElement;
    el.removeEventListener('mousedown', this.onMouseDown, true);
    el.removeEventListener('wheel', this.onWheel, true);
    el.removeEventListener('contextmenu', this.onContextMenu);
    window.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('mouseup', this.onMouseUp);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onWindowBlur);
    window.removeEventListener('resize', this.onViewportResize);
    this.cancelPendingIllustratedMapModeTransition();
    if (this.illustratedMapActive) this.commitIllustratedMapExit();
    else this.restoreWorldProjection();
    el.style.cursor = '';
    document.body.style.cursor = '';
  }

  private readonly onMouseDown = (event: MouseEvent): void => {
    if (!this.inputEnabled || this.illustratedMapModeTransitionTarget !== null) return;
    if (!this.config.domElement.contains(event.target as Node)) return;
    if (this.config.shouldIgnoreInput?.(event)) return;
    if (event.button === 2) {
      this.isPanning = true;
      this.lastMouseX = event.clientX;
      this.lastMouseY = event.clientY;
      event.preventDefault();
    } else if (event.button === 1) {
      this.isRotating = true;
      this.lastMouseX = event.clientX;
      this.lastMouseY = event.clientY;
      event.preventDefault();
    }
  };

  private readonly onMouseMove = (event: MouseEvent): void => {
    if (this.isPanning) {
      if ((event.buttons & 2) === 0) {
        this.isPanning = false;
        return;
      }
      const rawDx = event.clientX - this.lastMouseX;
      const rawDy = event.clientY - this.lastMouseY;
      this.lastMouseX = event.clientX;
      this.lastMouseY = event.clientY;
      this.pendingPanX += rawDx;
      this.pendingPanY += rawDy;
      this.ensureNavigationAnimation();
    } else if (this.isRotating) {
      if ((event.buttons & 4) === 0) {
        this.isRotating = false;
        return;
      }
      const dx = event.clientX - this.lastMouseX;
      const dy = event.clientY - this.lastMouseY;
      this.lastMouseX = event.clientX;
      this.lastMouseY = event.clientY;
      this.pendingRotateX += dx;
      // Bind pitch input to the pose where it was authored. At full close the
      // orbit pitch is invisible, so discard vertical drag immediately rather
      // than letting a same-frame wheel-out reveal it as hidden pitch drift.
      this.pendingRotateY += dy * (1 - this.getCloseBlend());
      this.ensureNavigationAnimation();
    }
  };

  private readonly onMouseUp = (event: MouseEvent): void => {
    if (event.button === 2) this.isPanning = false;
    if (event.button === 1) this.isRotating = false;
  };

  private readonly onWheel = (event: WheelEvent): void => {
    if (!this.inputEnabled) return;
    if (this.config.shouldIgnoreInput?.(event)) return;
    event.preventDefault();
    if (this.illustratedMapModeTransitionTarget !== null) return;
    const distanceBefore = this.targetDistance;
    const renderedDistanceBefore = this.currentDistance;
    const mapActiveBefore = this.illustratedMapActive;
    const mapEntryPendingBefore = this.illustratedMapEntryPending;
    const mapExitPendingBefore = this.illustratedMapExitPending;
    const zoomDirection = this.consumeWheelZoomDirection(event);
    if (zoomDirection > 0) {
      if (this.illustratedMapActive) {
        this.illustratedMapExitPending = false;
        this.stepIllustratedMapZoom(1);
      } else if (this.targetDistance >= this.liveWorldMaxDistance - DISTANCE_EPSILON) {
        if (this.config.isIllustratedMapReady?.() !== false) {
          if (this.isZoomSettled()) this.enterIllustratedMap();
          // Treat a burst beyond the live maximum as one deliberate map-entry
          // detent; authored map tiers begin only after the exact handoff.
          else this.illustratedMapEntryPending = true;
        }
      } else {
        const nextDistance = this.targetDistance * CAMERA_ZOOM_STEP_MULTIPLIER;
        const overviewStop = Math.min(
          LIVE_WORLD_OVERVIEW_DISTANCE,
          this.liveWorldMaxDistance,
        );
        // Preserve the established 30% overview as an exact stop before the
        // newly added outer live-world tier. This also makes the inward path
        // retrace the same two authored distances in reverse.
        this.targetDistance = (
          this.targetDistance < overviewStop - DISTANCE_EPSILON
          && nextDistance > overviewStop
        )
          ? overviewStop
          : THREE.MathUtils.clamp(
            nextDistance,
            this.getMinDistance(),
            this.liveWorldMaxDistance,
          );
      }
    } else if (zoomDirection < 0) {
      if (this.illustratedMapActive) {
        if (this.illustratedMapZoomTier > 0) {
          this.stepIllustratedMapZoom(-1);
        } else if (this.isZoomSettled()) {
          this.exitIllustratedMap();
        } else {
          // A rapid inward burst may reach tier zero before its camera glide.
          // Keep the paper render owner until the exact continuity pose arrives.
          this.illustratedMapExitPending = true;
        }
      } else {
        if (this.illustratedMapEntryPending) {
          // The pending outward event only requested the map handoff. Its
          // reciprocal inward event cancels that request at the same outer
          // live-world stop.
          this.illustratedMapEntryPending = false;
        } else {
          this.targetDistance = this.clampDistance(
            this.targetDistance / CAMERA_ZOOM_STEP_MULTIPLIER,
          );
        }
      }
    }
    let viewChanged = this.targetDistance !== distanceBefore
      || this.illustratedMapActive !== mapActiveBefore
      || this.illustratedMapEntryPending !== mapEntryPendingBefore
      || this.illustratedMapExitPending !== mapExitPendingBefore;
    if (event.deltaX !== 0) {
      this.pan(event.deltaX * 0.03, 0);
      viewChanged = true;
    }
    if (!viewChanged) return;
    this.wheelNavigationUntilMs = performance.now() + WHEEL_NAVIGATION_GRACE_MS;
    const renderedViewChanged = this.currentDistance !== renderedDistanceBefore
      || this.illustratedMapActive !== mapActiveBefore
      || event.deltaX !== 0;
    if (renderedViewChanged) this.commitViewChange();
    else this.applyCursor();
    this.ensureNavigationAnimation();
  };

  private consumeWheelZoomDirection(event: WheelEvent): -1 | 0 | 1 {
    const deltaY = this.normalizeWheelDelta(event.deltaY, event.deltaMode);
    if (!Number.isFinite(deltaY) || deltaY === 0) return 0;
    const now = performance.now();
    const directionChanged = this.accumulatedWheelDeltaY !== 0
      && Math.sign(deltaY) !== Math.sign(this.accumulatedWheelDeltaY);
    if (
      directionChanged
      || now - this.lastWheelDeltaTimeMs > WHEEL_ACCUMULATION_TIMEOUT_MS
    ) {
      this.accumulatedWheelDeltaY = 0;
    }
    this.lastWheelDeltaTimeMs = now;
    this.accumulatedWheelDeltaY += deltaY;
    if (Math.abs(this.accumulatedWheelDeltaY) < WHEEL_ZOOM_STEP_DELTA) return 0;

    const direction = Math.sign(this.accumulatedWheelDeltaY) as -1 | 1;
    // Discard excess from this event: even a coarse wheel/page delta owns at
    // most one zoom transition, while trackpad micro-deltas still accumulate.
    this.accumulatedWheelDeltaY = 0;
    return direction;
  }

  private normalizeWheelDelta(delta: number, deltaMode: number): number {
    if (deltaMode === 1) return delta * WHEEL_LINE_PIXEL_SCALE;
    if (deltaMode === 2) {
      const pagePixels = this.config.domElement.clientHeight || WHEEL_PAGE_PIXEL_FALLBACK;
      return delta * pagePixels;
    }
    return delta;
  }

  private resetWheelAccumulator(): void {
    this.accumulatedWheelDeltaY = 0;
    this.lastWheelDeltaTimeMs = Number.NEGATIVE_INFINITY;
  }

  private updateAnimatedNavigationMotion(dt: number): boolean {
    const zoomChanged = this.updateZoom(dt);
    const pointerChanged = this.updatePointerMotion(dt);
    const keyboardPanChanged = this.updateKeyboardPanMotion(dt);
    const keyboardRotationChanged = this.updateKeyboardRotationMotion(dt);
    return zoomChanged
      || pointerChanged
      || keyboardPanChanged
      || keyboardRotationChanged;
  }

  private updateZoom(dt: number): boolean {
    this.targetDistance = this.clampDistance(this.targetDistance);
    if (this.isZoomSettled()) {
      const distanceChanged = this.currentDistance !== this.targetDistance;
      this.currentDistance = this.targetDistance;
      if (this.illustratedMapEntryPending) {
        this.illustratedMapEntryPending = false;
        this.enterIllustratedMap();
        return true;
      }
      if (this.illustratedMapExitPending) {
        this.illustratedMapExitPending = false;
        this.exitIllustratedMap();
        return true;
      }
      return distanceChanged;
    }

    const safeDt = Number.isFinite(dt) ? Math.max(0, dt) : 0;
    if (safeDt <= 0) return false;
    this.currentDistance = Math.exp(THREE.MathUtils.damp(
      Math.log(this.currentDistance),
      Math.log(this.targetDistance),
      ZOOM_DAMPING,
      safeDt,
    ));
    const settled = this.isZoomSettled();
    if (settled) this.currentDistance = this.targetDistance;
    if (this.illustratedMapEntryPending && settled) {
      this.illustratedMapEntryPending = false;
      this.enterIllustratedMap();
    } else if (this.illustratedMapExitPending && settled) {
      this.illustratedMapExitPending = false;
      this.exitIllustratedMap();
    }
    return true;
  }

  private updatePointerMotion(dt: number): boolean {
    const safeDt = Number.isFinite(dt) ? Math.max(0, dt) : 0;
    if (safeDt <= 0 || !this.hasPendingPointerMotion()) return false;
    const response = 1 - Math.exp(-POINTER_MOTION_DAMPING * safeDt);
    let changed = false;

    if (this.pendingPanX !== 0 || this.pendingPanY !== 0) {
      const panX = this.consumePointerAxis(this.pendingPanX, response);
      const panY = this.consumePointerAxis(this.pendingPanY, response);
      this.pendingPanX -= panX;
      this.pendingPanY -= panY;
      const scale = this.getPanScale();
      this.pan(
        panX * RMB_PAN_MULTIPLIER * scale,
        panY * RMB_PAN_MULTIPLIER * scale,
      );
      changed = panX !== 0 || panY !== 0;
    }

    if (this.pendingRotateX !== 0 || this.pendingRotateY !== 0) {
      const rotateX = this.consumePointerAxis(this.pendingRotateX, response);
      const rotateY = this.consumePointerAxis(this.pendingRotateY, response);
      this.pendingRotateX -= rotateX;
      this.pendingRotateY -= rotateY;
      this.currentYaw = this.normalizeAngle(
        this.currentYaw + rotateX * ROTATE_SENSITIVITY,
      );
      const minimumPitch = this.getMinimumPitch();
      const nextPitch = THREE.MathUtils.clamp(
        this.currentPitch + rotateY * PITCH_SENSITIVITY,
        minimumPitch,
        MAX_PITCH,
      );
      if (
        (nextPitch === MAX_PITCH && this.pendingRotateY > 0)
        || (nextPitch === minimumPitch && this.pendingRotateY < 0)
      ) {
        this.pendingRotateY = 0;
      }
      this.currentPitch = nextPitch;
      changed = changed || rotateX !== 0 || rotateY !== 0;
    }

    return changed;
  }

  private consumePointerAxis(value: number, response: number): number {
    const remaining = value * (1 - response);
    return Math.abs(remaining) <= POINTER_MOTION_SETTLE_PIXELS
      ? value
      : value * response;
  }

  private hasPendingPointerMotion(): boolean {
    return this.pendingPanX !== 0
      || this.pendingPanY !== 0
      || this.pendingRotateX !== 0
      || this.pendingRotateY !== 0;
  }

  private resetPointerMotion(): void {
    this.pendingPanX = 0;
    this.pendingPanY = 0;
    this.pendingRotateX = 0;
    this.pendingRotateY = 0;
  }

  private updateKeyboardPanMotion(dt: number): boolean {
    const safeDt = Number.isFinite(dt) ? Math.max(0, dt) : 0;
    if (safeDt <= 0 || !this.hasKeyboardPanMotion()) return false;

    let inputX = Number(this.keys.has('a') || this.keys.has('arrowleft'))
      - Number(this.keys.has('d') || this.keys.has('arrowright'));
    let inputY = Number(this.keys.has('w') || this.keys.has('arrowup'))
      - Number(this.keys.has('s') || this.keys.has('arrowdown'));
    const inputLength = Math.hypot(inputX, inputY);
    if (inputLength > 1) {
      inputX /= inputLength;
      inputY /= inputLength;
    }
    const decay = Math.exp(-KEY_PAN_DAMPING * safeDt);
    const responseIntegral = (1 - decay) / KEY_PAN_DAMPING;
    let travelX = inputX * safeDt
      + (this.keyboardPanVelocityX - inputX) * responseIntegral;
    let travelY = inputY * safeDt
      + (this.keyboardPanVelocityY - inputY) * responseIntegral;
    let nextVelocityX = inputX
      + (this.keyboardPanVelocityX - inputX) * decay;
    let nextVelocityY = inputY
      + (this.keyboardPanVelocityY - inputY) * decay;

    if (Math.abs(nextVelocityX - inputX) <= KEY_PAN_SETTLE_SPEED) {
      travelX += (nextVelocityX - inputX) / KEY_PAN_DAMPING;
      nextVelocityX = inputX;
    }
    if (Math.abs(nextVelocityY - inputY) <= KEY_PAN_SETTLE_SPEED) {
      travelY += (nextVelocityY - inputY) / KEY_PAN_DAMPING;
      nextVelocityY = inputY;
    }

    this.keyboardPanVelocityX = nextVelocityX;
    this.keyboardPanVelocityY = nextVelocityY;
    if (travelX === 0 && travelY === 0) return false;
    const scale = KEY_PAN_SPEED * this.getKeyboardPanScale();
    this.pan(travelX * scale, travelY * scale);
    return true;
  }

  private hasKeyboardPanInput(): boolean {
    const horizontalIntent = Number(this.keys.has('a') || this.keys.has('arrowleft'))
      - Number(this.keys.has('d') || this.keys.has('arrowright'));
    const verticalIntent = Number(this.keys.has('w') || this.keys.has('arrowup'))
      - Number(this.keys.has('s') || this.keys.has('arrowdown'));
    return horizontalIntent !== 0 || verticalIntent !== 0;
  }

  private hasKeyboardPanMotion(): boolean {
    return this.hasKeyboardPanInput()
      || this.keyboardPanVelocityX !== 0
      || this.keyboardPanVelocityY !== 0;
  }

  private resetKeyboardPanMotion(): void {
    this.keyboardPanVelocityX = 0;
    this.keyboardPanVelocityY = 0;
  }

  private updateKeyboardRotationMotion(dt: number): boolean {
    const direction = Number(this.keys.has('e')) - Number(this.keys.has('q'));
    if (direction === 0 || !Number.isFinite(dt) || dt <= 0) return false;
    this.currentYaw = this.normalizeAngle(
      this.currentYaw + direction * KEY_ROTATE_SPEED * dt,
    );
    return true;
  }

  private hasKeyboardRotationInput(): boolean {
    return this.keys.has('q') !== this.keys.has('e');
  }

  private isZoomSettled(): boolean {
    const settleDistance = Math.max(
      DISTANCE_EPSILON,
      Math.abs(this.targetDistance) * ZOOM_SETTLE_RATIO,
    );
    return Math.abs(this.currentDistance - this.targetDistance) <= settleDistance;
  }

  private hasAnimatedNavigationMotion(): boolean {
    return !this.isZoomSettled()
      || this.illustratedMapEntryPending
      || this.illustratedMapExitPending
      || this.hasPendingPointerMotion()
      || this.hasKeyboardPanMotion()
      || this.hasKeyboardRotationInput();
  }

  private ensureNavigationAnimation(): void {
    if (this.config.continuousRenderLoop) return;
    if (!this.inputEnabled) return;
    if (!this.hasAnimatedNavigationMotion()) return;
    // This frame will render the combined pan/orbit/zoom pose, so replace any
    // earlier demand-render invalidation instead of drawing twice.
    if (this.viewChangeFrame !== 0) {
      cancelAnimationFrame(this.viewChangeFrame);
      this.viewChangeFrame = 0;
    }
    if (this.navigationAnimationFrame !== 0) return;
    this.lastNavigationAnimationTimeMs = performance.now();
    this.navigationAnimationFrame = requestAnimationFrame(this.onNavigationAnimationFrame);
  }

  private cancelNavigationAnimation(): void {
    if (this.navigationAnimationFrame !== 0) {
      cancelAnimationFrame(this.navigationAnimationFrame);
      this.navigationAnimationFrame = 0;
    }
    this.lastNavigationAnimationTimeMs = Number.NaN;
  }

  private readonly onNavigationAnimationFrame = (time: number): void => {
    this.navigationAnimationFrame = 0;
    if (!this.inputEnabled || this.config.continuousRenderLoop) {
      this.lastNavigationAnimationTimeMs = Number.NaN;
      return;
    }
    const previousTime = Number.isFinite(this.lastNavigationAnimationTimeMs)
      ? this.lastNavigationAnimationTimeMs
      : time;
    const dt = THREE.MathUtils.clamp((time - previousTime) / 1000, 0.001, 0.05);
    this.lastNavigationAnimationTimeMs = time;
    const motionChanged = this.updateAnimatedNavigationMotion(dt);
    if (motionChanged) {
      this.updateCamera();
      this.applyCursor();
      if (this.viewChangeFrame !== 0) {
        cancelAnimationFrame(this.viewChangeFrame);
        this.viewChangeFrame = 0;
      }
      this.config.onViewChanged?.();
    }
    if (this.hasAnimatedNavigationMotion()) {
      this.navigationAnimationFrame = requestAnimationFrame(this.onNavigationAnimationFrame);
    } else {
      this.lastNavigationAnimationTimeMs = Number.NaN;
    }
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!this.inputEnabled || this.illustratedMapModeTransitionTarget !== null) return;
    const target = event.target as HTMLElement | null;
    const tag = target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return;
    const key = event.key.toLowerCase();
    if (key.startsWith('arrow')) event.preventDefault();
    this.keys.add(key);
    if (NAVIGATION_KEYS.has(key)) this.ensureNavigationAnimation();
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    const key = event.key.toLowerCase();
    this.keys.delete(key);
    if (NAVIGATION_KEYS.has(key)) this.ensureNavigationAnimation();
  };

  private readonly onWindowBlur = (): void => {
    this.isPanning = false;
    this.isRotating = false;
    this.wheelNavigationUntilMs = 0;
    this.keys.clear();
    this.resetPointerMotion();
    this.resetKeyboardPanMotion();
    this.resetWheelAccumulator();
    if (!this.hasAnimatedNavigationMotion()) this.cancelNavigationAnimation();
    this.applyCursor();
  };

  private readonly onViewportResize = (): void => {
    if (this.viewportChangeFrame !== 0) return;
    this.viewportChangeFrame = requestAnimationFrame(() => {
      this.viewportChangeFrame = 0;
      if (!this.illustratedMapActive) return;
      // SceneManager's synchronous resize listener owns camera.aspect. Run on
      // the following frame so listener ordering cannot leave us using the old
      // projection while recomputing the terminal desk fit.
      this.commitViewChange();
      this.ensureNavigationAnimation();
    });
  };

  private readonly onContextMenu = (event: Event): void => event.preventDefault();

  private pan(dx: number, dy: number): void {
    const target = this.config.target;
    const rightX = -Math.sin(this.currentYaw);
    const rightZ = Math.cos(this.currentYaw);
    const forwardX = -Math.cos(this.currentYaw);
    const forwardZ = -Math.sin(this.currentYaw);
    target.x += rightX * dx + forwardX * dy;
    target.z += rightZ * dx + forwardZ * dy;
    this.clampTarget();
  }

  private commitViewChange(): void {
    this.updateCamera();
    this.applyCursor();
    this.notifyViewChanged();
  }

  private notifyViewChanged(): void {
    if (!this.config.onViewChanged || this.config.continuousRenderLoop) return;
    if (this.viewChangeFrame !== 0) return;
    this.viewChangeFrame = requestAnimationFrame(() => {
      this.viewChangeFrame = 0;
      this.config.onViewChanged?.();
    });
  }

  private getMinDistance(): number {
    if (this.config.minimumOrbitDistance !== undefined) return this.minimumOrbitDistance;
    return this.minimumOrbitDistance
      + Math.max(0, this.config.getHeightAt(this.config.target.x, this.config.target.z)) * 0.08;
  }

  private getMinimumPitch(): number {
    return this.illustratedMapActive ? ILLUSTRATED_MAP_MIN_PITCH : MIN_PITCH;
  }

  private getCloseHeightFromTarget(): number {
    const target = this.config.target;
    const forward = this.getForwardXZ();
    const camX = target.x - forward.x * CLOSE_BACK_DISTANCE;
    const camZ = target.z - forward.z * CLOSE_BACK_DISTANCE;
    return this.config.getHeightAt(camX, camZ)
      + CLOSE_HEIGHT_ABOVE_TERRAIN
      - target.y;
  }

  private getCloseCurveStartDistance(
    minDistance = this.getMinDistance(),
    closeHeightFromTarget = this.getCloseHeightFromTarget(),
  ): number {
    return Math.min(
      this.liveWorldMaxDistance,
      computeCloseCurveStartDistance(
        minDistance,
        this.currentPitch,
        closeHeightFromTarget,
      ),
    );
  }

  private getCloseBlend(): number {
    const minDistance = this.getMinDistance();
    return evalCloseBlendFromDistance(
      this.currentDistance,
      minDistance,
      this.getCloseCurveStartDistance(minDistance),
    );
  }

  private getPanScale(): number {
    const ratio = this.currentDistance / 48;
    const base = THREE.MathUtils.clamp(ratio * ratio * 1.8, 0.55, 18);
    const closeBlend = this.getCloseBlend();
    return THREE.MathUtils.lerp(base, base * CLOSE_PAN_SPEED_SCALE, closeBlend);
  }

  private getKeyboardPanScale(): number {
    const zoomProgress = THREE.MathUtils.smoothstep(
      this.getZoomPercent(),
      KEY_PAN_CLOSE_ZOOM_START_PERCENT,
      MAX_ZOOM_PERCENT,
    );
    const closeZoomMultiplier = THREE.MathUtils.lerp(
      1,
      KEY_PAN_MAX_ZOOM_MULTIPLIER,
      zoomProgress,
    );
    return this.getPanScale() * closeZoomMultiplier;
  }

  private clampDistance(value: number): number {
    if (this.illustratedMapActive) {
      return THREE.MathUtils.clamp(
        value,
        this.illustratedMapZoomStops[0],
        this.illustratedMapZoomStops[this.illustratedMapZoomStops.length - 1],
      );
    }
    return THREE.MathUtils.clamp(value, this.getMinDistance(), this.liveWorldMaxDistance);
  }

  private enterIllustratedMap(): void {
    if (this.illustratedMapActive || this.illustratedMapModeTransitionTarget === true) return;
    if (this.config.isIllustratedMapReady?.() === false) return;
    if (!this.config.onIllustratedMapModeTransition) {
      this.commitIllustratedMapEntry();
      return;
    }
    this.beginIllustratedMapModeTransition(true, () => this.commitIllustratedMapEntry());
  }

  private commitIllustratedMapEntry(): void {
    if (this.illustratedMapActive) return;
    if (this.config.isIllustratedMapReady?.() === false) return;
    // Low world-camera angles are useful for terrain inspection, but make the
    // physical paper collapse into a thin strip. Lift only the paper-map pose
    // into its authored composition envelope before solving its zoom stops.
    this.currentPitch = Math.max(this.currentPitch, ILLUSTRATED_MAP_MIN_PITCH);
    this.refreshIllustratedMapFraming(true);
    this.illustratedMapActive = true;
    this.illustratedMapEntryPending = false;
    this.illustratedMapExitPending = false;
    this.illustratedMapZoomTier = 0;
    // This is a render-owner handoff, not another camera move. Keeping the
    // exact overview pose makes the parchment feel as though it unfolded over
    // the terrain and preserves the established readable map scale.
    this.currentDistance = this.illustratedMapZoomStops[0];
    this.targetDistance = this.currentDistance;
    this.worldFarBeforeIllustratedMap = this.config.camera.far;
    this.updateIllustratedMapProjection();
    this.updateCamera();
    this.config.camera.updateMatrixWorld(true);
    this.config.onIllustratedMapModeChanged?.(true);
  }

  private exitIllustratedMap(immediate = false): void {
    if (this.illustratedMapModeTransitionTarget === true && !this.illustratedMapActive) {
      this.cancelPendingIllustratedMapModeTransition();
      return;
    }
    if (!this.illustratedMapActive) return;
    if (immediate || !this.config.onIllustratedMapModeTransition) {
      this.cancelPendingIllustratedMapModeTransition();
      this.commitIllustratedMapExit();
      return;
    }
    if (this.illustratedMapModeTransitionTarget === false) return;
    this.beginIllustratedMapModeTransition(false, () => this.commitIllustratedMapExit());
  }

  private commitIllustratedMapExit(): void {
    if (!this.illustratedMapActive) return;
    this.illustratedMapActive = false;
    this.illustratedMapEntryPending = false;
    this.illustratedMapExitPending = false;
    this.illustratedMapZoomTier = 0;
    this.currentDistance = this.liveWorldMaxDistance;
    this.targetDistance = this.currentDistance;
    this.restoreWorldProjection();
    // Rebuild the complete world pose before releasing render ownership. The
    // mode callback is allowed to render immediately, so it must never observe
    // the paper-map projection or a stale camera matrix.
    this.updateCamera();
    this.config.camera.updateMatrixWorld(true);
    this.config.onIllustratedMapModeChanged?.(false);
  }

  private beginIllustratedMapModeTransition(
    active: boolean,
    commit: () => void,
  ): void {
    const transition = this.config.onIllustratedMapModeTransition;
    if (!transition) {
      commit();
      return;
    }
    this.cancelPendingIllustratedMapModeTransition();
    this.illustratedMapEntryPending = false;
    this.illustratedMapExitPending = false;
    this.illustratedMapModeTransitionTarget = active;
    this.resetPointerMotion();
    this.resetKeyboardPanMotion();
    this.keys.clear();
    try {
      const cancel = transition(active, () => {
        if (this.illustratedMapModeTransitionTarget !== active) return;
        this.illustratedMapModeTransitionTarget = null;
        this.cancelIllustratedMapModeTransition = null;
        commit();
      });
      if (
        this.illustratedMapModeTransitionTarget === active
        && typeof cancel === 'function'
      ) this.cancelIllustratedMapModeTransition = cancel;
    } catch (error) {
      console.warn('Illustrated map opacity transition failed; using an immediate handoff.', error);
      this.illustratedMapModeTransitionTarget = null;
      this.cancelIllustratedMapModeTransition = null;
      commit();
    }
  }

  private cancelPendingIllustratedMapModeTransition(): void {
    if (this.illustratedMapModeTransitionTarget === null) return;
    this.illustratedMapModeTransitionTarget = null;
    const cancel = this.cancelIllustratedMapModeTransition;
    this.cancelIllustratedMapModeTransition = null;
    cancel?.();
    this.illustratedMapEntryPending = false;
    this.illustratedMapExitPending = false;
  }

  private stepIllustratedMapZoom(direction: -1 | 1): void {
    if (!this.illustratedMapActive) return;
    const lastTier = this.illustratedMapZoomStops.length - 1;
    this.illustratedMapZoomTier = THREE.MathUtils.clamp(
      this.illustratedMapZoomTier + direction,
      0,
      lastTier,
    );
    // Retain authored composition destinations while gliding through them with
    // the same logarithmic response as the live-world wheel zoom.
    this.targetDistance = this.illustratedMapZoomStops[this.illustratedMapZoomTier];
  }

  private refreshIllustratedMapFraming(force = false): void {
    const camera = this.config.camera;
    const aspect = Number.isFinite(camera.aspect) && camera.aspect > 0
      ? camera.aspect
      : 1;
    const target = this.config.target;
    if (
      !force
      && aspect === this.framedAspect
      && this.currentYaw === this.framedYaw
      && this.currentPitch === this.framedPitch
      && target.x === this.framedTargetX
      && target.z === this.framedTargetZ
    ) return;

    this.framedAspect = aspect;
    this.framedYaw = this.currentYaw;
    this.framedPitch = this.currentPitch;
    this.framedTargetX = target.x;
    this.framedTargetZ = target.z;
    this.illustratedMapZoomStops = computeIllustratedMapZoomStops(
      this.config.bounds,
      DEFAULT_FOV,
      this.liveWorldMaxDistance,
      {
        aspect,
        yaw: this.currentYaw,
        pitch: this.currentPitch,
        targetX: target.x,
        targetZ: target.z,
      },
    );
    this.illustratedMapFarPlane = computeIllustratedMapFarPlane(
      this.config.bounds,
      this.illustratedMapZoomStops[this.illustratedMapZoomStops.length - 1],
    );
    if (!this.illustratedMapActive) return;
    // A pan/orbit/resize can change the scale-aware authored stop. Retarget the
    // active tier without cutting the camera out of an in-flight glide.
    this.targetDistance = this.illustratedMapZoomStops[this.illustratedMapZoomTier];
    this.updateIllustratedMapProjection();
  }

  private updateIllustratedMapProjection(): void {
    if (this.worldFarBeforeIllustratedMap === null) return;
    const mapFar = Math.max(
      this.worldFarBeforeIllustratedMap,
      this.illustratedMapFarPlane,
    );
    if (Math.abs(this.config.camera.far - mapFar) <= DISTANCE_EPSILON) return;
    this.config.camera.far = mapFar;
    this.config.camera.updateProjectionMatrix();
  }

  private restoreWorldProjection(): void {
    if (this.worldFarBeforeIllustratedMap === null) return;
    const worldFar = this.worldFarBeforeIllustratedMap;
    this.worldFarBeforeIllustratedMap = null;
    if (Math.abs(this.config.camera.far - worldFar) <= DISTANCE_EPSILON) return;
    this.config.camera.far = worldFar;
    this.config.camera.updateProjectionMatrix();
  }

  private clampTarget(): void {
    const { bounds, target } = this.config;
    target.x = THREE.MathUtils.clamp(target.x, bounds.minX, bounds.maxX);
    target.z = THREE.MathUtils.clamp(target.z, bounds.minZ, bounds.maxZ);
    target.y = this.config.getHeightAt(target.x, target.z);
  }

  private getForwardXZ(): THREE.Vector3 {
    this.forward.set(-Math.cos(this.currentYaw), 0, -Math.sin(this.currentYaw));
    return this.forward;
  }

  private updateCamera(): void {
    if (this.illustratedMapActive) this.refreshIllustratedMapFraming();
    const target = this.config.target;
    const minDistance = this.getMinDistance();

    this.orbitDirection.set(
      Math.cos(this.currentPitch) * Math.cos(this.currentYaw),
      Math.sin(this.currentPitch),
      Math.cos(this.currentPitch) * Math.sin(this.currentYaw),
    );

    if (this.config.orbitOnly) {
      const camera = this.config.camera;
      camera.position.copy(target).addScaledVector(
        this.orbitDirection,
        this.currentDistance,
      );
      camera.lookAt(target);
      const fov = this.config.orbitFov ?? DEFAULT_FOV;
      if (Math.abs(camera.fov - fov) > 0.01) {
        camera.fov = fov;
        camera.updateProjectionMatrix();
      }
      return;
    }

    const forward = this.getForwardXZ();
    const camX = target.x - forward.x * CLOSE_BACK_DISTANCE;
    const camZ = target.z - forward.z * CLOSE_BACK_DISTANCE;
    const terrainUnderCamera = this.config.getHeightAt(camX, camZ);
    this.closePosition.set(camX, terrainUnderCamera + CLOSE_HEIGHT_ABOVE_TERRAIN, camZ);
    const closeCurveStartDistance = this.getCloseCurveStartDistance(
      minDistance,
      this.closePosition.y - target.y,
    );
    const closeCurveProgress = evalCloseCurveProgress(
      this.currentDistance,
      minDistance,
      closeCurveStartDistance,
    );
    const closeBlend = evalCloseBlendFromDistance(
      this.currentDistance,
      minDistance,
      closeCurveStartDistance,
    );

    const camera = this.config.camera;
    if (closeCurveProgress >= 1) {
      camera.position.copy(target).addScaledVector(
        this.orbitDirection,
        this.currentDistance,
      );
    } else {
      // One authored Hermite curve owns the entire ground-eye handoff. Its
      // outer tangent matches the ordinary distance orbit, while its zero
      // inner tangent and monotone handoff keep outward zoom from doglegging
      // across the terrain. Because pose is a pure function of distance, the
      // same curve is retraced exactly when wheel direction reverses.
      this.orbitPosition.copy(target).addScaledVector(
        this.orbitDirection,
        closeCurveStartDistance,
      );
      const t = closeCurveProgress;
      const t2 = t * t;
      const t3 = t2 * t;
      const closeWeight = 2 * t3 - 3 * t2 + 1;
      const orbitWeight = -2 * t3 + 3 * t2;
      const orbitTangentWeight = t3 - t2;
      camera.position
        .copy(this.closePosition)
        .multiplyScalar(closeWeight)
        .addScaledVector(this.orbitPosition, orbitWeight)
        .addScaledVector(
          this.orbitDirection,
          orbitTangentWeight * (closeCurveStartDistance - minDistance),
        );
    }
    this.enforceTerrainClearance(camera.position);

    const lookX = target.x + forward.x * CLOSE_LOOK_AHEAD;
    const lookZ = target.z + forward.z * CLOSE_LOOK_AHEAD;
    const lookTerrainY = this.config.getHeightAt(lookX, lookZ);
    this.lookAtPoint.set(lookX, lookTerrainY + CLOSE_LOOK_HEIGHT_OFFSET, lookZ);
    this.lookAtPoint.lerp(target, 1 - closeBlend);
    camera.lookAt(this.lookAtPoint);

    const fov = THREE.MathUtils.lerp(this.config.orbitFov ?? DEFAULT_FOV, CLOSE_FOV, closeBlend);
    const near = orbitNearPlaneForHeight(
      camera.position.y - this.config.getHeightAt(camera.position.x, camera.position.z),
    );
    if (Math.abs(camera.fov - fov) > 0.01 || Math.abs(camera.near - near) > 0.001) {
      camera.fov = fov;
      camera.near = near;
      camera.updateProjectionMatrix();
    }
  }

  private enforceTerrainClearance(position: THREE.Vector3): void {
    const terrainY = this.config.getHeightAt(position.x, position.z);
    const minY = terrainY + MIN_CAMERA_TERRAIN_CLEARANCE;
    if (position.y < minY) position.y = minY;
  }

  private applyCursor(): void {
    const override = this.config.getCursorOverride?.();
    let cursor = override ?? 'var(--medieval-cursor, default)';
    if (!override && this.isPanning) cursor = 'var(--medieval-pan-cursor, move)';
    if (!override && this.isRotating) cursor = 'var(--medieval-orbit-cursor, grabbing)';
    if (cursor === this.activeCursor) return;
    this.activeCursor = cursor;
    this.config.domElement.style.cursor = cursor;
    document.body.style.cursor = cursor;
  }

  private normalizeAngle(angle: number): number {
    return Math.atan2(Math.sin(angle), Math.cos(angle));
  }
}
