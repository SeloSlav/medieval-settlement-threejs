import * as THREE from 'three';
import {
  CATTLE_MAX_SLOPE_DEGREES,
  FARM_CROP_DEFINITIONS,
  FARM_MAX_ACCEPTED_SLOPE_DEGREES,
  FARM_MIN_FIELD_AREA,
  FARM_MIN_FIELD_EDGE,
  GRAVEYARD_MAX_DISTANCE,
  GRAVEYARD_MAX_SLOPE,
  GRAVEYARD_MIN_AREA,
  GRAVEYARD_MIN_EDGE,
  LIVESTOCK_MIN_PASTURE_AREA,
  LIVESTOCK_MIN_PASTURE_EDGE,
  SHEEP_MAX_SLOPE_DEGREES,
} from '../generated/gameBalance.ts';
import { sampleAuthoritativeGroundwaterScore } from '../hydrology/sampleAuthoritativeHydrology.ts';
import { buildingFootprintPolygonFromState, burgageZonePolygon } from '../placement/placementConflicts.ts';
import { FARM_CROPS, type BuildingState, type FarmCrop, type GameState } from '../resources/types.ts';
import type { FarmFieldState } from '../resources/types.ts';
import {
  polygonOverlapsPhysicalDeposit,
  type PhysicalDepositFootprint,
} from '../resources/physicalDepositProtection.ts';
import type { TerrainProjector } from '../terrain/TerrainProjector.ts';
import type { RoadNetwork } from '../roads/RoadNetwork.ts';
import { convexPolygonsOverlap2, type Point2 } from '../utils/polygonGeometry.ts';
import { FarmFieldPreview } from './FarmFieldMarkers.ts';
import {
  cropHarvestUnit,
  cropLabel,
  cropProduce,
  expectedFieldYield,
  fieldArea,
  fieldCentroid,
  fieldEdgeLengths,
  initialFieldFertility,
  isValidFarmFieldCorners,
  sampleParcelPoints,
  sampleAverageSlopeDegrees,
  type FarmFieldCorners,
} from './farmFieldMath.ts';
import { computeCattleFieldSupport } from './cattleFieldSupport.ts';
import {
  buildFarmsteadWorkPlan,
  fieldWorkerDays,
  fullFieldCycleWork,
} from './farmWorkPlanning.ts';
import {
  findActiveTripForBuilding,
  onsiteBuildingLabor,
} from '../logistics/deliveryTrips.ts';
import { gameClock } from '../world/gameCalendar.ts';
import {
  sampleAverageSouthExposure,
  VINEYARD_MAX_AREA,
  VINEYARD_MAX_SLOPE_DEGREES,
  VINEYARD_MIN_AREA,
  VINEYARD_MIN_EDGE,
  VINEYARD_MONASTERY_MAX_DISTANCE,
} from '../vineyards/vineyardSuitability.ts';
import { snapLandParcelPoint } from './landParcelSnap.ts';

const MIN_CLICK_DISTANCE = 1.5;
const PREVIEW_VALIDATION_INTERVAL_MS = 110;

export type LandParcelMode = 'field' | 'pasture' | 'graveyard' | 'vineyard';
export type FarmFieldPlacementFailureReason =
  | 'too_small'
  | 'too_large'
  | 'edge_too_short'
  | 'invalid_shape'
  | 'too_steep'
  | 'no_farmstead'
  | 'water'
  | 'resource_deposit'
  | 'building'
  | 'residence'
  | 'field'
  | 'pasture'
  | 'graveyard'
  | 'vineyard';

type Validation =
  | { ok: true; corners: FarmFieldCorners; farmstead: BuildingState | null; slope: number; moisture: number; southExposure: number }
  | { ok: false; reason: FarmFieldPlacementFailureReason; corners: FarmFieldCorners | null; slope?: number; moisture?: number; southExposure?: number };

