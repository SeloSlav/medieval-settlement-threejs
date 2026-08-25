import * as THREE from 'three';
import type { TerrainBounds } from '../terrain/Terrain.ts';
import { resolveRoadAwareGroundY } from '../roads/RoadSurfaceSampling.ts';
import { DEFAULT_FOV } from './CameraCurves.ts';
import { FP_LOCOMOTION_AIRBORNE_SUBSTEP_SCALE } from './fp/fpAirborneWalkPolicy.ts';
import {
  createFpLookInertiaState,
  normalizeBodyYaw,
  resetFpLookInertia,
  stepFpFreeLookRecenter,
  stepFpLookInertia,
  type FpLookAngleState,
} from './fp/fpCameraLook.ts';
import { CAM_BOB_DIP_Y } from './fp/fpConstants.ts';
import type { FpCollisionWorld } from './fp/fpCollisionWorld.ts';
import {
  publishCompassHeadingFromYawRad,
  resetCompassHeading,
} from '../ui/compassHeading.ts';
import {
  createFpLocomotionState,
  FP_LOCOMOTION_FEET_SKIN_M,
  FP_WALK_PROBE_DY,
  FP_WALK_FOOT_RADIUS_XZ,
  FP_WALK_STEP_UP_MARGIN,
  fpLocomotionConstants,
  queueFpJump,
  stepFpLocomotion,
  type FpLocomotionInput,
  type FpLocomotionState,
  type FpLocomotionWalkOptions,
  type WalkGroundSampler,
} from './fp/fpLocomotion.ts';
import type {
  FootstepEvent,
  FootstepMotion,
  FootstepSurface,
} from '../audio/audioCatalog.ts';
import { FirstPersonPlacement } from './FirstPersonPlacement.ts';
import {
  createFpLandingSoundState,
  resetFpLandingSoundState,
  stepFpLandingSound,
} from './fp/fpLandingSound.ts';
import {
  createFpFootstepCadenceState,
  resetFpFootstepCadenceState,
  stepFpFootstepCadence,
  takeFpLandingFootstep,
} from './fp/fpFootstepCadence.ts';

// The strategic camera needs a long 2.6 km range, but keeping its 10 cm near
// plane while walking wastes half of the available depth precision. A 20 cm
// near plane remains inside the player's 22 cm collision radius while reducing
// direction-dependent depth fighting on overlapping foliage cards.
export const FIRST_PERSON_CAMERA_NEAR_METERS = 0.2;

export type FirstPersonControllerConfig = {
  camera: THREE.PerspectiveCamera;
  domElement: HTMLElement;
  bounds: TerrainBounds;
  getHeightAt: (x: number, z: number) => number;
  getRoadDeckY?: (x: number, z: number) => number | null;
  collisionWorld?: FpCollisionWorld;
  getOrbitSpawn?: () => FirstPersonSpawn;
  placementParent?: THREE.Object3D;
  pickPlacementGround?: (clientX: number, clientY: number) => THREE.Vector3 | null;
  onPlacementChange?: (active: boolean) => void;
  onModeChange?: (active: boolean) => void;
  getFootstepSurface?: (x: number, y: number, z: number) => FootstepSurface;
  onFootstep?: (event: FootstepEvent) => void;
  isMenuOpen?: () => boolean;
  isSessionReady?: () => boolean;
};

export type FirstPersonSpawn = {
  x: number;
  z: number;
  yaw: number;
  pitch?: number;
};

export class FirstPersonController {
  private readonly config: FirstPersonControllerConfig;
  private readonly pos = new THREE.Vector3();
  private readonly keys = new Set<string>();
  private readonly look: FpLookAngleState = { bodyYaw: 0, pitch: 0, headLookYaw: 0 };
  private readonly lookInertia = createFpLookInertiaState();
  private readonly loco: FpLocomotionState = createFpLocomotionState();
  private readonly landingSound = createFpLandingSoundState();
  private readonly footstepCadence = createFpFootstepCadenceState();
  private readonly input: FpLocomotionInput = {
    forward: false,
    backward: false,
    left: false,
    right: false,
    sprint: false,
    crouch: false,
    jumpHeld: false,
  };
  private readonly walkOpts: FpLocomotionWalkOptions;
  private active = false;
  private savedFov = DEFAULT_FOV;
  private savedNear = 0.1;
  private reticule: HTMLElement | null = null;
  private readonly placement: FirstPersonPlacement | null;
  private crouchToggle = false;
  private camBobY = 0;
  private camBobRoll = 0;
  private lastEyeLine: number = fpLocomotionConstants.eyeStand;
  private pendingLookDeltaX = 0;
  private pendingLookDeltaY = 0;

  constructor(config: FirstPersonControllerConfig) {
    this.config = config;
    this.placement = config.placementParent && config.pickPlacementGround
      ? new FirstPersonPlacement({
          camera: config.camera,
          domElement: config.domElement,
          parent: config.placementParent,
          pickGround: config.pickPlacementGround,
          isInputBlocked: () => config.isMenuOpen?.() ?? false,
          onConfirm: (point) => {
            const orbitSpawn = config.getOrbitSpawn?.();
            this.endPlacement();
            this.activate({
              x: point.x,
              z: point.z,
              yaw: orbitSpawn?.yaw ?? 0,
              pitch: orbitSpawn?.pitch,
            });
          },
          onCancel: () => this.endPlacement(),
        })
      : null;
    this.walkOpts = {
      sampleWalkGroundTopY: this.sampleTerrainGround,
      resolveBodyCollisions: (position, previousX, previousZ, state, bodyHeight) => {
        this.config.collisionWorld?.resolvePlayer(
          position,
          previousX,
          previousZ,
          state.velocity,
          {
            bodyHeight,
            footRadius: FP_WALK_FOOT_RADIUS_XZ,
            maxStepHeight: FP_WALK_STEP_UP_MARGIN,
            grounded: state.grounded,
          },
        );
      },
      substepsForDt: (dtSec, state) => {
        const base = Math.max(
          1,
          Math.min(50, Math.round(fpLocomotionConstants.locomotionSubstepsPerSecond * dtSec)),
        );
        if (state.grounded) return base;
        return Math.max(1, Math.round(base * FP_LOCOMOTION_AIRBORNE_SUBSTEP_SCALE));
      },
    };

    window.addEventListener('keydown', this.onKeyDown, { capture: true });
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onWindowBlur);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    document.addEventListener('mousemove', this.onMouseMove);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
    config.domElement.addEventListener('pointermove', this.onPlacementPointerMove);
    config.domElement.addEventListener('click', this.onCanvasClick);
    config.domElement.addEventListener('contextmenu', this.onContextMenu);
  }

  isActive(): boolean {
    return this.active;
  }

  isPlacementActive(): boolean {
    return this.placement?.isActive() ?? false;
  }

  hasLockedPlacement(): boolean {
    return this.placement?.hasLockedSelection() ?? false;
  }

  isInteractionActive(): boolean {
    return this.active || this.isPlacementActive();
  }

  isCrouching(): boolean {
    return this.active && this.crouchToggle;
  }

  /**
   * Exposes continuous first-person camera input to render systems that need
   * to defer incremental visibility-buffer changes until the view settles.
   */
  isCameraNavigationActive(): boolean {
    if (!this.active || this.config.isMenuOpen?.()) return false;
    return this.input.forward
      || this.input.backward
      || this.input.left
      || this.input.right
      || !this.loco.grounded
      || this.loco.velocity.lengthSq() > 0.01
      || Math.abs(this.lookInertia.velYaw) > 1e-7
      || Math.abs(this.lookInertia.velPitch) > 1e-7
      || Math.abs(this.look.headLookYaw) > 1e-7;
  }

  toggle(spawn?: FirstPersonSpawn): void {
    if (this.active) this.deactivate();
    else if (this.isPlacementActive()) this.endPlacement();
    else if (spawn || !this.placement) this.activate(spawn ?? this.config.getOrbitSpawn?.());
    else this.beginPlacement();
  }

  beginPlacement(): void {
    if (this.active || this.isPlacementActive() || !this.placement) return;
    this.placement.begin();
    this.config.onPlacementChange?.(true);
  }

  endPlacement(): void {
    if (!this.isPlacementActive()) return;
    this.placement?.end();
    this.config.onPlacementChange?.(false);
  }

  activate(spawn?: FirstPersonSpawn): void {
    if (this.active) return;
    this.active = true;
    this.savedFov = this.config.camera.fov;
    this.savedNear = this.config.camera.near;

    const x = spawn?.x ?? 0;
    const z = spawn?.z ?? 0;
    const groundY = resolveRoadAwareGroundY(
      this.config.getHeightAt(x, z),
      this.config.getRoadDeckY?.(x, z) ?? null,
    );
    this.pos.set(x, groundY + FP_LOCOMOTION_FEET_SKIN_M, z);
    this.look.bodyYaw = spawn?.yaw ?? 0;
    this.look.pitch = spawn?.pitch ?? 0;
    this.look.headLookYaw = 0;
    resetFpLookInertia(this.lookInertia);
    this.loco.velocity.set(0, 0, 0);
    this.loco.grounded = true;
    this.loco.jumpQueued = false;
    this.loco.eyeSmoothed = fpLocomotionConstants.eyeStand;
    this.keys.clear();
    this.crouchToggle = false;
    this.camBobY = 0;
    this.camBobRoll = 0;
    this.lastEyeLine = fpLocomotionConstants.eyeStand;
    resetFpFootstepCadenceState(this.footstepCadence);
    resetFpLandingSoundState(this.landingSound);
    this.pendingLookDeltaX = 0;
    this.pendingLookDeltaY = 0;
    this.config.collisionWorld?.invalidateStatic();
    this.config.collisionWorld?.prepare(this.pos.x, this.pos.z);
    this.config.collisionWorld?.resolvePlayer(
      this.pos,
      this.pos.x,
      this.pos.z,
      this.loco.velocity,
      {
        bodyHeight: fpLocomotionConstants.bodyStand,
        footRadius: FP_WALK_FOOT_RADIUS_XZ,
        maxStepHeight: FP_WALK_STEP_UP_MARGIN,
        grounded: true,
      },
    );

    // Leaving the illustrated map can restore the RTS projection. Complete
    // that hand-off before claiming the lens for first person so the authored
    // walk-mode FOV is always the final projection written during activation.
    this.config.onModeChange?.(true);
    this.config.camera.fov = fpLocomotionConstants.cameraFovDeg;
    this.config.camera.near = Math.max(
      this.savedNear,
      FIRST_PERSON_CAMERA_NEAR_METERS,
    );
    this.config.camera.updateProjectionMatrix();
    this.requestPointerLock();
    this.applyCameraTransform(this.lastEyeLine);
    this.syncReticuleVisibility();
  }

  deactivate(): void {
    if (!this.active) return;
    this.active = false;
    this.keys.clear();
    this.crouchToggle = false;
    resetFpFootstepCadenceState(this.footstepCadence);
    resetFpLandingSoundState(this.landingSound);
    this.pendingLookDeltaX = 0;
    this.pendingLookDeltaY = 0;
    this.exitPointerLock();
    this.showCrosshair(false);
    resetCompassHeading();

    this.config.camera.fov = this.savedFov;
    this.config.camera.near = this.savedNear;
    this.config.camera.updateProjectionMatrix();
    this.config.camera.rotation.set(0, 0, 0);
    this.config.camera.position.set(0, 0, 0);
    this.config.onModeChange?.(false);
  }

  getPosition(out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(this.pos.x, this.pos.y, this.pos.z);
  }

  getBodyYaw(): number {
    return this.look.bodyYaw;
  }

  invalidateCollisionWorld(): void {
    this.config.collisionWorld?.invalidateStatic();
  }

  update(dt: number): void {
    if (!this.active) return;
    if (this.config.isMenuOpen?.()) return;

    this.syncInputFromKeys();
    this.config.collisionWorld?.prepare(this.pos.x, this.pos.z);
    const freeLook = this.resolveFreeLook();
    if (document.pointerLockElement === this.config.domElement) {
      const lookDeltaX = this.pendingLookDeltaX;
      const lookDeltaY = this.pendingLookDeltaY;
      this.pendingLookDeltaX = 0;
      this.pendingLookDeltaY = 0;
      stepFpLookInertia(this.lookInertia, this.look, lookDeltaX, lookDeltaY, dt, { freeLook });
      if (!freeLook && this.look.headLookYaw !== 0) {
        stepFpFreeLookRecenter(this.look, dt);
      }
    } else {
      this.pendingLookDeltaX = 0;
      this.pendingLookDeltaY = 0;
    }

    const jumpStarted = this.loco.grounded && this.loco.jumpQueued;
    const eyeLine = stepFpLocomotion(
      this.loco,
      this.pos,
      this.look.bodyYaw,
      this.input,
      dt,
      this.walkOpts,
    );
    this.lastEyeLine = eyeLine;
    this.clampPositionXZ();

    const horizontalSpeed = Math.hypot(this.loco.velocity.x, this.loco.velocity.z);
    const moving = this.input.forward || this.input.backward || this.input.left || this.input.right;
    const playedLandingSound = stepFpLandingSound(
      this.landingSound,
      jumpStarted,
      this.loco.grounded,
      dt,
    );
    if (playedLandingSound) {
      this.playFootstep(takeFpLandingFootstep(
        this.footstepCadence,
        horizontalSpeed,
      ));
    } else {
      const footstep = stepFpFootstepCadence(this.footstepCadence, {
        dtSeconds: dt,
        horizontalSpeedMps: horizontalSpeed,
        moving,
        grounded: this.loco.grounded,
        crouching: this.input.crouch,
        sprinting: this.input.sprint,
      });
      if (footstep) this.playFootstep(footstep);
    }
    if (
      this.loco.grounded &&
      !this.input.crouch &&
      !freeLook &&
      moving &&
      horizontalSpeed > 0.12
    ) {
      const walkStrength = THREE.MathUtils.clamp(
        horizontalSpeed / fpLocomotionConstants.sprintSpeedMps,
        0,
        1,
      );
      const contactWave = Math.cos(this.footstepCadence.phase * Math.PI * 2);
      const dip = -contactWave * CAM_BOB_DIP_Y * walkStrength;
      this.camBobY = dip;
      this.camBobRoll = 0;
    } else {
      this.camBobY = THREE.MathUtils.damp(this.camBobY, 0, 10, dt);
      this.camBobRoll = THREE.MathUtils.damp(this.camBobRoll, 0, 10, dt);
    }

    this.applyCameraTransform(eyeLine);
    this.syncReticuleVisibility();
  }

  updatePlacement(): void {
    this.placement?.update();
  }

  onMenuOpenChange(open: boolean): void {
    if (!this.active) return;
    this.resetTransientInputState();
    if (open) {
      this.exitPointerLock();
    } else {
      this.requestPointerLock();
    }
  }

  dispose(): void {
    this.endPlacement();
    this.deactivate();
    window.removeEventListener('keydown', this.onKeyDown, true);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onWindowBlur);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    document.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    this.config.domElement.removeEventListener('pointermove', this.onPlacementPointerMove);
    this.config.domElement.removeEventListener('click', this.onCanvasClick);
    this.config.domElement.removeEventListener('contextmenu', this.onContextMenu);
    this.reticule?.remove();
    this.reticule = null;
    this.placement?.dispose();
  }

  private applyCameraTransform(eyeLine: number): void {
    const camera = this.config.camera;
    const yaw = this.look.bodyYaw + this.look.headLookYaw;
    camera.position.set(this.pos.x, this.pos.y + eyeLine + this.camBobY, this.pos.z);
    camera.rotation.order = 'YXZ';
    camera.rotation.y = yaw;
    camera.rotation.x = this.look.pitch;
    camera.rotation.z = this.camBobRoll;
    publishCompassHeadingFromYawRad(yaw);
  }

  private playFootstep(motion: FootstepMotion): void {
    const surface = this.config.getFootstepSurface?.(
      this.pos.x,
      this.pos.y,
      this.pos.z,
    ) ?? 'grass';
    this.config.onFootstep?.({ surface, ...motion });
  }

  private readonly sampleTerrainGround: WalkGroundSampler = (
    worldX,
    worldZ,
    probeTopY,
    phase,
  ) => {
    const terrainY = sampleTerrainWalkTop(this.config.getHeightAt, worldX, worldZ);
    const roadY = this.config.getRoadDeckY?.(worldX, worldZ);
    const obstacleY = this.config.collisionWorld?.sampleSupportTopY(
      worldX,
      worldZ,
      probeTopY,
      probeTopY - FP_WALK_PROBE_DY,
      FP_WALK_FOOT_RADIUS_XZ,
      FP_WALK_STEP_UP_MARGIN,
      phase,
    ) ?? Number.NEGATIVE_INFINITY;
    return Math.max(resolveRoadAwareGroundY(terrainY, roadY ?? null), obstacleY);
  };

  private clampPositionXZ(): void {
    const { bounds } = this.config;
    this.pos.x = THREE.MathUtils.clamp(this.pos.x, bounds.minX, bounds.maxX);
    this.pos.z = THREE.MathUtils.clamp(this.pos.z, bounds.minZ, bounds.maxZ);
  }

  private resolveFreeLook(): boolean {
    return this.keys.has('AltLeft') || this.keys.has('AltRight');
  }

  private syncInputFromKeys(): void {
    this.input.forward = this.keys.has('KeyW') || this.keys.has('ArrowUp');
    this.input.backward = this.keys.has('KeyS') || this.keys.has('ArrowDown');
    this.input.left = this.keys.has('KeyA') || this.keys.has('ArrowLeft');
    this.input.right = this.keys.has('KeyD') || this.keys.has('ArrowRight');
    this.input.sprint = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    this.input.crouch = this.crouchToggle;
    this.input.jumpHeld = this.keys.has('Space');
  }

  private commitFreeLookIntoBodyYaw(): void {
    if (this.look.headLookYaw !== 0) {
      this.look.bodyYaw += this.look.headLookYaw;
      this.look.headLookYaw = 0;
      this.look.bodyYaw = normalizeBodyYaw(this.look.bodyYaw);
    }
  }

  private resetTransientInputState(): void {
    this.commitFreeLookIntoBodyYaw();
    resetFpLookInertia(this.lookInertia);
    this.pendingLookDeltaX = 0;
    this.pendingLookDeltaY = 0;
    this.keys.clear();
    resetFpFootstepCadenceState(this.footstepCadence);
  }

  private requestPointerLock(): void {
    if (document.pointerLockElement === this.config.domElement) return;
    void this.config.domElement.requestPointerLock().catch(() => {
      // Some browsers reject keyboard-triggered reacquisition. The next canvas
      // click is still an explicit retry and first-person remains active.
    });
  }

  private exitPointerLock(): void {
    if (document.pointerLockElement === this.config.domElement) {
      document.exitPointerLock();
    }
  }

  private showCrosshair(visible: boolean): void {
    if (!this.reticule) {
      this.reticule = document.createElement('div');
      this.reticule.className = 'fps-reticule';
      this.reticule.setAttribute('aria-hidden', 'true');
      this.reticule.innerHTML = `
        <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
          <line x1="11" y1="2" x2="11" y2="3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
          <line x1="11" y1="19" x2="11" y2="20" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
          <line x1="2" y1="11" x2="3" y2="11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
          <line x1="19" y1="11" x2="20" y2="11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
          <circle cx="11" cy="11" r="1.2" fill="currentColor" opacity="0.35" />
        </svg>
      `;
      this.config.domElement.parentElement?.appendChild(this.reticule);
    }
    this.reticule.hidden = !visible;
  }

  private syncReticuleVisibility(): void {
    if (!this.active) {
      this.showCrosshair(false);
      return;
    }
    const locked = document.pointerLockElement === this.config.domElement;
    this.showCrosshair(locked);
  }

  private isToggleKey(event: KeyboardEvent): boolean {
    return event.code === 'Backquote' || event.key === '`' || event.key === '~';
  }

  private isTextInputFocused(): boolean {
    const target = document.activeElement as HTMLElement | null;
    const tag = target?.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || Boolean(target?.isContentEditable);
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (this.isTextInputFocused()) return;

    if (this.isToggleKey(event)) {
      if (!this.config.isSessionReady?.()) return;
      event.preventDefault();
      event.stopPropagation();
      this.toggle();
      return;
    }

    if (!this.active) return;
    if (this.config.isMenuOpen?.()) return;

    if (event.code === 'AltLeft' || event.code === 'AltRight') {
      event.preventDefault();
    }

    this.keys.add(event.code);

    if (event.code === 'Space' && !event.repeat) {
      event.preventDefault();
      queueFpJump(this.loco);
    }

    if (event.code === 'KeyC' && !event.repeat) {
      event.preventDefault();
      this.crouchToggle = !this.crouchToggle;
    }
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.code);
    if (event.code === 'AltLeft' || event.code === 'AltRight') {
      resetFpLookInertia(this.lookInertia);
    }
  };

  private readonly onMouseMove = (event: MouseEvent): void => {
    if (!this.active || this.config.isMenuOpen?.()) return;
    if (document.pointerLockElement !== this.config.domElement) return;
    if (event.movementX === 0 && event.movementY === 0) return;
    // High-polling mice can emit thousands of events per second. Accumulate
    // raw deltas here and apply them once in update(), immediately before the
    // frame renders, so input cannot starve animation or precipitation work.
    this.pendingLookDeltaX += event.movementX;
    this.pendingLookDeltaY += event.movementY;
  };

  private readonly onPointerLockChange = (): void => {
    this.syncReticuleVisibility();
    if (!this.active) return;
    if (document.pointerLockElement !== this.config.domElement) {
      this.resetTransientInputState();
    }
  };

  private readonly onPlacementPointerMove = (event: PointerEvent): void => {
    this.placement?.handlePointerMove(event);
  };

  private readonly onCanvasClick = (event: MouseEvent): void => {
    if (this.placement?.handleCanvasClick(event)) return;
    if (!this.active || this.config.isMenuOpen?.()) return;
    if (document.pointerLockElement !== this.config.domElement) {
      this.requestPointerLock();
    }
  };

  private readonly onContextMenu = (event: Event): void => {
    if (this.isPlacementActive()) {
      event.preventDefault();
      this.endPlacement();
      return;
    }
    if (!this.active) return;
    event.preventDefault();
  };

  private readonly onWindowBlur = (): void => {
    if (!this.active) return;
    this.resetTransientInputState();
  };

  private readonly onVisibilityChange = (): void => {
    if (document.visibilityState === 'hidden' && this.active) {
      this.resetTransientInputState();
    }
  };
}

/** Max terrain under the foot disk — keeps the body grounded on slopes. */
function sampleTerrainWalkTop(
  getHeightAt: (x: number, z: number) => number,
  x: number,
  z: number,
): number {
  const r = FP_WALK_FOOT_RADIUS_XZ;
  let top = getHeightAt(x, z);
  top = Math.max(top, getHeightAt(x + r, z));
  top = Math.max(top, getHeightAt(x - r, z));
  top = Math.max(top, getHeightAt(x, z + r));
  top = Math.max(top, getHeightAt(x, z - r));
  return top;
}