type FarmFieldToolOptions = {
  domElement: HTMLElement;
  camera: THREE.Camera;
  terrainProjector: TerrainProjector;
  getState: () => GameState;
  getHeightAt: (x: number, z: number) => number;
  isWaterAt: (x: number, z: number) => boolean;
  isResourceDepositAt: (x: number, z: number) => boolean;
  physicalDeposits?: readonly PhysicalDepositFootprint[];
  getRoadNetwork?: () => RoadNetwork;
  onCommit: (input: {
    farmsteadId: string;
    corners: FarmFieldCorners;
    crop: FarmCrop;
    averageSlopeDegrees: number;
  }) => Promise<void> | void;
  onCommitPasture: (input: {
    farmsteadId: string;
    corners: FarmFieldCorners;
    averageSlopeDegrees: number;
  }) => Promise<void> | void;
  onCommitGraveyard: (input: {
    chapelId: string;
    corners: FarmFieldCorners;
    averageSlopeDegrees: number;
  }) => Promise<void> | void;
  onCommitVineyard: (input: {
    monasteryId: string;
    corners: FarmFieldCorners;
    averageSlopeDegrees: number;
    southExposure: number;
  }) => Promise<void> | void;
  onModeChanged: () => void;
  onPlacementRejected?: (reason: FarmFieldPlacementFailureReason) => void;
  onPlacementFailed?: (message: string) => void;
  onCropChanged?: (crop: FarmCrop, recommendation: string) => void;
  isSabbathObserved?: () => boolean;
  isBlocked: () => boolean;
};

function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  const tag = element?.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || Boolean(element?.isContentEditable);
}

/** Shared four independent corners authoring lifecycle for every player-drawn land parcel. */
export class FarmFieldTool {
  private readonly options: FarmFieldToolOptions;
  private readonly preview: FarmFieldPreview;
  private enabled = false;
  private mode: LandParcelMode = 'field';
  private farmsteadId: string | null = null;
  private points: Point2[] = [];
  private hoverPoint: Point2 | null = null;
  private fixedCorners: FarmFieldCorners | null = null;
  private crop: FarmCrop = 'rye';
  private pointerInside = false;
  private pointerClientX = 0;
  private pointerClientY = 0;
  private pointerDirty = false;
  private previewCorners: FarmFieldCorners | null = null;
  private validationDirty = false;
  private lastValidationTime = 0;
  private validation: Validation = { ok: false, reason: 'too_small', corners: null };

  constructor(options: FarmFieldToolOptions) {
    this.options = options;
    this.preview = new FarmFieldPreview(options.getHeightAt);
    options.domElement.addEventListener('mousedown', this.onPointerDown, { capture: true });
    options.domElement.addEventListener('mousemove', this.onPointerMove);
    options.domElement.addEventListener('mouseenter', this.onPointerEnter);
    options.domElement.addEventListener('mouseleave', this.onPointerLeave);
    window.addEventListener('keydown', this.onKeyDown, { capture: true });
  }

  attachTo(parent: THREE.Group): void {
    parent.add(this.preview.group);
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  getMode(): LandParcelMode {
    return this.mode;
  }

  setMode(mode: LandParcelMode, farmsteadId: string | null): void {
    if (this.mode !== mode || this.farmsteadId !== farmsteadId) {
      this.mode = mode;
      this.farmsteadId = farmsteadId;
      this.clearDraft();
    }
    this.setEnabled(true);
  }

  getFarmsteadId(): string | null {
    return this.farmsteadId;
  }

  hasDraft(): boolean {
    return this.points.length > 0 || this.fixedCorners !== null;
  }

  isDraftBuildable(): boolean {
    return this.fixedCorners !== null && this.validation.ok;
  }

  getCursor(): string | null {
    return this.enabled && !this.options.isBlocked() ? 'crosshair' : null;
  }

  shouldBlockCameraInput(event: MouseEvent | WheelEvent): boolean {
    return this.enabled && !this.options.isBlocked() && event instanceof MouseEvent && event.button === 2;
  }

  setEnabled(enabled: boolean): void {
    if (enabled && this.options.isBlocked()) return;
    if (enabled === this.enabled) return;
    this.enabled = enabled;
    if (!enabled) {
      this.clearDraft();
      this.farmsteadId = null;
    }
    else this.pointerDirty = true;
    this.options.onModeChanged();
  }

  getCrop(): FarmCrop {
    return this.crop;
  }

  setCrop(crop: FarmCrop): void {
    if (this.crop === crop) return;
    this.crop = crop;
    if (!this.enabled || this.mode !== 'field') return;
    this.refreshPreview();
    this.options.onCropChanged?.(this.crop, 'suitability map updated');
    this.options.onModeChanged();
  }

  cycleCrop(): void {
    if (!this.enabled || this.mode !== 'field') return;
    const index = FARM_CROPS.indexOf(this.crop);
    this.setCrop(FARM_CROPS[(index + 1) % FARM_CROPS.length]);
  }

  getStatusDetail(): string {
    const parcel = this.mode === 'pasture'
      ? 'pasture'
      : this.mode === 'graveyard'
        ? 'burial ground'
        : this.mode === 'vineyard'
          ? 'vineyard'
          : 'field';
    if (!this.fixedCorners && this.points.length === 0) {
      if (this.mode === 'pasture') {
        return 'Click pasture corner 1/4 · free-form inside the holding work extent · linked boundaries snap nearby';
      }
      if (this.mode === 'graveyard') {
        return 'Click burial-ground corner 1/4 · free-form inside the chapel work extent · linked boundaries snap nearby';
      }
      if (this.mode === 'vineyard') {
        return 'Click vineyard corner 1/4 · free-form inside the monastery work extent · linked boundaries snap nearby';
      }
      return `Click field corner 1/4 · linked boundaries snap nearby · ${cropLabel(this.crop)} suitability map visible (C to change)`;
    }
    if (!this.fixedCorners && this.points.length === 1) {
      return `Click ${parcel} corner 2/4 along the boundary`;
    }
    if (!this.fixedCorners && this.points.length === 2) {
      return `Click ${parcel} corner 3/4 · continue clockwise or counter-clockwise`;
    }
    if (!this.fixedCorners && !this.validation.corners) {
      return `Move to shape ${parcel} corner 4/4 independently`;
    }
    if (!this.validation.ok) {
      const correction = this.fixedCorners
        ? 'Backspace or right-click to adjust the final corner'
        : 'move the final corner';
      return `${this.failureDetail(this.validation.reason)} · ${correction}`;
    }
    const exactArea = fieldArea(this.validation.corners);
    const area = Math.round(exactArea);
    const placementHint = this.fixedCorners
      ? 'hammer or Enter to place'
      : 'click to set the final corner';
    if (this.mode === 'pasture') {
      return `${area} m² pasture · ${placementHint}`;
    }
    if (this.mode === 'graveyard') {
      return `${area} m² consecrated ground · ${placementHint}`;
    }
    if (this.mode === 'vineyard') {
      return `Grapes · ${area} m² · judge the site from the suitability overlay · ${placementHint}`;
    }
    const farmstead = this.validation.farmstead!;
    const center = fieldCentroid(this.validation.corners);
    const draftField: FarmFieldState = {
      id: 'farm-field:zzzz-preview',
      farmsteadId: farmstead.id,
      corners: this.validation.corners,
      area: exactArea,
      averageSlopeDegrees: this.validation.slope,
      moisture: this.validation.moisture,
      fertility: initialFieldFertility(
        this.validation.moisture,
        this.validation.slope,
        center.x,
        center.z,
      ),
      crop: this.crop,
      nextCrop: this.crop,
      followingCrop: null,
      stage: 'ploughing',
      stageProgress: 0,
      priority: 1,
      harvestCount: 0,
      lastYield: 0,
      currentYield: 0,
      harvestYieldMultiplier: 1,
      manureApplied: 0,
    };
    const state = this.options.getState();
    const holdingFields = [...state.farmFields.values()]
      .filter((field) => field.farmsteadId === farmstead.id);
    const previewFields = new Map(state.farmFields);
    previewFields.set(draftField.id, draftField);
    const cattleSupport = computeCattleFieldSupport({
      buildings: state.buildings,
      farmFields: previewFields,
      livestockHerds: state.livestockHerds,
    });
    const onsiteLabor = onsiteBuildingLabor(
      farmstead,
      findActiveTripForBuilding(state.deliveryTrips.values(), farmstead.id),
    );
    const plan = buildFarmsteadWorkPlan(
      [...holdingFields, draftField],
      onsiteLabor,
      gameClock(state.tick),
      this.options.isSabbathObserved?.() ?? false,
      cattleSupport,
      farmstead.ironwork ?? 0,
      farmstead,
    );
    const sowingPlan = FARM_CROP_DEFINITIONS[this.crop].workSeason === 'spring'
      ? plan.spring
      : plan.autumn;
    const hectares = exactArea / 10_000;
    const areaDetail = `${area.toLocaleString()} m² (${hectares.toFixed(hectares < 0.1 ? 3 : 2)} ha)`;
    const produceDetail = cropProduce(this.crop) === 'none'
      ? 'soil-restoring fallow'
      : `${expectedFieldYield(draftField).toFixed(1)} ${cropHarvestUnit(this.crop)}`;
    const cycleWorkerDays = fieldWorkerDays(fullFieldCycleWork(draftField, farmstead));
    const sowingSeason = FARM_CROP_DEFINITIONS[this.crop].workSeason;
    return `${cropLabel(this.crop)} · ${areaDetail} · ${produceDetail} · field ${cycleWorkerDays.toFixed(1)} base worker-days/year · farm ${plan.activeFields} active fields: ${sowingSeason} ${sowingPlan.requiredWorkerDays.toFixed(1)}/${sowingPlan.availableWorkerDays.toFixed(1)}, harvest ${plan.harvest.requiredWorkerDays.toFixed(1)}/${plan.harvest.availableWorkerDays.toFixed(1)} worker-days · ${placementHint}`;
  }

  getBuildButtonPosition(): { clientX: number; clientY: number } | null {
    if (!this.validation.ok) return null;
    const center = fieldCentroid(this.validation.corners);
    const rect = this.options.domElement.getBoundingClientRect();
    const point = new THREE.Vector3(center.x, this.options.getHeightAt(center.x, center.z) + 2, center.z);
    point.project(this.options.camera);
    if (point.z < -1 || point.z > 1) return null;
    return {
      clientX: rect.left + (point.x * 0.5 + 0.5) * rect.width,
      clientY: rect.top + (-point.y * 0.5 + 0.5) * rect.height,
    };
  }

  commitDraft(): void {
    this.validation = this.validate(this.resolvePreviewCorners());
    if (!this.validation.ok) {
      this.options.onPlacementRejected?.(this.validation.reason);
      return;
    }
    const commit = this.validation;
    const pending = this.mode === 'pasture'
      ? this.options.onCommitPasture({
          farmsteadId: commit.farmstead!.id,
          corners: commit.corners,
          averageSlopeDegrees: commit.slope,
        })
      : this.mode === 'graveyard'
        ? this.options.onCommitGraveyard({
            chapelId: commit.farmstead!.id,
            corners: commit.corners,
            averageSlopeDegrees: commit.slope,
          })
      : this.mode === 'vineyard'
        ? this.options.onCommitVineyard({
            monasteryId: commit.farmstead!.id,
            corners: commit.corners,
            averageSlopeDegrees: commit.slope,
            southExposure: commit.southExposure,
          })
      : this.options.onCommit({
          farmsteadId: commit.farmstead!.id,
          corners: commit.corners,
          crop: this.crop,
          averageSlopeDegrees: commit.slope,
        });
    void Promise.resolve(pending).then(() => {
      this.clearDraft();
      this.options.onModeChanged();
    }).catch((error: unknown) => {
      this.options.onPlacementFailed?.(error instanceof Error ? error.message : 'Land parcel placement failed.');
    });
  }

  update(): void {
    if (!this.enabled || this.options.isBlocked()) return;
    if (this.pointerDirty) {
      this.pointerDirty = false;
      if (!this.pointerInside) return;
      const point = this.options.terrainProjector.pick(this.pointerClientX, this.pointerClientY);
      this.hoverPoint = point ? this.snapPointToLinkedParcel({ x: point.x, z: point.z }) : null;
      this.refreshPreviewVisual();
      this.maybeRunDeferredValidation();
      return;
    }
    this.maybeRunDeferredValidation();
  }

  dispose(): void {
    this.options.domElement.removeEventListener('mousedown', this.onPointerDown, { capture: true });
    this.options.domElement.removeEventListener('mousemove', this.onPointerMove);
    this.options.domElement.removeEventListener('mouseenter', this.onPointerEnter);
    this.options.domElement.removeEventListener('mouseleave', this.onPointerLeave);
    window.removeEventListener('keydown', this.onKeyDown, { capture: true });
    this.preview.dispose();
  }

  private readonly onPointerEnter = (): void => {
    this.pointerInside = true;
    this.pointerDirty = true;
  };

  private readonly onPointerLeave = (): void => {
    this.pointerInside = false;
    this.hoverPoint = null;
    this.refreshPreview();
  };

  private readonly onPointerMove = (event: MouseEvent): void => {
    if (!this.enabled || this.options.isBlocked()) return;
    this.pointerClientX = event.clientX;
    this.pointerClientY = event.clientY;
    this.pointerDirty = true;
  };

  private readonly onPointerDown = (event: MouseEvent): void => {
    if (!this.enabled || this.options.isBlocked()) return;
    if (event.button === 2) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (this.hasDraft()) this.undoLastStep();
      else this.setEnabled(false);
      return;
    }
    if (event.button !== 0 || event.altKey) return;
    const picked = this.options.terrainProjector.pick(event.clientX, event.clientY);
    if (!picked) return;
    const point = this.snapPointToLinkedParcel({ x: picked.x, z: picked.z });
    if (this.points.length > 0
      && Math.hypot(point.x - this.points[this.points.length - 1].x, point.z - this.points[this.points.length - 1].z) < MIN_CLICK_DISTANCE) return;
    event.preventDefault();
    event.stopPropagation();
    if (this.fixedCorners) {
      if (this.validation.ok) this.commitDraft();
      else this.options.onPlacementRejected?.(this.validation.reason);
      return;
    }
    if (this.points.length < 3) {
      this.points.push(point);
    } else {
      this.fixedCorners = [this.points[0], this.points[1], this.points[2], point];
    }
    this.refreshPreview();
    this.options.onModeChanged();
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (isTypingTarget(event.target) || !this.enabled || this.options.isBlocked()) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (this.hasDraft()) this.clearDraft();
      else this.setEnabled(false);
      this.options.onModeChanged();
      return;
    }
    if (event.key === 'Backspace') {
      event.preventDefault();
      event.stopImmediatePropagation();
      this.undoLastStep();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopImmediatePropagation();
      this.commitDraft();
      return;
    }
    if (event.key.toLowerCase() === 'c' && this.mode === 'field') {
      event.preventDefault();
      event.stopPropagation();
      this.cycleCrop();
    }
  };

  private undoLastStep(): void {
    if (this.fixedCorners) this.fixedCorners = null;
    else this.points.pop();
    this.refreshPreview();
    this.options.onModeChanged();
  }

  private clearDraft(): void {
    this.points = [];
    this.fixedCorners = null;
    this.previewCorners = null;
    this.validationDirty = false;
    this.lastValidationTime = 0;
    this.validation = { ok: false, reason: 'too_small', corners: null };
    this.preview.show(
      null,
      false,
      this.mode === 'field' ? this.crop : 'fallow',
      [],
      this.mode,
    );
  }

  private refreshPreview(): void {
    const corners = this.resolvePreviewCorners();
    this.previewCorners = corners;
    this.validation = this.validate(corners);
    this.validationDirty = false;
    this.lastValidationTime = performance.now();
    this.preview.show(
      corners,
      this.validation.ok,
      this.mode === 'field' ? this.crop : 'fallow',
      this.resolveDraftPath(),
      this.mode,
    );
  }

  private refreshPreviewVisual(): void {
    const corners = this.resolvePreviewCorners();
    this.previewCorners = corners;
    this.validationDirty = true;
    this.preview.show(
      corners,
      this.validation.ok,
      this.mode === 'field' ? this.crop : 'fallow',
      this.resolveDraftPath(),
      this.mode,
    );
  }

  private resolvePreviewCorners(): FarmFieldCorners | null {
    const hoverIsDistinct = this.points.length === 3
      && this.hoverPoint
      && Math.hypot(
        this.hoverPoint.x - this.points[2].x,
        this.hoverPoint.z - this.points[2].z,
      ) >= MIN_CLICK_DISTANCE;
    return this.fixedCorners ?? (
      hoverIsDistinct && this.hoverPoint
        ? [this.points[0], this.points[1], this.points[2], this.hoverPoint]
        : null
    );
  }

  private snapPointToLinkedParcel(point: Point2): Point2 {
    if (!this.farmsteadId) return point;
    const state = this.options.getState();
    const linked = this.mode === 'field'
      ? [...state.farmFields.values()]
          .filter((parcel) => parcel.farmsteadId === this.farmsteadId)
          .map((parcel) => parcel.corners)
      : this.mode === 'pasture'
        ? [...state.pastures.values()]
            .filter((parcel) => parcel.farmsteadId === this.farmsteadId)
            .map((parcel) => parcel.corners)
        : this.mode === 'graveyard'
          ? [...(state.graveyards ?? new Map()).values()]
              .filter((parcel) => parcel.chapelId === this.farmsteadId)
              .map((parcel) => parcel.corners)
          : [...(state.vineyardParcels ?? new Map()).values()]
              .filter((parcel) => parcel.monasteryId === this.farmsteadId)
              .map((parcel) => parcel.corners);
    return snapLandParcelPoint(point, linked);
  }

  private resolveDraftPath(): Point2[] {
    if (this.fixedCorners || this.resolvePreviewCorners()) return [];
    const path = [...this.points];
    const last = path[path.length - 1];
    if (
      this.hoverPoint
      && (!last || Math.hypot(this.hoverPoint.x - last.x, this.hoverPoint.z - last.z) > 0.05)
    ) {
      path.push(this.hoverPoint);
    }
    return path;
  }

  private maybeRunDeferredValidation(): void {
    if (
      !this.validationDirty
      || performance.now() - this.lastValidationTime < PREVIEW_VALIDATION_INTERVAL_MS
    ) {
      return;
    }
    this.validation = this.validate(this.previewCorners);
    this.validationDirty = false;
    this.lastValidationTime = performance.now();
    this.preview.show(
      this.previewCorners,
      this.validation.ok,
      this.mode === 'field' ? this.crop : 'fallow',
      this.resolveDraftPath(),
      this.mode,
    );
  }

  private validate(corners: FarmFieldCorners | null): Validation {
    if (!corners) return { ok: false, reason: 'too_small', corners: null };
    if (!isValidFarmFieldCorners(corners)) {
      return { ok: false, reason: 'invalid_shape', corners };
    }
    const minArea = this.mode === 'pasture'
      ? LIVESTOCK_MIN_PASTURE_AREA
      : this.mode === 'graveyard'
        ? GRAVEYARD_MIN_AREA
        : this.mode === 'vineyard'
          ? VINEYARD_MIN_AREA
          : FARM_MIN_FIELD_AREA;
    const minEdge = this.mode === 'pasture'
      ? LIVESTOCK_MIN_PASTURE_EDGE
      : this.mode === 'graveyard'
        ? GRAVEYARD_MIN_EDGE
        : this.mode === 'vineyard'
          ? VINEYARD_MIN_EDGE
          : FARM_MIN_FIELD_EDGE;
    const area = fieldArea(corners);
    if (area < minArea) return { ok: false, reason: 'too_small', corners };
    if (this.mode === 'vineyard' && area > VINEYARD_MAX_AREA) {
      return { ok: false, reason: 'too_large', corners };
    }
    if (fieldEdgeLengths(corners).some((edge) => edge < minEdge)) {
      return { ok: false, reason: 'edge_too_short', corners };
    }

    const slope = sampleAverageSlopeDegrees(corners, this.options.getHeightAt);
    const center = fieldCentroid(corners);
    const moisture = sampleAuthoritativeGroundwaterScore(center.x, center.z);
    const southExposure = sampleAverageSouthExposure(corners, this.options.getHeightAt);
    const state = this.options.getState();
    const farmstead = this.farmsteadId ? state.buildings.get(this.farmsteadId) ?? null : null;
    const eligible = farmstead && (this.mode === 'pasture'
      ? farmstead.kind === 'pastoral_farmstead' || farmstead.kind === 'swineherd'
      : this.mode === 'graveyard'
        ? farmstead.kind === 'chapel' && farmstead.constructionComplete !== false
        : this.mode === 'vineyard'
          ? farmstead.kind === 'monastery' && farmstead.constructionComplete !== false
          : farmstead.kind === 'threshing_barn');
    if (!eligible || !farmstead) {
      return { ok: false, reason: 'no_farmstead', corners, slope, moisture, southExposure };
    }
    if (farmstead) {
      const parentRange = this.mode === 'graveyard'
        ? GRAVEYARD_MAX_DISTANCE
        : this.mode === 'vineyard'
          ? VINEYARD_MONASTERY_MAX_DISTANCE
        : farmstead.workRadius;
      if (corners.some((point) =>
        Math.hypot(point.x - farmstead.x, point.z - farmstead.z) > parentRange
      )) {
        return { ok: false, reason: 'no_farmstead', corners, slope, moisture, southExposure };
      }
    }
    const maxSlope = this.mode === 'pasture'
      ? state.livestockHerds.get(farmstead!.id)?.species === 'cattle'
        ? CATTLE_MAX_SLOPE_DEGREES
        : SHEEP_MAX_SLOPE_DEGREES
      : this.mode === 'graveyard'
        ? GRAVEYARD_MAX_SLOPE
        : this.mode === 'vineyard'
          ? VINEYARD_MAX_SLOPE_DEGREES
          : FARM_MAX_ACCEPTED_SLOPE_DEGREES;
    if (slope > maxSlope) return { ok: false, reason: 'too_steep', corners, slope, moisture, southExposure };

    const samples = sampleParcelPoints(corners);
    if (samples.some((point) => this.options.isWaterAt(point.x, point.z))) {
      return { ok: false, reason: 'water', corners, slope, moisture };
    }
    if (
      this.options.physicalDeposits
        ? polygonOverlapsPhysicalDeposit(corners, this.options.physicalDeposits)
        : samples.some((point) => this.options.isResourceDepositAt(point.x, point.z))
    ) {
      return { ok: false, reason: 'resource_deposit', corners, slope, moisture };
    }
    for (const building of state.buildings.values()) {
      if (convexPolygonsOverlap2(
        corners,
        buildingFootprintPolygonFromState(building, this.options.getRoadNetwork?.()),
      )) {
        return { ok: false, reason: 'building', corners, slope, moisture };
      }
    }
    for (const zone of state.burgageZones.values()) {
      if (convexPolygonsOverlap2(corners, burgageZonePolygon(zone))) {
        return { ok: false, reason: 'residence', corners, slope, moisture };
      }
    }
    for (const field of state.farmFields.values()) {
      if (convexPolygonsOverlap2(corners, field.corners)) {
        return { ok: false, reason: 'field', corners, slope, moisture };
      }
    }
    for (const pasture of state.pastures.values()) {
      if (convexPolygonsOverlap2(corners, pasture.corners)) {
        return { ok: false, reason: 'pasture', corners, slope, moisture };
      }
    }
    for (const graveyard of (state.graveyards ?? new Map()).values()) {
      if (convexPolygonsOverlap2(corners, graveyard.corners)) {
        return { ok: false, reason: 'graveyard', corners, slope, moisture };
      }
    }
    for (const vineyard of (state.vineyardParcels ?? new Map()).values()) {
      if (convexPolygonsOverlap2(corners, vineyard.corners)) {
        return { ok: false, reason: 'vineyard', corners, slope, moisture, southExposure };
      }
    }
    return { ok: true, corners, farmstead, slope, moisture, southExposure };
  }

  private failureDetail(reason: FarmFieldPlacementFailureReason): string {
    const parcel = this.mode === 'pasture'
      ? 'Pasture'
      : this.mode === 'graveyard'
        ? 'Burial ground'
        : this.mode === 'vineyard'
          ? 'Vineyard'
          : 'Field';
    switch (reason) {
      case 'too_small':
        return `${parcel} too small · at least ${this.mode === 'pasture' ? LIVESTOCK_MIN_PASTURE_AREA : this.mode === 'graveyard' ? GRAVEYARD_MIN_AREA : this.mode === 'vineyard' ? VINEYARD_MIN_AREA : FARM_MIN_FIELD_AREA} m²`;
      case 'too_large':
        return `${parcel} too large · at most ${VINEYARD_MAX_AREA} m²`;
      case 'edge_too_short':
        return `Each edge must be at least ${this.mode === 'pasture' ? LIVESTOCK_MIN_PASTURE_EDGE : this.mode === 'graveyard' ? GRAVEYARD_MIN_EDGE : this.mode === 'vineyard' ? VINEYARD_MIN_EDGE : FARM_MIN_FIELD_EDGE} m`;
      case 'invalid_shape':
        return `${parcel} boundary must be a simple convex four-corner parcel`;
      case 'too_steep': return `Ground too steep for this ${this.mode === 'pasture' ? 'herd' : this.mode === 'graveyard' ? 'burial ground' : this.mode === 'vineyard' ? 'terraced vineyard' : 'crop'}`;
      case 'no_farmstead':
        return this.mode === 'pasture'
          ? 'Keep the entire pasture inside this livestock holding’s work extent'
          : this.mode === 'graveyard'
            ? 'Keep the entire burial ground inside this chapel’s work extent'
            : this.mode === 'vineyard'
              ? 'Keep the vineyard inside this monastery’s work extent'
              : 'Keep the entire field inside this farmstead’s work extent';
      case 'water': return `${parcel} cannot cover open water`;
      case 'resource_deposit': return `${parcel} cannot cover a physical resource deposit`;
      case 'building': return `${parcel} overlaps a building`;
      case 'residence': return `${parcel} overlaps a residence plot`;
      case 'field': return `${parcel} overlaps existing farmland`;
      case 'pasture': return `${parcel} overlaps an existing pasture`;
      case 'graveyard': return `${parcel} overlaps an existing burial ground`;
      case 'vineyard': return `${parcel} overlaps an existing vineyard`;
    }
  }
}
