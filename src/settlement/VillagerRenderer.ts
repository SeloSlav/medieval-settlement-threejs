import * as THREE from 'three';
import { guardDogActivity } from '../security/dogActivity.ts';
import { presentationNow, trailerClock } from '../app/trailerClock.ts';
import type { RoadNetwork } from '../roads/RoadNetwork.ts';
import {
  OxenRenderer,
  type OxFollowPose,
  type OxInspection,
} from './OxenRenderer.ts';
import type { StableOxLike } from './stableOxen.ts';
import { oxDragLoadKindForWorkplace } from './oxDragLoad.ts';
import {
  rosteredCartWorkersByBuilding,
  type DeliveryTripState,
} from '../logistics/deliveryTrips.ts';
import { resolveRoadAwareGroundY } from '../roads/RoadSurfaceSampling.ts';
import { isOnRoadSurface } from '../roads/roadConnectivity.ts';
import {
  PEDESTRIAN_ROAD_SPEED_MULTIPLIER,
  surfaceAdjustedTravelSpeed,
} from '../roads/roadTravel.ts';
import type {
  BuildingState,
  BackyardGardenState,
  BurgageZoneState,
  CavalryHorseState,
  CorpseState,
  FarmFieldState,
  ForagingNodeState,
  GraveyardState,
  PastureState,
  ResourceNodeState,
  ResidenceState,
  TreeEntityState,
  TreeLayoutEntry,
  VineyardParcelState,
} from '../resources/types.ts';
import { backyardGardenPlacement } from '../residences/backyardPosition.ts';
import { layoutFromBurgageZone } from '../residences/burgageZoneLayout.ts';
import { backyardGardenLabel } from '../residences/backyardGarden.ts';
import { backyardGardenPhenology } from '../economy/backyardGardenTick.ts';
import { getBuildingDefinition } from '../resources/buildings.ts';
import { resolvedPlacedBuildingYaw } from '../buildings/buildingPlacement.ts';
import {
  marketplaceStallWorkerApproach,
  marketplaceStallWorkerPosition,
} from '../buildings/marketplaceStallLayout.ts';
import {
  assignMarketplaceStallRoster,
  indexMarketplaceStallWorkers,
  marketStallLabel,
  type MarketStallNeed,
} from '../economy/marketStallAssignments.ts';
import {
  householdMemberHomeState,
  type HouseholdHomeState,
} from '../residences/householdRoutine.ts';
import { polylineLengthXZ, samplePolylineXZ, type PointXZ } from '../utils/pathGeometry.ts';
import type { GameClock } from '../world/gameCalendar.ts';
import type { HolidayObservance } from '../world/holidayCalendar.ts';
import type { GameHabitatDisturbanceSource } from '../foraging/gameHabitatDisturbance.ts';
import {
  WorkerActivityAudio,
  type WorkerActivitySoundSource,
} from '../audio/WorkerActivityAudio.ts';
import {
  FarmWorkerSongAudio,
  type FarmSongSource,
} from '../audio/FarmWorkerSongAudio.ts';
import {
  buildCombatAudioSources,
  CombatAudio,
  createCombatAudioSourceWorkspace,
  type CombatAudioFighter,
  type CombatWeaponSoundKind,
} from '../audio/CombatAudio.ts';
import {
  CROWD_SIM_DT,
  isPeopleRenderingEnabled,
  isWithinCrowdView,
  type CrowdViewState,
} from './crowdView.ts';
import {
  villagerAnimationCadenceScale,
  villagerStandingActionMode,
  seatedVillagerContactHeight,
  SettlementCrowdRenderer,
  type CrowdRenderAgent,
  type VillagerModelVariant,
  type VillagerRigPoolSeed,
  type VillagerRenderMode,
} from './SettlementCrowdRenderer.ts';
import {
  MAX_VILLAGERS_TOTAL,
  computeVillagerSlots,
  findNearestRoadEdgePath,
  type HomePlotLeisureArea,
  pickIdleDuration,
  pickIdleOffset,
  pickVillagerAppearanceSeed,
  pickVillagerColors,
  pickVillagerHairColor,
  pickVillagerModelVariant,
  pickVillagerWalkPath,
  pickWalkSpeed,
  residenceDoorPosition,
} from './villagerPaths.ts';
import {
  allocateProductionWorkers,
  collectWorkerTargets,
  pickWorkerTravelPath,
  pickWorkerWalkPlan,
  watchtowerDutyPosition,
  watchtowerMusterPosition,
  workerProductionBlocker,
  workerProductionBlockerDescription,
  workplaceYardPosition,
  type WorkerActivityKind,
  type WorkerTarget,
} from './workerPaths.ts';
import {
  isResidenceUpgradeWorkplaceId,
  residenceIdForUpgradeWorkplace,
  residenceUpgradeWorkplaces,
} from './residenceUpgradeWorkplaces.ts';
import {
  type WorkerToolKind,
} from './workerTools.ts';
import { resolveCombatWeaponPresentation } from './combatWeaponAnimation.ts';
import { shouldCreateBattlefieldWeaponDrop } from './militaryWeaponDropPolicy.ts';
import {
  villagerDisplayName,
  villagerOccupation,
} from './villagerIdentity.ts';
import {
  chapelAttendancePath,
  chapelClergyGatheringPoint,
  chapelGatheringPoint,
  chapelMassPhase,
  claimMassChapelFromPoint,
  claimMassChapelsForResidences,
  isSundayMassTime,
  operationalMassChapels,
  type MassChapelClaim,
} from './chapelMass.ts';
import {
  clericDutyAnimation,
  clericIdleAnimation,
  clericMassAnimation,
  isClericWorkplaceKind,
  isDaytimeHouseholdIndoorPause,
} from './clericBehaviors.ts';
import {
  MAX_WAYSIDE_SHRINE_VISITORS,
  claimWaysideShrineFromPoint,
  claimWaysideShrinesForResidences,
  isWaysideShrinePrayerTime,
  operationalWaysideShrines,
  waysideShrinePrayerPath,
  waysideShrinePrayerPoint,
  waysideShrineVisitorPriority,
  type WaysideShrineClaim,
} from './waysideShrineDevotion.ts';
import {
  DEVOTIONAL_PRAYER_SECONDS,
  MAX_GRAVEYARD_VISITORS,
  SABBATH_DEVOTION_START_HOUR,
  graveyardDevotionPath,
  graveyardPrayerPoint,
  indexSabbathGraveyardsByChapel,
  isSabbathDevotionTime,
  operationalSabbathGraveyards,
  pickSabbathGraveyard,
  sabbathDevotionObservanceKey,
  sabbathDevotionPreference,
} from './sabbathDevotion.ts';
import {
  claimFeastMonasteriesForResidences,
  isMonasteryFeastGatheringTime,
  monasteryFeastAttendancePath,
  monasteryFeastGatheringPoint,
  operationalFeastMonasteries,
  type FeastMonasteryClaim,
} from './monasteryFeast.ts';
import type {
  AmbientBehaviorAssignment,
  AmbientBehaviorKind,
} from './ambientBehaviors.ts';
import {
  FOUNDERS_CAMP_AMBIENT_CYCLE_SECONDS,
  planFoundersCampAmbientBehaviors,
} from './foundersCampBehaviors.ts';
import { FOUNDERS_CAMPFIRE_POSITION } from '../buildings/foundersCampLandmarks.ts';
import {
  CHAPEL_GATHERING_AMBIENT_CYCLE_SECONDS,
  planChapelGatheringBehaviors,
} from './chapelGatheringBehaviors.ts';
import {
  holidayBackyardPosition,
  holidayChapelActivity as holidayChapelActivityFor,
} from './holidayCelebration.ts';
import {
  palisadedRefugeGateInside,
  palisadedRefugeGateOutside,
  palisadedRefugeRallyPosition,
} from './palisadedRefugeRally.ts';
import type { GameSpeed } from '../world/gameSpeed.ts';
import { agentPacedDelta } from '../world/agentPacing.ts';
import {
  CALENDAR_HOURS_PER_DAY,
  CALENDAR_SECONDS_PER_DAY,
  STARTING_POPULATION,
  WORKFORCE_MOVEMENT_SPEED_MULTIPLIER,
} from '../generated/gameBalance.ts';
import {
  fireDisabledBuildingIds,
  fireDisabledResidenceIds,
  type FireIncidentState,
} from '../fires/fireIncident.ts';
import {
  isHostileCombatFaction,
  isMountedCombatAgent,
  isPlayerMilitaryFaction,
  ottomanRaiderIsRanged,
  selectablePlayerMilitaryCompanyId,
  type CombatAgentState,
} from '../security/combatAgents.ts';
import { CompanyStandardBearerRegistry } from '../security/companyStandardBearers.ts';
import {
  AnimalCombatRenderer,
  type AnimalCombatPose,
} from './AnimalCombatRenderer.ts';
import {
  CAVALRY_SADDLE_HEIGHT,
  CavalryHorseRenderer,
  type CavalryHorsePose,
  type CavalryHorsePresentation,
} from './CavalryHorseRenderer.ts';
import {
  SELECTED_AGENT_ROUTE_Y_OFFSET,
  type SelectedAgentRoutePoint,
} from '../scene/SelectedAgentRoute.ts';
import {
  WorkerLocalAvoidance,
  type WorkerAvoidanceAgent,
} from './workerLocalAvoidance.ts';

type VillagerMode = VillagerRenderMode;
type VillagerRole = 'founder' | 'resident' | 'worker';
type VillagerRoutinePhase =
  | 'work'
  | 'observance_at_worksite'
  | 'returning_for_observance'
  | 'returning_to_work'
  | 'returning_home'
  | 'going_to_mass'
  | 'at_mass'
  | 'returning_from_mass'
  | 'going_to_feast'
  | 'at_feast'
  | 'returning_from_feast'
  | 'going_to_shrine'
  | 'praying_at_shrine'
  | 'returning_from_shrine'
  | 'going_to_graveyard'
  | 'praying_at_graveyard'
  | 'returning_from_graveyard'
  | 'going_to_refuge'
  | 'at_refuge'
  | 'returning_from_refuge'
  | 'going_to_muster'
  | 'at_muster'
  | 'returning_from_muster'
  | 'going_to_fire_assembly'
  | 'at_fire_assembly'
  | 'returning_from_fire_assembly'
  | 'sick_rest'
  | HouseholdHomeState;
type VillagerPathPurpose =
  | 'home_wander'
  | 'backyard_work'
  | 'worker_work_loop'
  | 'return_to_work'
  | 'return_for_observance'
  | 'return_home'
  | 'chapel_mass'
  | 'return_from_mass'
  | 'monastery_feast'
  | 'return_from_feast'
  | 'wayside_shrine_prayer'
  | 'return_from_shrine'
  | 'graveyard_prayer'
  | 'return_from_graveyard'
  | 'refuge_rally'
  | 'return_from_refuge'
  | 'guard_muster'
  | 'return_from_muster'
  | 'fire_assembly'
  | 'return_from_fire_assembly'
  | 'ambient'
  | null;

const WORKER_ACTIVITY_SECONDS = 9.5;
const COMBAT_HURT_REACTION_MS = 1_200;
const RAIDER_MELEE_THREAT_MS = 1_350;
const RAIDER_ENTRY_BREAK_SECONDS = 1.05;
const RAIDER_LOOT_CHEER_START_SECONDS = 3.15;
const FISHING_PATH_WATER_SAMPLE_STEP = 0.3;
const MONASTIC_HABIT_COLOR = 0x493629;
const CAMP_SEAT_RELEASE_DISTANCE = 0.8;
const NO_REFUGE_ASSIGNMENTS: ReadonlyMap<string, string> = new Map();
type GuardMusterPresentationAssignment = { towerId: string };
const NO_GUARD_MUSTER_ASSIGNMENTS:
  ReadonlyMap<string, GuardMusterPresentationAssignment> = new Map();

type PendingCampSeatAssignment = {
  assignment: AmbientBehaviorAssignment;
  previousOccupantId: string;
};

type CombatAgentVisual = {
  state: CombatAgentState;
  displayX: number;
  displayZ: number;
  /** Stable allocation exposed to markers and report focus for every faction,
   * including wildlife that never enters the humanoid render-agent map. */
  renderPosition: { x: number; z: number };
  displayMoveSpeed: number;
  yaw: number;
  hurtUntilMs: number;
  threatenUntilMs: number;
};

type MarketStallDuty = PointXZ & {
  yaw: number;
  marketplaceId: string;
  needKind: MarketStallNeed | null;
  approachOutside: PointXZ;
  approachInside: PointXZ;
};

type BackyardWorksite = PointXZ & {
  kind: BackyardGardenState['kind'];
  width: number;
  depth: number;
  yaw: number;
};

type EssentialSabbathDuty =
  | 'livestock_care'
  | 'watch'
  | 'guard_readiness';

function workerSlotKey(workplaceId: string, workplaceSlot: number): string {
  return `${workplaceId}:${workplaceSlot}`;
}

function isTravelMode(mode: VillagerMode): boolean {
  return mode === 'walk' || mode === 'run' || mode === 'flee';
}

function sameDutyPosition(
  left: MarketStallDuty | undefined,
  right: MarketStallDuty | undefined,
): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return left.marketplaceId === right.marketplaceId
    && left.needKind === right.needKind
    && Math.abs(left.x - right.x) <= 1e-5
    && Math.abs(left.z - right.z) <= 1e-5
    && Math.abs(Math.atan2(
      Math.sin(left.yaw - right.yaw),
      Math.cos(left.yaw - right.yaw),
    )) <= 1e-5
    && Math.abs(left.approachOutside.x - right.approachOutside.x) <= 1e-5
    && Math.abs(left.approachOutside.z - right.approachOutside.z) <= 1e-5;
}

type VillagerAgent = {
  id: string;
  personIdentity: string;
  role: VillagerRole;
  isSick: boolean;
  residenceId: string | null;
  workplaceId: string | null;
  workplaceSlot: number;
  slotIndex: number;
  mode: VillagerMode;
  ambientBehavior: AmbientBehaviorKind | null;
  routinePhase: VillagerRoutinePhase;
  pathPurpose: VillagerPathPurpose;
  path: PointXZ[];
  pathDistance: number;
  pathCursor: number;
  simPathCursor: number;
  displayPathCursor: number;
  workActivity: WorkerActivityKind | null;
  workTarget: PointXZ & Partial<WorkerTarget> | null;
  workStopDistance: number;
  workRemaining: number;
  workPerformed: boolean;
  idleRemaining: number;
  walkSpeed: number;
  currentMoveSpeed: number;
  massChapelId: string | null;
  devotionalShrineId: string | null;
  devotionalShrineSlot: number;
  devotionalGraveyardId: string | null;
  devotionalGraveyardSlot: number;
  lastDevotionalVisitKey: string;
  refugeId: string | null;
  refugeSlot: number;
  musterTowerId: string | null;
  musterSlot: number;
  appearanceSeed: number;
  modelVariant: VillagerModelVariant;
  tunicColor: number;
  skinColor: number;
  hairColor: number;
  idleOffset: { x: number; z: number; yaw: number };
  pathSeed: number;
  idleDirty: boolean;
  nearestEdge: { path: PointXZ[]; distance: number } | null;
  x: number;
  z: number;
  avoidanceOffsetX: number;
  avoidanceOffsetZ: number;
  y: number;
  yaw: number;
  simAccumulator: number;
  frozen: boolean;
};

export type VillagerInspection = {
  personIdentity: string;
  /** Player military members are commanded as one atomic company. The person
   * inspector exposes this routing hint so its capture-phase click handler can
   * yield to the company selection controller instead of consuming the click. */
  militaryCompanyId: string | null;
  /** Non-human direct-click acknowledgement; people use modelVariant. */
  selectionAudioKind?: 'dog';
  /** Optional inspector artwork override for non-human agents. */
  portraitVariant?: VillagerModelVariant | 'dog';
  modelVariant: VillagerModelVariant;
  name: string;
  initials: string;
  eyebrow: string;
  occupation: string;
  activity: string;
  activityState: 'active' | 'ready';
  workplaceLabel: string;
  workplace: string;
  householdLabel: string;
  household: string;
  crewLabel: string;
  crew: string;
  paceLabel: string;
  pace: string;
  position: { x: number; y: number; z: number };
  route: SelectedAgentRoutePoint[];
  visible: boolean;
};

export type VillagerRendererOptions = {
  parent: THREE.Group;
  getGameSpeed: () => GameSpeed;
  getHeightAt: (x: number, z: number) => number;
  getRoadDeckY?: (x: number, z: number) => number | null;
  isWaterAt?: (x: number, z: number) => boolean;
  routePathAroundObstacles?: (path: readonly PointXZ[]) => PointXZ[] | null;
  getDeliveryOxPose?: (tripId: string) => OxFollowPose | null;
  getDeliveryOxRoute?: (
    tripId: string,
  ) => readonly SelectedAgentRoutePoint[];
};

export class VillagerRenderer {
  readonly visualAssetsReady: Promise<boolean>;
  private readonly renderer: SettlementCrowdRenderer;
  private readonly oxen: OxenRenderer;
  private readonly combatAnimals: AnimalCombatRenderer;
  private readonly cavalryHorsesRenderer: CavalryHorseRenderer;
  private readonly combatAnimalPoses: AnimalCombatPose[] = [];
  private readonly cavalryHorsePoses: CavalryHorsePose[] = [];
  /** Client-only clock for deterministic pasture roaming; stops while presentation is paused. */
  private cavalryHorseElapsedSeconds = 0;
  private readonly activityAudio = new WorkerActivityAudio();
  private readonly farmWorkerSongAudio = new FarmWorkerSongAudio();
  private readonly combatAudio = new CombatAudio();
  private readonly companyStandardBearers = new CompanyStandardBearerRegistry();
  /** Keeps the outgoing bearer sidearm identity through the downed linger. */
  private readonly fallenCompanyStandardBearers = new Set<string>();
  private readonly getGameSpeed: () => GameSpeed;
  private readonly getHeightAt: (x: number, z: number) => number;
  private readonly getRoadDeckY: ((x: number, z: number) => number | null) | null;
  private readonly isWaterAt: ((x: number, z: number) => boolean) | null;
  private readonly routePathAroundObstacles:
    ((path: readonly PointXZ[]) => PointXZ[] | null) | null;
  private readonly agents = new Map<string, VillagerAgent>();
  private readonly workerAvoidance = new WorkerLocalAvoidance();
  private readonly workerAvoidanceAgents: WorkerAvoidanceAgent[] = [];
  private readonly renderAgents: CrowdRenderAgent[] = [];
  private readonly renderAgentsById = new Map<string, CrowdRenderAgent>();
  private readonly workerSoundSources: WorkerActivitySoundSource[] = [];
  private readonly workerSoundSourcePool: WorkerActivitySoundSource[] = [];
  private readonly activeLoggingDisturbances: GameHabitatDisturbanceSource[] = [];
  private readonly loggingDisturbancePool: GameHabitatDisturbanceSource[] = [];
  private readonly farmSongSources: FarmSongSource[] = [];
  private readonly farmSongSourcePool: FarmSongSource[] = [];
  private readonly combatAudioFighters: CombatAudioFighter[] = [];
  private readonly combatAudioFighterPool: CombatAudioFighter[] = [];
  private readonly combatAudioSourceWorkspace = createCombatAudioSourceWorkspace();
  private residences = new Map<string, ResidenceState>();
  private buildings = new Map<string, BuildingState>();
  private pastures = new Map<string, PastureState>();
  private cavalryHorses = new Map<string, CavalryHorseState>();
  private backyardWorksites = new Map<string, BackyardWorksite>();
  private homePlotLeisureAreas = new Map<string, HomePlotLeisureArea>();
  private marketStallDutyByWorker = new Map<string, MarketStallDuty>();
  private workerTargets = new Map<string, WorkerTarget[]>();
  private foundingCamp: BuildingState | null = null;
  private campAmbientAssignments = new Map<string, AmbientBehaviorAssignment>();
  private pendingCampSeatAssignments =
    new Map<string, PendingCampSeatAssignment>();
  private campAmbientCycleIndex = 0;
  private campAmbientElapsedSeconds = 0;
  private campAmbientSignature = '';
  private chapelAmbientAssignments = new Map<string, AmbientBehaviorAssignment>();
  private chapelAmbientCycleIndex = 0;
  private chapelAmbientElapsedSeconds = 0;
  private chapelAmbientSignature = '';
  private massChapels: BuildingState[] = [];
  private massChapelClaims = new Map<string, MassChapelClaim>();
  private waysideShrines: BuildingState[] = [];
  private waysideShrineClaims = new Map<string, WaysideShrineClaim>();
  private waysideShrineVisitorSlots = new Map<string, number>();
  private graveyards = new Map<string, GraveyardState>();
  private sabbathGraveyardsByChapel = new Map<string, GraveyardState[]>();
  private graveyardVisitorSlots = new Map<
    string,
    { graveyardId: string; slot: number }
  >();
  private feastMonasteries: BuildingState[] = [];
  private feastMonasteryClaims = new Map<string, FeastMonasteryClaim>();
  private monasteryFeastsEnabled = true;
  private frontierAlertActive = false;
  private refugeAssignments: ReadonlyMap<string, string> = new Map();
  private guardMusterAssignments:
    ReadonlyMap<string, GuardMusterPresentationAssignment> = new Map();
  private fireDisabledBuildingIds = new Set<string>();
  private fireDisabledResidenceIds = new Set<string>();
  private combatAgentVisuals = new Map<string, CombatAgentVisual>();
  private violentCorpses = new Map<string, CorpseState>();
  private hasSyncedViolentCorpses = false;
  private activeCombatGuardSlots = new Set<string>();
  private activeMilitaryPersonIdentities = new Set<string>();
  private roadNetwork: RoadNetwork | null = null;
  private clock: GameClock | null = null;
  private householdPresentationClock: GameClock | null = null;
  private laborPaused = false;
  private sabbathPausedToday = false;
  private holidayObservance: HolidayObservance | null = null;
  private lastRoutineClockTotalDays = Number.NaN;
  private lastRoutineClockHour = Number.NaN;
  private lastRoutineClockMinute = Number.NaN;
  private lastRoutineHouseholdHour = Number.NaN;
  private lastRoutineHouseholdMinute = Number.NaN;
  private lastRoutineClockMonth = Number.NaN;
  private lastRoutineClockMonthDay = Number.NaN;
  private lastRoutineClockIsSunday: boolean | null = null;
  private lastRoutineLaborPaused: boolean | null = null;
  private lastRoutineMonasteryFeastsEnabled: boolean | null = null;
  private lastRoutineSabbathPausedToday: boolean | null = null;
  private lastRoutineHolidaySignature = '';
  private lastView: CrowdViewState | undefined;
  private inspectedAgentCache: VillagerAgent | null = null;

  constructor(options: VillagerRendererOptions) {
    this.getGameSpeed = options.getGameSpeed;
    this.getHeightAt = options.getHeightAt;
    this.getRoadDeckY = options.getRoadDeckY ?? null;
    this.isWaterAt = options.isWaterAt ?? null;
    this.routePathAroundObstacles = options.routePathAroundObstacles ?? null;
    this.renderer = new SettlementCrowdRenderer({ parent: options.parent });
    this.oxen = new OxenRenderer({
      parent: options.parent,
      getGameSpeed: options.getGameSpeed,
      getHeightAt: options.getHeightAt,
      getRoadDeckY: options.getRoadDeckY,
      getWorkerPose: (buildingId, workerSlot) =>
        this.getWorkerFollowPose(buildingId, workerSlot),
      getDeliveryPose: options.getDeliveryOxPose,
      getWorkerRoute: (buildingId, workerSlot) =>
        this.getWorkerInspectionRoute(buildingId, workerSlot),
      getDeliveryRoute: options.getDeliveryOxRoute,
    });
    this.combatAnimals = new AnimalCombatRenderer(options.parent);
    this.cavalryHorsesRenderer = new CavalryHorseRenderer(options.parent);
    this.visualAssetsReady = Promise.all([
      this.renderer.ready,
      this.combatAnimals.ready,
    ]).then((values) => values.every(Boolean));
  }

  beginFirstPlayableGpuPrewarm(): {
    objects: readonly THREE.Object3D[];
    restore: () => void;
  } {
    return this.renderer.beginFirstPlayableGpuPrewarm();
  }

  async prepareFoundersCampForFirstPlayable(
    onProgress?: (completed: number, total: number) => void,
  ): Promise<number> {
    // A loaded settlement already owns its live founder/resident rigs. This is
    // specifically the reserve needed by the first founding-camp action.
    if (this.foundingCamp) return 0;
    const seeds: VillagerRigPoolSeed[] = [];
    for (let founderIndex = 0; founderIndex < STARTING_POPULATION; founderIndex += 1) {
      const id = `starting-population:${founderIndex}`;
      const appearanceSeed = pickVillagerAppearanceSeed(id, 0);
      seeds.push({
        id,
        appearanceSeed,
        variant: pickVillagerModelVariant(appearanceSeed),
      });
    }
    return this.renderer.prepareUnarmedRigPool(seeds, onProgress);
  }

  companyStandardDiagnostics() {
    return this.renderer.companyStandardDiagnostics();
  }

  authoredCrowdDiagnostics() {
    return this.renderer.authoredCrowdDiagnostics();
  }

  setSchedule(
    clock: GameClock,
    laborPaused: boolean,
    monasteryFeastsEnabled = true,
    sabbathPausedToday = false,
    holidayObservance: HolidayObservance | null = null,
    householdPresentationClock: GameClock = clock,
  ): void {
    const holidaySignature = holidayObservance
      ? `${holidayObservance.historicalYear}:${holidayObservance.id}`
      : '';
    const restDayPausedToday = sabbathPausedToday || holidayObservance !== null;
    const fullRoutinePass = this.lastRoutineClockTotalDays !== clock.totalDays
      || this.lastRoutineClockHour !== clock.hour
      || this.lastRoutineClockMinute !== clock.minute
      || this.lastRoutineHouseholdHour !== householdPresentationClock.hour
      || this.lastRoutineHouseholdMinute !== householdPresentationClock.minute
      || this.lastRoutineClockMonth !== clock.month
      || this.lastRoutineClockMonthDay !== clock.monthDay
      || this.lastRoutineClockIsSunday !== clock.isSunday
      || this.lastRoutineLaborPaused !== laborPaused
      || this.lastRoutineMonasteryFeastsEnabled !== monasteryFeastsEnabled
      || this.lastRoutineSabbathPausedToday !== restDayPausedToday
      || this.lastRoutineHolidaySignature !== holidaySignature;
    this.lastRoutineClockTotalDays = clock.totalDays;
    this.lastRoutineClockHour = clock.hour;
    this.lastRoutineClockMinute = clock.minute;
    this.lastRoutineHouseholdHour = householdPresentationClock.hour;
    this.lastRoutineHouseholdMinute = householdPresentationClock.minute;
    this.lastRoutineClockMonth = clock.month;
    this.lastRoutineClockMonthDay = clock.monthDay;
    this.lastRoutineClockIsSunday = clock.isSunday;
    this.lastRoutineLaborPaused = laborPaused;
    this.lastRoutineMonasteryFeastsEnabled = monasteryFeastsEnabled;
    this.lastRoutineSabbathPausedToday = restDayPausedToday;
    this.lastRoutineHolidaySignature = holidaySignature;
    this.clock = clock;
    this.householdPresentationClock = householdPresentationClock;
    this.laborPaused = laborPaused;
    this.monasteryFeastsEnabled = monasteryFeastsEnabled;
    this.sabbathPausedToday = restDayPausedToday;
    this.holidayObservance = holidayObservance;
    this.refreshWaysideShrineVisitorRoster();
    let changed = false;
    for (const agent of this.agents.values()) {
      if (!fullRoutinePass) continue;
      changed = this.reconcileRoutine(agent) || changed;
    }
    const chapelPresentationChanged = fullRoutinePass
      ? this.syncChapelAmbientAssignments()
      : false;
    if (changed || chapelPresentationChanged) {
      this.syncCampAmbientAssignments();
      this.pushRenderState();
    }
  }

  setFrontierAlert(
    active: boolean,
    refugeAssignments:
      ReadonlyMap<string, string> = NO_REFUGE_ASSIGNMENTS,
    guardMusterAssignments:
      ReadonlyMap<string, GuardMusterPresentationAssignment>
      = NO_GUARD_MUSTER_ASSIGNMENTS,
  ): void {
    const nextRefugeAssignments = active
      ? refugeAssignments
      : NO_REFUGE_ASSIGNMENTS;
    const nextGuardMusterAssignments = active
      ? guardMusterAssignments
      : NO_GUARD_MUSTER_ASSIGNMENTS;
    if (
      this.frontierAlertActive === active
      && refugeAssignmentMapsEqual(
        this.refugeAssignments,
        nextRefugeAssignments,
      )
      && guardMusterAssignmentMapsEqual(
        this.guardMusterAssignments,
        nextGuardMusterAssignments,
      )
    ) {
      return;
    }

    this.frontierAlertActive = active;
    this.refugeAssignments = nextRefugeAssignments;
    this.guardMusterAssignments = nextGuardMusterAssignments;
    this.syncRefugeRallySlots();
    this.syncGuardMusterSlots();
    this.refreshWaysideShrineVisitorRoster();
    let changed = false;
    for (const agent of this.agents.values()) {
      changed = this.reconcileRoutine(agent) || changed;
    }
    if (changed) this.pushRenderState();
  }

  setCombatAgents(agents: ReadonlyMap<string, CombatAgentState>): void {
    for (const bearerId of this.fallenCompanyStandardBearers) {
      if (agents.get(bearerId)?.status !== 'downed') {
        this.fallenCompanyStandardBearers.delete(bearerId);
      }
    }
    // Capture the incumbent before sync elects its successor. This makes the
    // actual sword seen in the old bearer's hand become the ground drop.
    for (const state of agents.values()) {
      if (
        state.status === 'downed'
        && this.companyStandardBearers.isBearer(state.id)
      ) {
        this.fallenCompanyStandardBearers.add(state.id);
      }
    }
    this.companyStandardBearers.sync(agents.values());
    const nextVisuals = new Map<string, CombatAgentVisual>();
    const nextGuardSlots = new Set<string>();
    const nextMilitaryPeople = new Set<string>();
    const nowMs = presentationNow();
    for (const state of agents.values()) {
      const prior = this.combatAgentVisuals.get(state.id);
      const tookHit = Boolean(
        prior
        && state.status !== 'downed'
        && state.health < prior.state.health - 1e-6,
      );
      const enteredRaiderMelee = Boolean(
        prior
        && state.faction === 'raider'
        && prior.state.status === 'advancing'
        && state.status === 'fighting',
      );
      if (
        !isAnimalCombatFaction(state.faction)
        && state.status === 'downed'
        && prior?.state.status !== 'downed'
      ) {
        const seed = combatAppearanceSeed(state);
        this.combatAudio.playDeath(
          state.id,
          state.faction === 'bandit'
          || state.faction === 'raider'
          || isPlayerMilitaryFaction(state.faction)
          || seed % 2 === 0
            ? 'man'
            : 'woman',
          state.x,
          state.z,
          this.lastView,
        );
      }
      nextVisuals.set(state.id, {
        state,
        displayX: prior?.displayX ?? state.x,
        displayZ: prior?.displayZ ?? state.z,
        renderPosition: prior?.renderPosition ?? { x: state.x, z: state.z },
        displayMoveSpeed: prior?.displayMoveSpeed ?? 0,
        yaw: prior?.yaw ?? Math.atan2(
          state.x - state.homeX,
          state.z - state.homeZ,
        ),
        hurtUntilMs: tookHit
          ? nowMs + COMBAT_HURT_REACTION_MS
          : prior?.hurtUntilMs ?? 0,
        threatenUntilMs: enteredRaiderMelee
          ? nowMs + RAIDER_MELEE_THREAT_MS
          : prior?.threatenUntilMs ?? 0,
      });
      if (state.faction === 'guard' && state.sourceBuildingId) {
        nextGuardSlots.add(
          combatGuardSlotKey(state.sourceBuildingId, state.sourceSlot),
        );
      }
      if (isPlayerMilitaryFaction(state.faction) && state.personIdentity) {
        nextMilitaryPeople.add(state.personIdentity);
      }
    }
    for (const id of this.combatAgentVisuals.keys()) {
      if (!agents.has(id)) this.renderAgentsById.delete(`combat:${id}`);
    }
    this.combatAgentVisuals = nextVisuals;
    this.activeCombatGuardSlots = nextGuardSlots;
    this.activeMilitaryPersonIdentities = nextMilitaryPeople;
    this.pushRenderState();
  }

  /** Compatibility entry point for focused civilian-rally tests and previews. */
  setRefugeAlert(
    active: boolean,
    assignments: ReadonlyMap<string, string> = NO_REFUGE_ASSIGNMENTS,
  ): void {
    this.setFrontierAlert(active, assignments);
  }

  /**
   * Replans active movement after settlement collision meshes change.
   * This prevents an already-started walk from continuing through a newly
   * placed building or fence.
   */
  invalidateNavigation(): void {
    if (!this.routePathAroundObstacles) return;

    let changed = false;
    for (const agent of this.agents.values()) {
      if (!agent.pathPurpose || agent.path.length < 2) continue;
      const cursor = Math.min(agent.pathDistance, agent.displayPathCursor);
      const remaining = remainingPolyline(agent.path, cursor);
      const remainingWorkDistance = (
        agent.pathPurpose === 'worker_work_loop'
        || agent.pathPurpose === 'backyard_work'
      ) && agent.workActivity
        && !agent.workPerformed
        ? Math.max(0, agent.workStopDistance - cursor)
        : null;
      const rerouted = this.routeWorkerPath(remaining, remainingWorkDistance);
      const workplace = agent.workplaceId
        ? this.buildings.get(agent.workplaceId)
        : null;
      const fishingRerouteTouchesWater = agent.pathPurpose === 'worker_work_loop'
        && workplace?.kind === 'fishing_camp'
        && rerouted
        && (
          !this.isWaterAt
          || polylineTouchesWater(rerouted.path, this.isWaterAt)
        );
      if (
        !rerouted
        || polylineLengthXZ(rerouted.path) < 0.05
        || fishingRerouteTouchesWater
      ) {
        this.cancelBlockedPath(agent);
        changed = true;
        continue;
      }

      agent.path = rerouted.path;
      agent.pathDistance = polylineLengthXZ(rerouted.path);
      agent.pathCursor = 0;
      agent.simPathCursor = 0;
      agent.displayPathCursor = 0;
      agent.workStopDistance = rerouted.workStopDistance ?? 0;
      agent.x = rerouted.path[0].x;
      agent.z = rerouted.path[0].z;
      agent.y = this.resolveAgentY(agent);
      changed = true;
    }
    if (changed) this.pushRenderState();
  }

  sync(options: {
    residences: Iterable<ResidenceState>;
    buildings: Iterable<BuildingState>;
    quarries: Iterable<ResourceNodeState>;
    foragingNodes: Iterable<ForagingNodeState>;
    trees: ReadonlyMap<string, TreeEntityState>;
    treeRegistry: {
      treesInRadius(x: number, z: number, radius: number): TreeLayoutEntry[];
    } | null;
    farmFields: Iterable<FarmFieldState>;
    pastures: Iterable<PastureState>;
    vineyardParcels?: Iterable<VineyardParcelState>;
    graveyards?: Iterable<GraveyardState>;
    corpses?: Iterable<CorpseState>;
    backyardGardens?: Iterable<BackyardGardenState>;
    burgageZones?: Iterable<BurgageZoneState>;
    deliveryTrips?: Iterable<DeliveryTripState>;
    oxen?: Iterable<StableOxLike>;
    cavalryHorses?: Iterable<CavalryHorseState>;
    fireIncidents?: Iterable<FireIncidentState>;
    roadNetwork: RoadNetwork | null;
    foragingMonth?: number;
  }): void {
    const previousResidences = this.residences;
    const previousBuildings = this.buildings;
    const previousFoundingCamp = this.foundingCamp;
    const previousMarketStallDuties = this.marketStallDutyByWorker;
    const residences = [...options.residences];
    const physicalBuildings = [...options.buildings];
    const buildings = [
      ...physicalBuildings,
      ...residenceUpgradeWorkplaces(residences),
    ];
    const quarries = [...options.quarries];
    const foragingNodes = [...options.foragingNodes];
    const farmFields = [...options.farmFields];
    const pastures = [...options.pastures];
    const vineyardParcels = [...(options.vineyardParcels ?? [])];
    const graveyards = [...(options.graveyards ?? [])];
    const nextViolentCorpses = new Map<string, CorpseState>();
    for (const corpse of options.corpses ?? []) {
      if (corpse.cause !== 3 || corpse.state > 1) continue;
      nextViolentCorpses.set(corpse.id, corpse);
      if (this.hasSyncedViolentCorpses && !this.violentCorpses.has(corpse.id)) {
        const appearanceSeed = pickVillagerAppearanceSeed(corpse.id, 0);
        this.combatAudio.playDeath(
          `civilian:${corpse.id}`,
          pickVillagerModelVariant(appearanceSeed) === 'man' ? 'man' : 'woman',
          corpse.x,
          corpse.z,
          this.lastView,
        );
      }
    }
    for (const corpseId of this.violentCorpses.keys()) {
      if (!nextViolentCorpses.has(corpseId)) {
        this.renderAgentsById.delete(`violent-corpse:${corpseId}`);
      }
    }
    this.violentCorpses = nextViolentCorpses;
    this.hasSyncedViolentCorpses = true;
    const backyardGardens = [...(options.backyardGardens ?? [])];
    const burgageZones = [...(options.burgageZones ?? [])];
    const deliveryTrips = [...(options.deliveryTrips ?? [])];
    const fireIncidents = [...(options.fireIncidents ?? [])];
    const disabledBuildingIds = fireDisabledBuildingIds(fireIncidents);
    this.fireDisabledBuildingIds = disabledBuildingIds;
    this.fireDisabledResidenceIds = fireDisabledResidenceIds(fireIncidents);
    this.residences = new Map(residences.map((residence) => [residence.id, residence]));
    this.buildings = new Map(buildings.map((building) => [building.id, building]));
    this.pastures = new Map(pastures.map((pasture) => [pasture.id, pasture]));
    this.cavalryHorses = new Map(
      [...(options.cavalryHorses ?? [])].map((horse) => [horse.id, horse]),
    );
    const month = options.foragingMonth ?? this.clock?.month ?? 1;
    const zonesById = new Map(burgageZones.map((zone) => [zone.id, zone]));
    const zoneLayouts = new Map(
      burgageZones.map((zone) => [zone.id, layoutFromBurgageZone(zone)]),
    );
    this.homePlotLeisureAreas = new Map();
    for (const residence of residences) {
      const parcel = zoneLayouts.get(residence.zoneId)?.parcels.find(
        (candidate) => candidate.index === residence.parcelIndex,
      );
      if (!parcel) continue;
      this.homePlotLeisureAreas.set(residence.id, {
        polygon: parcel.polygon,
        backyardDepth: parcel.backyardDepth,
      });
    }
    this.backyardWorksites = new Map();
    for (const garden of backyardGardens) {
      const residence = this.residences.get(garden.residenceId);
      const zone = residence ? zonesById.get(residence.zoneId) : null;
      const placement = residence && zone
        ? backyardGardenPlacement(residence, zone)
        : null;
      if (
        !residence
        || !placement
        || !backyardGardenPhenology(garden.kind, month).harvestable
      ) {
        continue;
      }
      this.backyardWorksites.set(residence.id, {
        kind: garden.kind,
        x: placement.x,
        z: placement.z,
        width: placement.width,
        depth: placement.depth,
        yaw: placement.yaw,
      });
    }
    this.foundingCamp = physicalBuildings.find(
      (building) =>
        building.kind === 'founders_camp'
        && building.constructionComplete !== false
        && building.foundingShelterActive !== false,
    ) ?? null;
    this.roadNetwork = options.roadNetwork;
    this.marketStallDutyByWorker = this.buildMarketplaceStallDuties(
      physicalBuildings,
      disabledBuildingIds,
    );
    this.massChapels = operationalMassChapels(
      physicalBuildings,
      disabledBuildingIds,
    );
    this.massChapelClaims = claimMassChapelsForResidences(
      residences.filter(
        (residence) => !this.fireDisabledResidenceIds.has(residence.id),
      ),
      this.massChapels,
      this.roadNetwork,
    );
    this.waysideShrines = operationalWaysideShrines(
      physicalBuildings,
      disabledBuildingIds,
    );
    this.waysideShrineClaims = claimWaysideShrinesForResidences(
      residences.filter(
        (residence) => !this.fireDisabledResidenceIds.has(residence.id),
      ),
      this.waysideShrines,
      this.roadNetwork,
    );
    const operationalGraveyards = operationalSabbathGraveyards(
      graveyards,
      new Set(this.massChapels.map((chapel) => chapel.id)),
    );
    this.graveyards = new Map(
      operationalGraveyards.map((graveyard) => [graveyard.id, graveyard]),
    );
    this.sabbathGraveyardsByChapel = indexSabbathGraveyardsByChapel(
      operationalGraveyards,
    );
    this.feastMonasteries = operationalFeastMonasteries(
      physicalBuildings,
      disabledBuildingIds,
    );
    this.feastMonasteryClaims = claimFeastMonasteriesForResidences(
      residences.filter(
        (residence) => !this.fireDisabledResidenceIds.has(residence.id),
      ),
      this.massChapels,
      this.feastMonasteries,
      this.roadNetwork,
    );

    const travelingWorkers = rosteredCartWorkersByBuilding(
      this.buildings,
      deliveryTrips,
    );
    const roster = allocateProductionWorkers(
      residences,
      buildings,
      travelingWorkers,
      this.roadNetwork,
    );
    const onSiteAssignments = roster.assignments.filter((assignment) => assignment.onSite);
    const visibleSickResidents: Array<{
      residence: ResidenceState;
      personIndex: number;
    }> = [];
    let sickBudget = Math.max(0, MAX_VILLAGERS_TOTAL - roster.assignments.length);
    for (const residence of [...residences].sort((a, b) => a.id.localeCompare(b.id))) {
      if (residence.abandoned || residence.population <= 0 || sickBudget <= 0) continue;
      const sickCount = Math.min(
        residence.population,
        Math.max(0, Math.floor(residence.sickPopulation ?? 0)),
        sickBudget,
      );
      for (let personIndex = 0; personIndex < sickCount; personIndex += 1) {
        visibleSickResidents.push({ residence, personIndex });
      }
      sickBudget -= sickCount;
    }
    const slots = computeVillagerSlots(
      residences,
      this.roadNetwork,
      roster.remainingPopulationByResidence,
      Math.max(
        0,
        MAX_VILLAGERS_TOTAL - roster.assignments.length - visibleSickResidents.length,
      ),
    );
    const nextIds = new Set<string>();

    for (const { residence, personIndex } of visibleSickResidents) {
      const id = `sick:${residence.id}:${personIndex}`;
      const personIdentity = `${residence.id}:person:${personIndex}`;
      nextIds.add(id);
      const appearanceSeed = pickVillagerAppearanceSeed(personIdentity, 0);
      let agent = this.agents.get(id);
      if (!agent) {
        const colors = pickVillagerColors(appearanceSeed);
        agent = {
          id,
          personIdentity,
          role: 'resident',
          isSick: true,
          residenceId: residence.id,
          workplaceId: null,
          workplaceSlot: -1,
          slotIndex: personIndex,
          mode: 'rest',
          ambientBehavior: null,
          routinePhase: 'sick_rest',
          pathPurpose: null,
          path: [],
          pathDistance: 0,
          pathCursor: 0,
          simPathCursor: 0,
          displayPathCursor: 0,
          workActivity: null,
          workTarget: null,
          workStopDistance: 0,
          workRemaining: 0,
          workPerformed: false,
          idleRemaining: Number.POSITIVE_INFINITY,
          walkSpeed: pickWalkSpeed(appearanceSeed),
          currentMoveSpeed: 0,
          massChapelId: null,
          devotionalShrineId: null,
          devotionalShrineSlot: -1,
          devotionalGraveyardId: null,
          devotionalGraveyardSlot: -1,
          lastDevotionalVisitKey: '',
          refugeId: null,
          refugeSlot: -1,
          musterTowerId: null,
          musterSlot: -1,
          appearanceSeed,
          modelVariant: pickVillagerModelVariant(appearanceSeed),
          tunicColor: colors.tunic,
          skinColor: colors.skin,
          hairColor: pickVillagerHairColor(appearanceSeed),
          idleOffset: pickIdleOffset(residence.id, personIndex),
          pathSeed: appearanceSeed ^ 0x6d2b79f5,
          idleDirty: true,
          nearestEdge: null,
          x: residence.x,
          z: residence.z,
          avoidanceOffsetX: 0,
          avoidanceOffsetZ: 0,
          y: 0,
          yaw: residence.yaw,
          simAccumulator: 0,
          frozen: false,
        };
        this.agents.set(id, agent);
      } else {
        const previousResidence = previousResidences.get(residence.id);
        agent.personIdentity = personIdentity;
        agent.role = 'resident';
        agent.isSick = true;
        agent.residenceId = residence.id;
        agent.workplaceId = null;
        agent.workplaceSlot = -1;
        agent.slotIndex = personIndex;
        if (
          !previousResidence
          || previousResidence.x !== residence.x
          || previousResidence.z !== residence.z
          || previousResidence.yaw !== residence.yaw
        ) {
          agent.idleDirty = true;
        }
      }
      this.transitionToSickRest(agent);
    }

    for (const [residenceId, count] of slots) {
      const residence = this.residences.get(residenceId);
      if (!residence) continue;

      const nearestEdge = this.roadNetwork
        ? findNearestRoadEdgePath(this.roadNetwork, residence.x, residence.z)
        : null;
      const remainingPopulation = roster.remainingPopulationByResidence.get(residenceId)
        ?? residence.population;
      const claimedPopulation = Math.max(0, residence.population - remainingPopulation);

      for (let slotIndex = 0; slotIndex < count; slotIndex++) {
        const id = `resident:${residenceId}:${slotIndex}`;
        const personIndex = Math.min(
          Math.max(0, residence.population - 1),
          claimedPopulation + slotIndex,
        );
        const personIdentity = `${residenceId}:person:${personIndex}`;
        nextIds.add(id);

        let agent = this.agents.get(id);
        if (!agent) {
          const appearanceSeed = pickVillagerAppearanceSeed(personIdentity, 0);
          const colors = pickVillagerColors(appearanceSeed);
          agent = {
            id,
            personIdentity,
            role: 'resident',
            isSick: false,
            residenceId,
            workplaceId: null,
            workplaceSlot: -1,
            slotIndex,
            mode: 'idle',
            ambientBehavior: null,
            routinePhase: 'home_outdoors',
            pathPurpose: null,
            path: [],
            pathDistance: 0,
            pathCursor: 0,
            simPathCursor: 0,
            displayPathCursor: 0,
            workActivity: null,
            workTarget: null,
            workStopDistance: 0,
            workRemaining: 0,
            workPerformed: false,
            idleRemaining: pickIdleDuration(appearanceSeed),
            walkSpeed: pickWalkSpeed(appearanceSeed),
            currentMoveSpeed: 0,
            massChapelId: null,
            devotionalShrineId: null,
            devotionalShrineSlot: -1,
            devotionalGraveyardId: null,
            devotionalGraveyardSlot: -1,
            lastDevotionalVisitKey: '',
            refugeId: null,
            refugeSlot: -1,
            musterTowerId: null,
            musterSlot: -1,
            appearanceSeed,
            modelVariant: pickVillagerModelVariant(appearanceSeed),
            tunicColor: colors.tunic,
            skinColor: colors.skin,
            hairColor: pickVillagerHairColor(appearanceSeed),
            idleOffset: pickIdleOffset(residenceId, slotIndex),
            pathSeed: appearanceSeed ^ 0x85ebca6b,
            idleDirty: true,
            nearestEdge,
            x: residence.x,
            z: residence.z,
            avoidanceOffsetX: 0,
            avoidanceOffsetZ: 0,
            y: 0,
            yaw: residence.yaw,
            simAccumulator: 0,
            frozen: false,
          };
          this.agents.set(id, agent);
        } else {
          agent.personIdentity = personIdentity;
          agent.role = 'resident';
          agent.isSick = false;
          agent.residenceId = residenceId;
          agent.workplaceId = null;
          agent.workplaceSlot = -1;
          agent.nearestEdge = nearestEdge;
          const previousResidence = previousResidences.get(residenceId);
          if (
            !previousResidence
            || previousResidence.x !== residence.x
            || previousResidence.z !== residence.z
            || previousResidence.yaw !== residence.yaw
          ) {
            agent.idleDirty = true;
          }
        }
      }
    }

    const targetInputs = {
      quarries,
      foragingNodes,
      trees: options.trees,
      treeRegistry: options.treeRegistry,
      farmFields,
      pastures,
      vineyardParcels,
      foragingMonth: options.foragingMonth,
      roadNetwork: this.roadNetwork,
      buildings: this.buildings,
      residences,
    };
    const workerBuildingIds = new Set(
      onSiteAssignments.map((assignment) => assignment.buildingId),
    );
    this.workerTargets = new Map();
    for (const buildingId of workerBuildingIds) {
      const building = this.buildings.get(buildingId);
      if (!building || this.fireDisabledBuildingIds.has(buildingId)) continue;
      this.workerTargets.set(buildingId, collectWorkerTargets(building, targetInputs));
    }

    for (const assignment of onSiteAssignments) {
      const building = this.buildings.get(assignment.buildingId);
      if (!building) continue;
      nextIds.add(assignment.id);

      const appearanceSeed = pickVillagerAppearanceSeed(assignment.personIdentity, 0);
      let agent = this.agents.get(assignment.id);
      if (!agent) {
        const colors = pickVillagerColors(appearanceSeed);
        const idleOffset = pickIdleOffset(
          assignment.personIdentity,
          assignment.slotIndex,
        );
        const homeResidence = assignment.homeResidenceId
          ? this.residences.get(assignment.homeResidenceId) ?? null
          : null;
        const nearestEdge = homeResidence && this.roadNetwork
          ? findNearestRoadEdgePath(this.roadNetwork, homeResidence.x, homeResidence.z)
          : null;
        const origin = homeResidence
          ? residenceDoorPosition(homeResidence)
          : this.foundingCamp
            ? {
                x: this.foundingCamp.x + idleOffset.x * 2.6,
                z: this.foundingCamp.z + 0.4 + idleOffset.z * 2.6,
                yaw: idleOffset.yaw,
              }
            : this.workerDutyPosition(building, assignment.slotIndex);
        agent = {
          id: assignment.id,
          personIdentity: assignment.personIdentity,
          role: 'worker',
          isSick: false,
          residenceId: assignment.homeResidenceId,
          workplaceId: assignment.buildingId,
          workplaceSlot: assignment.slotIndex,
          slotIndex: assignment.slotIndex,
          mode: 'idle',
          ambientBehavior: null,
          routinePhase: 'home_outdoors',
          pathPurpose: null,
          path: [],
          pathDistance: 0,
          pathCursor: 0,
          simPathCursor: 0,
          displayPathCursor: 0,
          workActivity: null,
          workTarget: null,
          workStopDistance: 0,
          workRemaining: 0,
          workPerformed: false,
          idleRemaining: pickIdleDuration(appearanceSeed) * 0.55,
          walkSpeed: pickWalkSpeed(appearanceSeed),
          currentMoveSpeed: 0,
          massChapelId: null,
          devotionalShrineId: null,
          devotionalShrineSlot: -1,
          devotionalGraveyardId: null,
          devotionalGraveyardSlot: -1,
          lastDevotionalVisitKey: '',
          refugeId: null,
          refugeSlot: -1,
          musterTowerId: null,
          musterSlot: -1,
          appearanceSeed,
          modelVariant: isClericWorkplaceKind(building.kind)
            ? 'man'
            : pickVillagerModelVariant(appearanceSeed),
          tunicColor: colors.tunic,
          skinColor: colors.skin,
          hairColor: pickVillagerHairColor(appearanceSeed),
          idleOffset,
          pathSeed: appearanceSeed ^ 0x27d4eb2d,
          idleDirty: false,
          nearestEdge,
          x: origin.x,
          z: origin.z,
          avoidanceOffsetX: 0,
          avoidanceOffsetZ: 0,
          y: this.resolveGroundY(origin.x, origin.z) + 0.02,
          yaw: 'yaw' in origin ? origin.yaw : 0,
          simAccumulator: 0,
          frozen: false,
        };
        this.agents.set(assignment.id, agent);
      } else {
        const assignmentChanged = agent.personIdentity !== assignment.personIdentity
          || agent.residenceId !== assignment.homeResidenceId
          || agent.workplaceId !== assignment.buildingId
          || agent.workplaceSlot !== assignment.slotIndex;
        const previousHomeResidenceId = agent.residenceId;
        agent.personIdentity = assignment.personIdentity;
        agent.role = 'worker';
        agent.isSick = false;
        agent.residenceId = assignment.homeResidenceId;
        agent.workplaceId = assignment.buildingId;
        agent.workplaceSlot = assignment.slotIndex;
        agent.slotIndex = assignment.slotIndex;
        const homeResidence = assignment.homeResidenceId
          ? this.residences.get(assignment.homeResidenceId) ?? null
          : null;
        agent.nearestEdge = homeResidence && this.roadNetwork
          ? findNearestRoadEdgePath(this.roadNetwork, homeResidence.x, homeResidence.z)
          : null;
        if (agent.appearanceSeed !== appearanceSeed) {
          const colors = pickVillagerColors(appearanceSeed);
          agent.appearanceSeed = appearanceSeed;
          agent.modelVariant = isClericWorkplaceKind(building.kind)
            ? 'man'
            : pickVillagerModelVariant(appearanceSeed);
          agent.tunicColor = colors.tunic;
          agent.skinColor = colors.skin;
          agent.hairColor = pickVillagerHairColor(appearanceSeed);
          agent.walkSpeed = pickWalkSpeed(appearanceSeed);
          agent.idleOffset = pickIdleOffset(
            assignment.personIdentity,
            assignment.slotIndex,
          );
          agent.pathSeed = appearanceSeed ^ 0x27d4eb2d;
        }
        if (isClericWorkplaceKind(building.kind)) agent.modelVariant = 'man';
        const previousBuilding = previousBuildings.get(assignment.buildingId);
        const dutyChanged = previousHomeResidenceId !== assignment.homeResidenceId
          || !previousBuilding
          || previousBuilding.x !== building.x
          || previousBuilding.z !== building.z
          || !sameDutyPosition(
            previousMarketStallDuties.get(workerSlotKey(building.id, assignment.slotIndex)),
            this.marketStallDutyByWorker.get(workerSlotKey(building.id, assignment.slotIndex)),
          );
        if (assignmentChanged) {
          this.clearPath(agent);
          const origin = this.workerPermanentHomeDestination(agent)
            ?? this.workerDutyPosition(building, assignment.slotIndex);
          agent.routinePhase = 'home_outdoors';
          agent.x = origin.x;
          agent.z = origin.z;
          agent.y = this.resolveGroundY(origin.x, origin.z) + 0.02;
          agent.yaw = origin.yaw ?? agent.yaw;
          agent.idleRemaining = pickIdleDuration(agent.pathSeed) * 0.55;
          agent.idleDirty = false;
        } else if (dutyChanged) {
          this.clearPath(agent);
          agent.routinePhase = 'home_outdoors';
          agent.idleRemaining = 0;
          agent.idleDirty = false;
        }
      }
    }

    const housedPopulation = residences
      .filter((residence) => !residence.abandoned)
      .reduce((sum, residence) => sum + residence.population, 0);
    const workingFounders = roster.assignments.filter(
      (assignment) => assignment.personIdentity.startsWith('starting-population:'),
    ).length;
    const foundingCamp = this.foundingCamp;
    const idleFounders = foundingCamp
      ? Math.max(0, STARTING_POPULATION - housedPopulation - workingFounders)
      : 0;
    for (let slotIndex = 0; slotIndex < idleFounders; slotIndex += 1) {
      if (!foundingCamp) break;
      const founderIndex = workingFounders + slotIndex;
      const personIdentity = `starting-population:${founderIndex}`;
      const id = `founder-camp:${founderIndex}`;
      nextIds.add(id);
      const appearanceSeed = pickVillagerAppearanceSeed(personIdentity, 0);
      let agent = this.agents.get(id);
      if (!agent) {
        const colors = pickVillagerColors(appearanceSeed);
        agent = {
          id,
          personIdentity,
          role: 'founder',
          isSick: false,
          residenceId: null,
          workplaceId: null,
          workplaceSlot: -1,
          slotIndex,
          mode: 'idle',
          ambientBehavior: null,
          routinePhase: 'home_outdoors',
          pathPurpose: null,
          path: [],
          pathDistance: 0,
          pathCursor: 0,
          simPathCursor: 0,
          displayPathCursor: 0,
          workActivity: null,
          workTarget: null,
          workStopDistance: 0,
          workRemaining: 0,
          workPerformed: false,
          idleRemaining: pickIdleDuration(appearanceSeed),
          walkSpeed: pickWalkSpeed(appearanceSeed),
          currentMoveSpeed: 0,
          massChapelId: null,
          devotionalShrineId: null,
          devotionalShrineSlot: -1,
          devotionalGraveyardId: null,
          devotionalGraveyardSlot: -1,
          lastDevotionalVisitKey: '',
          refugeId: null,
          refugeSlot: -1,
          musterTowerId: null,
          musterSlot: -1,
          appearanceSeed,
          modelVariant: pickVillagerModelVariant(appearanceSeed),
          tunicColor: colors.tunic,
          skinColor: colors.skin,
          hairColor: pickVillagerHairColor(appearanceSeed),
          idleOffset: pickIdleOffset(foundingCamp.id, founderIndex),
          pathSeed: appearanceSeed ^ 0x9e3779b9,
          idleDirty: true,
          nearestEdge: null,
          x: foundingCamp.x,
          z: foundingCamp.z,
          avoidanceOffsetX: 0,
          avoidanceOffsetZ: 0,
          y: 0,
          yaw: 0,
          simAccumulator: 0,
          frozen: false,
        };
        this.agents.set(id, agent);
      } else {
        agent.personIdentity = personIdentity;
        agent.role = 'founder';
        agent.isSick = false;
        agent.residenceId = null;
        agent.workplaceId = null;
        agent.workplaceSlot = -1;
        agent.slotIndex = slotIndex;
        if (
          !previousFoundingCamp
          || previousFoundingCamp.id !== foundingCamp.id
          || previousFoundingCamp.x !== foundingCamp.x
          || previousFoundingCamp.z !== foundingCamp.z
        ) {
          agent.idleDirty = true;
        }
      }
    }

    for (const id of [...this.agents.keys()]) {
      if (nextIds.has(id)) continue;
      this.agents.delete(id);
      this.renderAgentsById.delete(id);
    }
    this.syncRefugeRallySlots();
    this.syncGuardMusterSlots();

    for (const agent of this.agents.values()) {
      if (agent.mode !== 'idle' || !agent.idleDirty) continue;
      if (agent.role === 'worker' && agent.routinePhase === 'work') {
        const building = agent.workplaceId ? this.buildings.get(agent.workplaceId) : null;
        if (building) this.placeWorkerIdle(agent, building);
      } else if (agent.role === 'founder') {
        if (this.foundingCamp) this.placeFounderIdle(agent, this.foundingCamp);
      } else {
        const residence = agent.residenceId ? this.residences.get(agent.residenceId) : null;
        if (residence) this.placeIdle(agent, residence);
      }
      agent.idleDirty = false;
    }

    if (this.clock) {
      this.refreshWaysideShrineVisitorRoster();
      for (const agent of this.agents.values()) {
        this.reconcileRoutine(agent);
      }
    }

    this.syncCampAmbientAssignments();
    this.syncChapelAmbientAssignments();
    this.oxen.sync({
      oxen: options.oxen ?? [],
      buildings: new Map(physicalBuildings.map((building) => [building.id, building])),
      deliveryTrips,
      disabledBuildingIds,
      roadNetwork: options.roadNetwork,
    });
    this.pushRenderState();
  }

  tick(dt: number, view?: CrowdViewState): void {
    this.lastView = view;
    const realDt = Number.isFinite(dt) ? Math.max(0, dt) : 0;
    // Export steps the server while paused, but every captured frame still
    // advances the same character presentation used during live play.
    const simulationDt = agentPacedDelta(realDt, trailerClock.active ? trailerClock.speed : this.getGameSpeed());
    this.advanceCampAmbientCycle(simulationDt);
    this.advanceChapelAmbientCycle(simulationDt);
    this.advanceCombatAgentVisuals(simulationDt > 0 ? realDt : 0);

    for (const agent of this.agents.values()) {
      if (agent.role === 'worker') {
        const workplace = agent.workplaceId ? this.buildings.get(agent.workplaceId) : null;
        if (!workplace || workplace.assignedLabor <= agent.workplaceSlot) {
          agent.frozen = true;
          continue;
        }
      } else if (agent.role === 'founder') {
        if (!this.foundingCamp) {
          agent.frozen = true;
          continue;
        }
      } else {
        const residence = agent.residenceId ? this.residences.get(agent.residenceId) : null;
        if (!residence || residence.abandoned || residence.population <= 0) {
          agent.frozen = true;
          continue;
        }
      }

      agent.frozen = !isWithinCrowdView(agent.x, agent.z, view);
      const offscreenJourneyMustAdvance = agent.pathPurpose === 'return_home'
        || agent.pathPurpose === 'return_to_work'
        || agent.pathPurpose === 'return_for_observance'
        || agent.pathPurpose === 'chapel_mass'
        || agent.pathPurpose === 'return_from_mass'
        || agent.pathPurpose === 'monastery_feast'
        || agent.pathPurpose === 'return_from_feast'
        || agent.pathPurpose === 'wayside_shrine_prayer'
        || agent.pathPurpose === 'return_from_shrine'
        || agent.pathPurpose === 'graveyard_prayer'
        || agent.pathPurpose === 'return_from_graveyard'
        || agent.pathPurpose === 'refuge_rally'
        || agent.pathPurpose === 'return_from_refuge'
        || agent.pathPurpose === 'guard_muster'
        || agent.pathPurpose === 'return_from_muster'
        || agent.pathPurpose === 'fire_assembly'
        || agent.pathPurpose === 'return_from_fire_assembly';
      if (agent.frozen && !offscreenJourneyMustAdvance) continue;

      agent.simAccumulator += simulationDt;
      while (agent.simAccumulator >= CROWD_SIM_DT) {
        this.simStep(agent, CROWD_SIM_DT);
        agent.simAccumulator -= CROWD_SIM_DT;
      }

      this.interpolateDisplay(agent, simulationDt);
      this.syncDisplayPose(agent);
      agent.y = this.resolveAgentY(agent);
    }

    this.updateWorkerLocalAvoidance(simulationDt);
    this.releaseVacatedCampSeats();
    this.pushRenderState(view, simulationDt, simulationDt > 0 ? realDt : 0);
    this.oxen.tick(dt, view);
  }

  hasVisibleDynamicShadowCasters(): boolean {
    return this.renderer.hasVisibleShadowCasters()
      || this.oxen.hasVisibleShadowCasters()
      || this.combatAnimals.hasVisibleShadowCasters()
      || this.cavalryHorsesRenderer.hasVisibleShadowCasters();
  }

  /**
   * Returns the live positions of lumber-mill crews while they follow a tree-work
   * loop. The retained array and records are rewritten on each call so the frame
   * handoff does not allocate while workers move through a game habitat.
   */
  getActiveLoggingDisturbances(): readonly GameHabitatDisturbanceSource[] {
    const disturbances = this.activeLoggingDisturbances;
    disturbances.length = 0;

    for (const agent of this.agents.values()) {
      if (
        agent.pathPurpose !== 'worker_work_loop'
        || agent.workActivity !== 'chop'
        || !agent.workplaceId
      ) continue;
      const workplace = this.buildings.get(agent.workplaceId);
      if (
        workplace?.kind !== 'lumber_mill'
        && workplace?.kind !== 'woodcutters_lodge'
      ) continue;

      // The worker stops short of the trunk to swing the axe. During that
      // action, use the tree itself as the disturbance point so a trunk just
      // inside the habitat boundary cannot be missed because the feet are just
      // outside it. On the journey in and out, the live worker pose takes over.
      const sourceX = agent.mode === 'chop' && agent.workTarget
        ? agent.workTarget.x
        : agent.x;
      const sourceZ = agent.mode === 'chop' && agent.workTarget
        ? agent.workTarget.z
        : agent.z;

      const index = disturbances.length;
      let source = this.loggingDisturbancePool[index];
      if (!source) {
        source = { id: agent.id, x: sourceX, z: sourceZ };
        this.loggingDisturbancePool.push(source);
      } else {
        source.id = agent.id;
        source.x = sourceX;
        source.z = sourceZ;
      }
      disturbances.push(source);
    }

    return disturbances;
  }

  pickVillager(
    clientX: number,
    clientY: number,
    camera: THREE.Camera,
    domElement: HTMLElement,
  ): VillagerInspection | null {
    if (!isPeopleRenderingEnabled(this.lastView)) return null;
    const bounds = domElement.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return null;

    let nearest: { distance: number; inspection: VillagerInspection } | null = null;
    for (const agent of this.agents.values()) {
      if (!this.isVisibleAgent(agent)) continue;
      const distance = projectedAgentHitDistance(
        clientX,
        clientY,
        agent.x,
        agent.y,
        agent.z,
        camera,
        bounds,
      );
      if (distance == null || (nearest && distance >= nearest.distance)) continue;
      nearest = {
        distance,
        inspection: this.describeAgent(agent),
      };
    }
    for (const visual of this.combatAgentVisuals.values()) {
      if (isHostileCombatFaction(visual.state.faction)) continue;
      const y = this.resolveGroundY(visual.displayX, visual.displayZ) + 0.02;
      const distance = projectedAgentHitDistance(
        clientX,
        clientY,
        visual.displayX,
        y,
        visual.displayZ,
        camera,
        bounds,
      );
      if (distance == null || (nearest && distance >= nearest.distance)) continue;
      nearest = {
        distance,
        inspection: this.describeCombatAgent(visual),
      };
    }
    return nearest?.inspection ?? null;
  }

  pickOx(
    clientX: number,
    clientY: number,
    camera: THREE.Camera,
    domElement: HTMLElement,
  ): OxInspection | null {
    return this.oxen.pickOx(clientX, clientY, camera, domElement);
  }

  /** Final interpolated ground position shared by selection rings, hostile
   * markers, and report focus for both human and animal combat actors. */
  getCombatAgentPosition(id: string): Readonly<{ x: number; z: number }> | null {
    return this.combatAgentVisuals.get(id)?.renderPosition ?? null;
  }

  /** A live position alone does not prove an authored body was submitted. */
  getCombatAgentBodyHeight(id: string): number | null {
    const visual = this.combatAgentVisuals.get(id);
    if (!visual) return null;
    return isAnimalCombatFaction(visual.state.faction)
      ? this.combatAnimals.getRenderedBodyHeight(id)
      : this.renderer.getRenderedBodyHeight(`combat:${id}`);
  }

  inspectOx(oxId: string): OxInspection | null {
    return this.oxen.inspectOx(oxId);
  }

  inspectVillager(personIdentity: string): VillagerInspection | null {
    if (personIdentity.startsWith('combat:')) {
      const visual = this.combatAgentVisuals.get(personIdentity.slice('combat:'.length));
      return visual ? this.describeCombatAgent(visual) : null;
    }
    for (const visual of this.combatAgentVisuals.values()) {
      if (visual.state.personIdentity === personIdentity) {
        return this.describeCombatAgent(visual);
      }
    }
    const cached = this.inspectedAgentCache;
    if (
      cached
      && cached.personIdentity === personIdentity
      && this.agents.get(cached.id) === cached
    ) {
      return this.describeAgent(cached);
    }
    for (const agent of this.agents.values()) {
      if (agent.personIdentity !== personIdentity) continue;
      this.inspectedAgentCache = agent;
      return this.describeAgent(agent);
    }
    if (cached?.personIdentity === personIdentity) this.inspectedAgentCache = null;
    return null;
  }

  private agentForPersonIdentity(personIdentity: string | null): VillagerAgent | null {
    if (!personIdentity) return null;
    for (const agent of this.agents.values()) {
      if (agent.personIdentity === personIdentity) return agent;
    }
    return null;
  }

  /** Read-only live pose used by the automatically paired draft ox. */
  getWorkerFollowPose(buildingId: string, workerSlot: number): OxFollowPose | null {
    for (const agent of this.agents.values()) {
      if (
        agent.role !== 'worker'
        || agent.workplaceId !== buildingId
        || agent.workplaceSlot !== workerSlot
      ) continue;
      const routineActive = agent.routinePhase === 'work'
        || agent.routinePhase === 'returning_to_work';
      const workplace = agent.workplaceId
        ? this.buildings.get(agent.workplaceId) ?? null
        : null;
      const fieldStage = agent.workTarget?.kind === 'field'
        ? agent.workTarget.fieldStage
        : undefined;
      // Farm oxen are field teams, not generic shadows for every barn errand.
      // Sowing and threshing remain human work; the animal leaves its stable
      // only for the ploughing/harvest stages that receive real ox throughput.
      const assistsCurrentWork = workplace?.kind !== 'threshing_barn'
        || agent.pathPurpose === 'worker_work_loop'
          && (fieldStage === 'ploughing' || fieldStage === 'harvesting');
      const active = routineActive && assistsCurrentWork;
      const haulKind = workplace
        && agent.pathPurpose === 'worker_work_loop'
        && agent.mode === 'walk'
        && agent.workPerformed
        ? oxDragLoadKindForWorkplace(workplace.kind)
        : null;
      return {
        x: agent.x,
        y: agent.y,
        z: agent.z,
        yaw: agent.yaw,
        moving: agent.currentMoveSpeed > 0.05,
        movementSpeed: agent.currentMoveSpeed * WORKFORCE_MOVEMENT_SPEED_MULTIPLIER,
        active,
        haulKind,
        fieldStage,
      };
    }
    return null;
  }

  private getWorkerInspectionRoute(
    buildingId: string,
    workerSlot: number,
  ): SelectedAgentRoutePoint[] {
    for (const agent of this.agents.values()) {
      if (
        agent.role !== 'worker'
        || agent.workplaceId !== buildingId
        || agent.workplaceSlot !== workerSlot
      ) continue;
      return this.inspectionRoute(agent);
    }
    return [];
  }

  dispose(): void {
    this.inspectedAgentCache = null;
    this.agents.clear();
    this.renderAgents.length = 0;
    this.renderAgentsById.clear();
    this.workerSoundSources.length = 0;
    this.workerSoundSourcePool.length = 0;
    this.activeLoggingDisturbances.length = 0;
    this.loggingDisturbancePool.length = 0;
    this.farmSongSources.length = 0;
    this.farmSongSourcePool.length = 0;
    this.combatAudioFighters.length = 0;
    this.combatAudioFighterPool.length = 0;
    this.combatAudioSourceWorkspace.guards.length = 0;
    this.combatAudioSourceWorkspace.raiders.length = 0;
    this.combatAudioSourceWorkspace.sources.length = 0;
    this.combatAudioSourceWorkspace.sourcePool.length = 0;
    this.activityAudio.dispose();
    this.farmWorkerSongAudio.dispose();
    this.combatAudio.dispose();
    this.companyStandardBearers.clear();
    this.fallenCompanyStandardBearers.clear();
    this.oxen.dispose();
    this.combatAnimals.dispose();
    this.cavalryHorsesRenderer.dispose();
    this.renderer.dispose();
  }

  private describeAgent(agent: VillagerAgent): VillagerInspection {
    const workplace = agent.workplaceId
      ? this.buildings.get(agent.workplaceId) ?? null
      : null;
    const residence = agent.residenceId
      ? this.residences.get(agent.residenceId) ?? null
      : null;
    const dedicatedSmallholder = !agent.isSick
      && residence?.smallholding === true
      && workplace === null;
    const upgradeResidenceId = workplace
      ? residenceIdForUpgradeWorkplace(workplace.id)
      : null;
    const upgradeResidence = upgradeResidenceId
      ? this.residences.get(upgradeResidenceId) ?? null
      : null;
    const upgradeWorkplaceLabel = upgradeResidence?.tier === 0
      ? 'Cottage construction'
      : 'Household improvement works';
    const name = villagerDisplayName(agent.personIdentity, agent.modelVariant);
    const workplaceFireDisabled = workplace
      ? this.fireDisabledBuildingIds.has(workplace.id)
      : false;
    const residenceFireDisabled = residence
      ? this.fireDisabledResidenceIds.has(residence.id)
      : false;
    const onDuty = agent.role === 'worker'
      && !workplaceFireDisabled
      && (
        agent.routinePhase === 'work'
        || agent.routinePhase === 'returning_to_work'
      );

    return {
      personIdentity: agent.personIdentity,
      militaryCompanyId: null,
      modelVariant: agent.modelVariant,
      name,
      initials: name
        .split(/\s+/)
        .slice(0, 2)
        .map((part) => part[0] ?? '')
        .join('')
        .toLocaleUpperCase(),
      eyebrow: agent.role === 'founder'
        ? 'Founder · Awaiting housing'
        : agent.isSick
          ? 'Villager · Ill and homebound'
        : dedicatedSmallholder
          ? 'Smallholder · Dedicated backyard artisan'
        : agent.role === 'worker'
          ? workplaceFireDisabled
            ? 'Worker · Fire-displaced'
            : residenceFireDisabled
              ? 'Worker · Household fire'
              : `Worker · ${onDuty ? 'On duty' : 'Off duty'}`
          : residenceFireDisabled
            ? 'Villager · Fire-displaced'
            : 'Villager · Available labor',
      occupation: agent.isSick
        ? 'Recovering at home'
        : dedicatedSmallholder
          ? 'Smallholder'
        : villagerOccupation(
            workplace?.kind ?? null,
            workplace?.constructionComplete === false,
          ),
      activity: agent.isSick
        ? (residence?.remedyStock ?? 0) > 1e-6
          ? 'Resting at home with dried-herb treatment'
          : 'Resting at home without dried-herb treatment'
        : describeVillagerActivity(
            agent,
            workplace,
            upgradeWorkplaceLabel.toLocaleLowerCase(),
            workplaceFireDisabled,
            residenceFireDisabled,
            this.holidayObservance,
            this.marketStallDutyForAgent(agent),
            agent.residenceId
              ? this.backyardWorksites.get(agent.residenceId) ?? null
              : null,
            this.essentialSabbathDutyFor(workplace),
            Boolean(
              this.clock?.isSunday
              && this.sabbathPausedToday
              && this.holidayObservance === null
              && this.clock.hour + this.clock.minute / 60
                >= SABBATH_DEVOTION_START_HOUR
            ),
            this.holidayObservance
              ? 'fellowship'
              : this.clock
                ? chapelMassPhase(this.clock, this.massChapels.length > 0)
                : null,
          ),
      activityState: onDuty ? 'active' : 'ready',
      workplaceLabel: 'Workplace',
      workplace: workplace
        ? isResidenceUpgradeWorkplaceId(workplace.id)
          ? upgradeWorkplaceLabel
          : getBuildingDefinition(workplace.kind).label
        : dedicatedSmallholder
          ? 'Backyard extension'
          : 'Unassigned',
      householdLabel: 'Household',
      household: residence
        ? `${residence.smallholding === true ? 'Smallholding' : `Tier ${residence.tier} home`} · ${residence.population} ${
          residence.population === 1 ? 'resident' : 'residents'
        }`
        : agent.role === 'founder' || this.foundingCamp
          ? "Founders' camp · no fixed household"
          : 'No fixed household',
      crewLabel: 'Crew',
      crew: agent.isSick
        ? 'Unavailable to the labor pool'
        : dedicatedSmallholder
          ? 'Dedicated to backyard · unavailable to general labor'
        : workplace
        ? `${workplace.assignedLabor} / ${
          isResidenceUpgradeWorkplaceId(workplace.id)
            ? 1
            : getBuildingDefinition(workplace.kind).maxLabor
        } assigned`
        : 'Free labor pool',
      paceLabel: 'Walking pace',
      pace: `${(agent.walkSpeed * WORKFORCE_MOVEMENT_SPEED_MULTIPLIER).toFixed(1)} m/s off-road · ${
        (agent.walkSpeed * PEDESTRIAN_ROAD_SPEED_MULTIPLIER
          * WORKFORCE_MOVEMENT_SPEED_MULTIPLIER).toFixed(1)
      } m/s on roads`,
      position: {
        x: agent.x + agent.avoidanceOffsetX,
        y: agent.y,
        z: agent.z + agent.avoidanceOffsetZ,
      },
      route: this.inspectionRoute(agent),
      visible: this.isVisibleAgent(agent),
    };
  }

  private inspectionRoute(
    agent: VillagerAgent,
  ): SelectedAgentRoutePoint[] {
    let route: PointXZ[] = [];
    if (agent.pathPurpose && agent.path.length >= 2) {
      route = remainingPolyline(
        agent.path,
        Math.min(agent.pathDistance, agent.displayPathCursor),
      );
      if (route.length > 0) {
        route[0] = {
          x: agent.x + agent.avoidanceOffsetX,
          z: agent.z + agent.avoidanceOffsetZ,
        };
      }
    }

    return route.length >= 2
      ? route.map((point) => ({
          x: point.x,
          y: this.resolveGroundY(point.x, point.z) + SELECTED_AGENT_ROUTE_Y_OFFSET,
          z: point.z,
        }))
      : [];
  }

  private describeCombatAgent(visual: CombatAgentVisual): VillagerInspection {
    const combat = visual.state;
    const animal = isAnimalCombatFaction(combat.faction);
    const residentSoldier = this.agentForPersonIdentity(combat.personIdentity);
    const ordinaryGuard = combat.faction === 'guard' && combat.sourceBuildingId
      ? this.agents.get(
          `worker:${combat.sourceBuildingId}:${combat.sourceSlot}`,
        ) ?? null
      : null;
    const guardhouse = combat.sourceBuildingId
      ? this.buildings.get(combat.sourceBuildingId) ?? null
      : null;
    const personIdentity = combat.personIdentity ?? `combat:${combat.id}`;
    const name = residentSoldier
      ? villagerDisplayName(residentSoldier.personIdentity, residentSoldier.modelVariant)
      : ordinaryGuard
      ? villagerDisplayName(
          ordinaryGuard.personIdentity,
          ordinaryGuard.modelVariant,
        )
      : combatUnitName(combat);
    const huntingCamp = combat.assignedBuildingId ? this.buildings.get(combat.assignedBuildingId) : null;
    const dogActivity = combat.faction === 'dog'
      ? guardDogActivity(combat, huntingCamp ? getBuildingDefinition(huntingCamp.kind).label : undefined)
      : null;
    const status = dogActivity?.status ?? combatStatusLabel(combat.status);
    const target = dogActivity?.objective ?? this.combatTargetLabel(combat);
    const activity = dogActivity?.activity ?? combatActivityLabel(combat, target);
    const equipment = combat.faction === 'dog'
      ? 'Teeth, speed, and trained protective instinct'
      : combat.faction === 'fox'
        ? combat.carryingLoot ? 'Carrying stolen food' : 'Avoids direct confrontation'
        : combat.faction === 'wolf'
          ? 'Pack coordination and sustained bite attacks'
          : combat.faction === 'crossbow' || combat.faction === 'bowman'
      ? combat.faction === 'crossbow' ? 'Crossbow and bolts' : 'Bow and arrows'
      : combat.faction === 'guard'
      ? combat.issuedPolearms > 0
        ? 'Polearm issued'
        : 'Unarmed'
      : isPlayerMilitaryFaction(combat.faction)
        ? combatEquipmentLabel(combat)
      : combat.faction === 'raider'
        ? combat.carryingLoot
          ? 'Sidearm · carrying stolen stores'
          : 'Sidearm · no captured stores'
        : combat.carryingLoot
          ? 'Spear · carrying stolen stores'
          : 'Spear · no captured stores';
    const y = this.resolveGroundY(visual.displayX, visual.displayZ) + 0.02;
    return {
      personIdentity,
      militaryCompanyId: selectablePlayerMilitaryCompanyId(combat),
      selectionAudioKind: combat.faction === 'dog' ? 'dog' : undefined,
      portraitVariant: combat.faction === 'dog' ? 'dog' : undefined,
      modelVariant: residentSoldier?.modelVariant ?? ordinaryGuard?.modelVariant ?? 'man',
      name,
      initials: residentSoldier || ordinaryGuard
        ? name
            .split(/\s+/)
            .slice(0, 2)
            .map((part) => part[0] ?? '')
            .join('')
            .toLocaleUpperCase()
        : combat.faction === 'guard' ? 'G'
          : combatFactionInitials(combat.faction),
      eyebrow: combat.faction === 'guard' || combat.faction === 'dog' || isPlayerMilitaryFaction(combat.faction)
        ? `Defender · ${status}`
        : `Hostile · ${status}`,
      occupation: combat.faction === 'guard'
        ? 'Guard company spearman'
        : combat.faction === 'dog'
          ? 'Kennel-trained settlement guard dog'
          : combat.faction === 'fox'
            ? 'Solitary food thief'
            : combat.faction === 'wolf'
              ? 'Coordinated pack hunter'
        : isPlayerMilitaryFaction(combat.faction)
          ? combatOccupation(combat)
          : combat.faction === 'bandit'
            ? 'Local outlaw'
            : 'Ottoman frontier raider',
      activity,
      activityState: combat.status === 'recovering' ? 'ready' : 'active',
      workplaceLabel: combat.faction === 'dog' ? 'Home kennel'
        : combat.faction === 'fox' ? 'Range'
          : combat.faction === 'wolf' ? 'Pack'
            : combat.faction === 'guard' || isPlayerMilitaryFaction(combat.faction) ? 'Company' : 'Warband',
      workplace: guardhouse
        ? getBuildingDefinition(guardhouse.kind).label
        : combat.faction === 'fox' ? 'Woodland edge'
          : combat.faction === 'wolf' ? `Pack #${combat.raidId}`
            : combat.faction === 'bandit' ? 'Bandit camp' : isPlayerMilitaryFaction(combat.faction) ? 'Town military' : 'Incursion party',
      householdLabel: 'Objective',
      household: target,
      crewLabel: isPlayerMilitaryFaction(combat.faction) ? 'Role' : 'Condition',
      crew: isPlayerMilitaryFaction(combat.faction) ? combatOccupation(combat) : status,
      paceLabel: animal ? 'Traits' : combat.faction === 'guard' || isPlayerMilitaryFaction(combat.faction) ? 'Equipment' : 'Arms and spoils',
      pace: equipment,
      position: { x: visual.displayX, y, z: visual.displayZ },
      route: this.combatInspectionRoute(visual),
      visible: true,
    };
  }

  private combatTargetLabel(combat: CombatAgentState): string {
    if (combat.raidAnchorBuildingId) {
      const refuge = this.buildings.get(combat.raidAnchorBuildingId);
      return refuge
        ? `${getBuildingDefinition(refuge.kind).label} breach`
        : 'Palisaded refuge breach';
    }
    if (
      combat.targetKind === 'building'
      || combat.targetKind === 'treasury-building'
    ) {
      const building = this.buildings.get(combat.targetId);
      return building
        ? getBuildingDefinition(building.kind).label
        : 'Settlement holding';
    }
    if (
      combat.targetKind === 'residence'
      || combat.targetKind === 'treasury-residence'
    ) {
      const residence = this.residences.get(combat.targetId);
      return residence
        ? `Household parcel #${residence.parcelIndex + 1}`
        : 'Settlement household';
    }
    if (combat.targetKind === 'bandit-camp') return 'Bandit camp';
    if (combat.targetKind === 'ground') return 'Commanded position';
    if (combat.targetKind === 'combat-agent') return 'Nearest hostile rank';
    if (combat.targetKind === 'stable-ox') return 'Draft ox';
    return 'Moving supply cart';
  }

  private combatInspectionRoute(visual: CombatAgentVisual): SelectedAgentRoutePoint[] {
    const combat = visual.state;
    let destination: { x: number; z: number } | null = null;
    if (combat.targetKind === 'building' || combat.targetKind === 'treasury-building') {
      destination = this.buildings.get(combat.targetId) ?? null;
    } else if (combat.targetKind === 'residence' || combat.targetKind === 'treasury-residence') {
      destination = this.residences.get(combat.targetId) ?? null;
    } else if (combat.targetKind === 'combat-agent') {
      const target = this.combatAgentVisuals.get(combat.targetId);
      destination = target ? { x: target.displayX, z: target.displayZ } : null;
    } else if (combat.status === 'returning' || combat.status === 'retreating') {
      destination = { x: combat.homeX, z: combat.homeZ };
    }
    if (!destination || Math.hypot(destination.x - visual.displayX, destination.z - visual.displayZ) < 0.35) {
      return [];
    }
    return [
      {
        x: visual.displayX,
        y: this.resolveGroundY(visual.displayX, visual.displayZ) + SELECTED_AGENT_ROUTE_Y_OFFSET,
        z: visual.displayZ,
      },
      {
        x: destination.x,
        y: this.resolveGroundY(destination.x, destination.z) + SELECTED_AGENT_ROUTE_Y_OFFSET,
        z: destination.z,
      },
    ];
  }

  private isVisibleAgent(agent: VillagerAgent): boolean {
    if (
      agent.routinePhase === 'indoors'
      || agent.routinePhase === 'asleep'
      || this.isInstitutionInteriorAgent(agent)
    ) {
      return false;
    }
    if (agent.role === 'worker') {
      const workplace = agent.workplaceId ? this.buildings.get(agent.workplaceId) : null;
      if (
        workplace?.kind === 'guardhouse'
        && this.activeCombatGuardSlots.has(
          combatGuardSlotKey(workplace.id, agent.workplaceSlot),
        )
      ) {
        // The replicated combatant owns this roster slot until conflict
        // aftermath ends, regardless of the ordinary worker's day/night phase.
        return false;
      }
      return Boolean(workplace && workplace.assignedLabor > agent.workplaceSlot);
    }
    if (agent.role === 'founder') return this.foundingCamp !== null;
    const residence = agent.residenceId ? this.residences.get(agent.residenceId) : null;
    return Boolean(residence && !residence.abandoned && residence.population > 0);
  }

  private clericWorkplaceFor(agent: VillagerAgent): BuildingState | null {
    if (agent.role !== 'worker' || !agent.workplaceId) return null;
    const workplace = this.buildings.get(agent.workplaceId) ?? null;
    return workplace && isClericWorkplaceKind(workplace.kind) ? workplace : null;
  }

  private isPriestAgent(agent: VillagerAgent): boolean {
    return this.clericWorkplaceFor(agent)?.kind === 'chapel';
  }

  private isInstitutionInteriorAgent(agent: VillagerAgent): boolean {
    if (agent.routinePhase === 'at_mass' && this.clock && !this.holidayObservance) {
      const phase = chapelMassPhase(this.clock, agent.massChapelId !== null);
      if (phase === 'service') return true;
      if (phase === 'fellowship' && agent.pathPurpose === 'ambient') {
        const chapel = agent.massChapelId
          ? this.buildings.get(agent.massChapelId) ?? null
          : null;
        if (chapel && Math.hypot(agent.x - chapel.x, agent.z - chapel.z) < 3.5) {
          return true;
        }
      }
    }
    if (
      agent.routinePhase === 'observance_at_worksite'
      && this.isPriestAgent(agent)
    ) return true;
    return agent.role === 'worker'
      && agent.routinePhase === 'work'
      && agent.workRemaining > 0
      && agent.workTarget?.interior === true;
  }

  private pushRenderState(
    view?: CrowdViewState,
    animationDt = 0,
    audioDt = animationDt,
  ): void {
    this.cavalryHorseElapsedSeconds += Math.max(0, Math.min(0.1, animationDt));
    const renderAgents = this.renderAgents;
    renderAgents.length = 0;
    if (audioDt > 0) {
      this.workerSoundSources.length = 0;
      this.farmSongSources.length = 0;
      this.combatAudioFighters.length = 0;
    }
    let slot = 0;
    for (const agent of this.agents.values()) {
      if (this.activeMilitaryPersonIdentities.has(agent.personIdentity)) continue;
      let workplace: BuildingState | null = null;
      if (agent.role === 'worker') {
        workplace = agent.workplaceId ? this.buildings.get(agent.workplaceId) ?? null : null;
        if (!workplace || workplace.assignedLabor <= agent.workplaceSlot) continue;
        if (
          workplace.kind === 'guardhouse'
          && this.activeCombatGuardSlots.has(
            combatGuardSlotKey(workplace.id, agent.workplaceSlot),
          )
        ) {
          continue;
        }
      } else if (agent.role === 'founder') {
        if (!this.foundingCamp) continue;
      } else {
        const residence = agent.residenceId ? this.residences.get(agent.residenceId) : null;
        if (!residence || residence.abandoned || residence.population <= 0) continue;
      }
      if (
        agent.routinePhase === 'indoors'
        || agent.routinePhase === 'asleep'
        || this.isInstitutionInteriorAgent(agent)
      ) {
        continue;
      }
      const renderAgent = this.renderAgentFor(agent.id);
      clearCrowdCombatPresentation(renderAgent);
      renderAgent.slot = slot++;
      const renderX = agent.x + agent.avoidanceOffsetX;
      const renderZ = agent.z + agent.avoidanceOffsetZ;
      renderAgent.x = renderX;
      renderAgent.y = agent.avoidanceOffsetX !== 0 || agent.avoidanceOffsetZ !== 0
        ? this.resolveGroundY(renderX, renderZ) + 0.02
        : agent.y;
      renderAgent.z = renderZ;
      renderAgent.yaw = agent.yaw;
      renderAgent.appearanceSeed = agent.appearanceSeed;
      renderAgent.variant = agent.modelVariant;
      renderAgent.presentation = workplace && isClericWorkplaceKind(workplace.kind)
        ? 'cleric'
        : 'common';
      renderAgent.mode = agent.mode;
      renderAgent.tunicColor = workplace?.kind === 'monastery'
        ? MONASTIC_HABIT_COLOR
        : agent.tunicColor;
      renderAgent.skinColor = agent.skinColor;
      renderAgent.hairColor = agent.hairColor;
      renderAgent.tool = this.workerToolFor(agent);
      renderAgent.movementSpeed = agent.currentMoveSpeed;
      renderAgent.active = true;
      renderAgents.push(renderAgent);
      if (audioDt > 0) {
        this.pushWorkerSoundSource(renderAgent, workplace);
        if (
          (agent.mode === 'tend' || agent.mode === 'sow')
          && workplace?.kind === 'threshing_barn'
        ) {
          this.pushFarmSongSource(renderAgent);
        }
      }
    }
    const combatNowMs = presentationNow();
    this.combatAnimalPoses.length = 0;
    this.cavalryHorsePoses.length = 0;
    const cavalryHorseByCombatAgent = new Map<string, CavalryHorseState>();
    for (const horse of this.cavalryHorses.values()) {
      if (horse.assignedCombatAgentId) {
        cavalryHorseByCombatAgent.set(horse.assignedCombatAgentId, horse);
      }
    }
    for (const visual of this.combatAgentVisuals.values()) {
      const combat = visual.state;
      if (isAnimalCombatFaction(combat.faction)) {
        const target = this.nearestCombatOpponent(combat);
        const yaw = target
          ? Math.atan2(target.displayX - visual.displayX, target.displayZ - visual.displayZ)
          : visual.yaw;
        this.combatAnimalPoses.push({
          id: combat.id,
          faction: combat.faction,
          x: visual.displayX,
          y: this.resolveGroundY(visual.displayX, visual.displayZ) + 0.02,
          z: visual.displayZ,
          yaw,
          moveSpeed: visual.displayMoveSpeed,
          status: combat.status,
        });
        continue;
      }
      const residentSoldier = this.agentForPersonIdentity(combat.personIdentity);
      const ordinaryGuard = combat.faction === 'guard' && combat.sourceBuildingId
        ? this.agents.get(
            `worker:${combat.sourceBuildingId}:${combat.sourceSlot}`,
          )
        : null;
      const appearanceSeed = residentSoldier?.appearanceSeed
        ?? ordinaryGuard?.appearanceSeed
        ?? combatAppearanceSeed(combat);
      const colors = pickVillagerColors(appearanceSeed);
      const target = this.nearestCombatOpponent(combat);
      const yaw = combat.companyFacingX !== undefined && combat.companyFacingZ !== undefined
        && (combat.status === 'holding' || combat.status === 'fighting')
        ? Math.atan2(combat.companyFacingX, combat.companyFacingZ)
        : target
        ? Math.atan2(
            target.displayX - visual.displayX,
            target.displayZ - visual.displayZ,
          )
        : visual.yaw;
      const renderAgent = this.renderAgentFor(`combat:${combat.id}`);
      clearCrowdCombatPresentation(renderAgent);
      renderAgent.animationRateScale = villagerAnimationCadenceScale(appearanceSeed);
      renderAgent.slot = slot++;
      renderAgent.x = visual.displayX;
      const combatGroundY = this.resolveGroundY(visual.displayX, visual.displayZ) + 0.02;
      renderAgent.y = combatGroundY;
      renderAgent.z = visual.displayZ;
      renderAgent.yaw = yaw;
      renderAgent.appearanceSeed = appearanceSeed;
      renderAgent.variant = residentSoldier?.modelVariant
        ?? ordinaryGuard?.modelVariant
        ?? (combat.faction === 'bandit' || combat.faction === 'raider' || isPlayerMilitaryFaction(combat.faction)
          ? 'man'
          : appearanceSeed % 2 === 0 ? 'man' : 'woman');
      const pairedHorse = cavalryHorseByCombatAgent.get(combat.id);
      const mounted = isMountedCombatAgent(combat)
        && combat.status !== 'downed'
        && (combat.faction === 'raider' || (pairedHorse != null && !pairedHorse.atPasture));
      renderAgent.mounted = mounted;
      if (mounted) {
        renderAgent.y = combatGroundY + CAVALRY_SADDLE_HEIGHT
          - seatedVillagerContactHeight(renderAgent.variant, appearanceSeed);
        this.cavalryHorsePoses.push({
          id: pairedHorse ? `horse:${pairedHorse.id}` : `ottoman-horse:${combat.id}`,
          x: visual.displayX,
          y: combatGroundY,
          z: visual.displayZ,
          yaw,
          moveSpeed: Math.max(0, visual.displayMoveSpeed),
          activity: visual.displayMoveSpeed > 0.15 ? 'walking' : 'standing',
          presentation: cavalryHorsePresentation(combat),
          appearanceSeed: pairedHorse
            ? horseAppearanceSeed(pairedHorse.id)
            : combatAppearanceSeed(combat),
        });
      }
      renderAgent.presentation = combat.faction === 'raider' ? 'raider' : 'common';
      renderAgent.mode = combatRenderMode(
        combat,
        combat.running ?? ((combat.routeProgress ?? 0) > 14),
        visual.hurtUntilMs > combatNowMs,
        visual.threatenUntilMs > combatNowMs,
        visual.displayMoveSpeed,
      );
      renderAgent.tunicColor = residentSoldier?.tunicColor
        ?? ordinaryGuard?.tunicColor
        ?? (combat.faction === 'raider'
          ? raiderTunicColor(combat, appearanceSeed)
          : combat.faction === 'bandit'
            ? banditTunicColor(appearanceSeed)
            : colors.tunic);
      renderAgent.skinColor = residentSoldier?.skinColor ?? ordinaryGuard?.skinColor ?? colors.skin;
      renderAgent.hairColor = residentSoldier?.hairColor ?? ordinaryGuard?.hairColor
        ?? pickVillagerHairColor(appearanceSeed);
      const standardAssignment = this.companyStandardBearers.assignmentForAgent(combat.id);
      const carriedStandardSidearm = Boolean(standardAssignment)
        || this.fallenCompanyStandardBearers.has(combat.id);
      if (standardAssignment) {
        const standard = renderAgent.companyStandard ?? {
          id: standardAssignment.companyKey,
          faction: standardAssignment.side,
        };
        standard.id = standardAssignment.companyKey;
        standard.faction = standardAssignment.side;
        renderAgent.companyStandard = standard;
      }
      renderAgent.tool = carriedStandardSidearm ? 'sidearm' : combatToolFor(combat);
      if (shouldCreateBattlefieldWeaponDrop(combat.status, renderAgent.tool)) {
        renderAgent.battlefieldWeaponDrop = {
          ownerId: combat.id,
          kind: renderAgent.tool,
          // Player-company kit is already materialized by the authoritative
          // reclamation system at this same combat-agent position.
          recoverable: isPlayerMilitaryFaction(combat.faction),
        };
      }
      if (combat.status === 'fighting' && target) {
        const targetDx = target.displayX - visual.displayX;
        const targetDz = target.displayZ - visual.displayZ;
        const targetDistance = Math.hypot(targetDx, targetDz);
        renderAgent.combatAttackCooldown = combat.attackCooldown;
        renderAgent.combatAttackSeconds = combatAttackSeconds(
          combat,
          targetDistance,
        );
        renderAgent.combatTargetDistance = targetDistance;
        renderAgent.combatTargetX = target.displayX;
        renderAgent.combatTargetY = this.resolveGroundY(
          target.displayX,
          target.displayZ,
        ) + 1.08;
        renderAgent.combatTargetZ = target.displayZ;
        renderAgent.combatLocomotion = visual.displayMoveSpeed > 1.85
          ? 'run'
          : visual.displayMoveSpeed > 0.12 ? 'walk' : 'idle';
      }
      // Drive the feet from the smoothed distance actually covered on screen.
      // Authoritative intent speeds made the run clip race while replicated
      // movement was still interpolating, producing a treadmill effect.
      renderAgent.movementSpeed = Math.max(0, visual.displayMoveSpeed);
      renderAgent.active = true;
      renderAgents.push(renderAgent);
      if (audioDt > 0) this.pushCombatAudioFighter(visual, renderAgent);
    }
    for (const corpse of this.violentCorpses.values()) {
      const appearanceSeed = pickVillagerAppearanceSeed(corpse.id, 0);
      const colors = pickVillagerColors(appearanceSeed);
      const renderAgent = this.renderAgentFor(`violent-corpse:${corpse.id}`);
      clearCrowdCombatPresentation(renderAgent);
      renderAgent.slot = slot++;
      renderAgent.x = corpse.x;
      renderAgent.y = this.resolveGroundY(corpse.x, corpse.z) + 0.02;
      renderAgent.z = corpse.z;
      renderAgent.yaw = appearanceSeed / 0xffff_ffff * Math.PI * 2;
      renderAgent.appearanceSeed = appearanceSeed;
      renderAgent.variant = pickVillagerModelVariant(appearanceSeed);
      renderAgent.presentation = 'common';
      renderAgent.mode = 'fall';
      renderAgent.tunicColor = colors.tunic;
      renderAgent.skinColor = colors.skin;
      renderAgent.hairColor = pickVillagerHairColor(appearanceSeed);
      renderAgent.tool = null;
      renderAgent.movementSpeed = 0;
      renderAgent.active = true;
      renderAgents.push(renderAgent);
    }
    for (const horse of this.cavalryHorses.values()) {
      if (!horse.atPasture || horse.pastureId === null) continue;
      const pasture = this.pastures.get(horse.pastureId);
      if (!pasture) continue;
      const pose = cavalryHorsePasturePose(
        pasture,
        horse,
        this.cavalryHorseElapsedSeconds,
      );
      this.cavalryHorsePoses.push({
        id: `horse:${horse.id}`,
        x: pose.x,
        y: this.resolveGroundY(pose.x, pose.z) + 0.02,
        z: pose.z,
        yaw: pose.yaw,
        moveSpeed: pose.moveSpeed,
        activity: pose.activity,
        presentation: 'pasture',
        appearanceSeed: horseAppearanceSeed(horse.id),
      });
    }
    const activeView = view ?? this.lastView;
    this.renderer.syncAgents(renderAgents, activeView, animationDt);
    this.combatAnimals.sync(this.combatAnimalPoses, activeView, animationDt);
    this.cavalryHorsesRenderer.sync(this.cavalryHorsePoses, activeView, animationDt);
    const audioPaused = this.getGameSpeed() === 0;
    this.farmWorkerSongAudio.setPaused(audioPaused);
    if (audioDt > 0) {
      this.combatAudio.tick(
        audioDt,
        buildCombatAudioSources(
          this.combatAudioFighters,
          this.combatAudioSourceWorkspace,
          activeView,
        ),
        activeView,
      );
      this.activityAudio.tick(
        audioDt,
        this.workerSoundSources,
        activeView,
      );
      this.farmWorkerSongAudio.tick(
        audioDt,
        this.farmSongSources,
        activeView,
      );
    } else if (audioPaused) {
      // A pause freezes the combat presentation and immediately silences any
      // in-flight melee one-shots instead of letting them finish over a frozen
      // battlefield.
      this.combatAudioSourceWorkspace.sources.length = 0;
      this.combatAudio.tick(0, this.combatAudioSourceWorkspace.sources, activeView);
    }
  }

  private renderAgentFor(id: string): CrowdRenderAgent {
    let renderAgent = this.renderAgentsById.get(id);
    if (renderAgent) return renderAgent;
    renderAgent = {
      id,
      slot: 0,
      x: 0,
      y: 0,
      z: 0,
      yaw: 0,
      appearanceSeed: 0,
      variant: 'man',
      presentation: 'common',
      mode: 'idle',
      tunicColor: 0xffffff,
      skinColor: 0xffffff,
      hairColor: 0xffffff,
      tool: null,
      movementSpeed: 0,
      active: true,
    };
    this.renderAgentsById.set(id, renderAgent);
    return renderAgent;
  }

  private advanceCombatAgentVisuals(realDt: number): void {
    const frameDt = Math.min(0.1, Math.max(0, realDt));
    const blend = 1 - Math.exp(-frameDt * 14);
    const speedBlend = 1 - Math.exp(-frameDt * 12);
    for (const visual of this.combatAgentVisuals.values()) {
      const previousX = visual.displayX;
      const previousZ = visual.displayZ;
      visual.displayX += (visual.state.x - visual.displayX) * blend;
      visual.displayZ += (visual.state.z - visual.displayZ) * blend;
      visual.renderPosition.x = visual.displayX;
      visual.renderPosition.z = visual.displayZ;
      const dx = visual.displayX - previousX;
      const dz = visual.displayZ - previousZ;
      const measuredSpeed = frameDt > 1e-5
        ? Math.hypot(dx, dz) / frameDt
        : 0;
      visual.displayMoveSpeed += (measuredSpeed - visual.displayMoveSpeed) * speedBlend;
      if (dx * dx + dz * dz > 1e-8) {
        visual.yaw = Math.atan2(dx, dz);
      }
    }
  }

  private nearestCombatOpponent(
    combat: CombatAgentState,
  ): CombatAgentVisual | null {
    if (combat.status !== 'fighting') return null;
    if (combat.targetKind === 'combat-agent') {
      const target = this.combatAgentVisuals.get(combat.targetId) ?? null;
      return target
        && target.state.status !== 'downed'
        && combatFactionsAreHostile(combat.faction, target.state.faction)
        ? target
        : null;
    }
    let nearest: CombatAgentVisual | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;
    const source = this.combatAgentVisuals.get(combat.id);
    if (!source) return null;
    for (const candidate of this.combatAgentVisuals.values()) {
      if (
        !combatFactionsAreHostile(combat.faction, candidate.state.faction)
        || candidate.state.status === 'downed'
      ) {
        continue;
      }
      const dx = candidate.displayX - source.displayX;
      const dz = candidate.displayZ - source.displayZ;
      const distance = dx * dx + dz * dz;
      if (distance >= nearestDistance) continue;
      nearest = candidate;
      nearestDistance = distance;
    }
    return nearest;
  }

  private workerActivitySoundMode(
    renderAgent: CrowdRenderAgent,
    workplace: BuildingState | null,
  ): WorkerActivitySoundSource['mode'] | null {
    if (renderAgent.mode === 'chop' || renderAgent.mode === 'mine') {
      return renderAgent.mode;
    }
    if (renderAgent.mode === 'build') return workplace?.kind === 'smithy' ? null : 'build';
    if (renderAgent.mode === 'plant') return 'dig';
    if (renderAgent.mode === 'fish') return 'fish';
    if (renderAgent.mode === 'gather') return 'forage';
    if (renderAgent.mode !== 'tend') return null;
    if (workplace?.kind === 'charcoal_burner') return 'dig';
    if (workplace?.kind === 'threshing_barn') {
      return this.agents.get(renderAgent.id)?.workTarget?.fieldStage === 'ploughing'
        ? 'dig'
        : 'cut_crop';
    }
    return workplace?.kind === 'pastoral_farmstead' || workplace?.kind === 'swineherd'
      ? 'livestock'
      : null;
  }

  private pushWorkerSoundSource(
    renderAgent: CrowdRenderAgent,
    workplace: BuildingState | null,
  ): void {
    const mode = this.workerActivitySoundMode(renderAgent, workplace);
    if (!mode) return;
    const sourceIndex = this.workerSoundSources.length;
    let source = this.workerSoundSourcePool[sourceIndex];
    if (!source) {
      source = { id: renderAgent.id, mode, x: 0, z: 0 };
      this.workerSoundSourcePool.push(source);
    }
    source.id = renderAgent.id;
    source.mode = mode;
    source.x = renderAgent.x;
    source.z = renderAgent.z;
    this.workerSoundSources.push(source);
  }

  private pushFarmSongSource(renderAgent: CrowdRenderAgent): void {
    const sourceIndex = this.farmSongSources.length;
    let source = this.farmSongSourcePool[sourceIndex];
    if (!source) {
      source = { id: renderAgent.id, x: 0, z: 0 };
      this.farmSongSourcePool.push(source);
    }
    source.id = renderAgent.id;
    source.x = renderAgent.x;
    source.z = renderAgent.z;
    this.farmSongSources.push(source);
  }

  private pushCombatAudioFighter(
    visual: CombatAgentVisual,
    renderAgent: CrowdRenderAgent,
  ): void {
    const fighterIndex = this.combatAudioFighters.length;
    const activeWeaponFamily = combatWeaponSoundFamily(
      renderAgent.tool,
      renderAgent.combatTargetDistance ?? Infinity,
    );
    let fighter = this.combatAudioFighterPool[fighterIndex];
    if (!fighter) {
      fighter = {
        id: visual.state.id,
        faction: visual.state.faction,
        status: visual.state.status,
        health: visual.state.health,
        x: visual.displayX,
        z: visual.displayZ,
        attackCooldown: visual.state.attackCooldown,
        issuedPolearms: visual.state.issuedPolearms,
        targetKind: visual.state.targetKind,
        activeWeaponFamily,
      };
      this.combatAudioFighterPool.push(fighter);
    } else {
      fighter.id = visual.state.id;
      fighter.faction = visual.state.faction;
      fighter.status = visual.state.status;
      fighter.health = visual.state.health;
      fighter.x = visual.displayX;
      fighter.z = visual.displayZ;
      fighter.attackCooldown = visual.state.attackCooldown;
      fighter.issuedPolearms = visual.state.issuedPolearms;
      fighter.targetKind = visual.state.targetKind;
      fighter.activeWeaponFamily = activeWeaponFamily;
    }
    this.combatAudioFighters.push(fighter);
  }

  private simStep(agent: VillagerAgent, dt: number): void {
    if (
      agent.workRemaining > 0
      && agent.workTarget !== null
      && !agent.workPerformed
    ) {
      const workplace = agent.workplaceId
        ? this.buildings.get(agent.workplaceId)
        : null;
      if (workplace && workerProductionBlocker(workplace)) {
        this.finishWorkerActivity(agent);
        return;
      }
      agent.currentMoveSpeed = 0;
      agent.workRemaining -= dt;
      if (agent.workRemaining <= 0) this.finishWorkerActivity(agent);
      return;
    }

    if (agent.mode === 'pray') {
      agent.currentMoveSpeed = 0;
      if (
        agent.routinePhase === 'praying_at_shrine'
        || agent.routinePhase === 'praying_at_graveyard'
      ) {
        agent.idleRemaining -= dt;
        if (agent.idleRemaining <= 0) {
          if (agent.routinePhase === 'praying_at_shrine') {
            this.beginWaysideShrineReturn(agent);
          } else {
            this.beginGraveyardReturn(agent);
          }
        }
      }
      return;
    }

    if (
      agent.mode === 'sit'
      || agent.mode === 'rest'
      || agent.mode === 'talk'
    ) {
      agent.currentMoveSpeed = 0;
      return;
    }

    if (
      agent.mode === 'idle'
      || agent.mode === 'relax'
      || agent.mode === 'look'
      || agent.mode === 'wait'
    ) {
      agent.currentMoveSpeed = 0;
      if (agent.ambientBehavior) return;
      agent.idleRemaining -= dt;
      if (agent.idleRemaining <= 0) {
        if (agent.routinePhase === 'work' && agent.role === 'worker') {
          this.tryBeginWorkerWalk(agent);
        } else if (agent.routinePhase === 'home_outdoors') {
          if (agent.role !== 'founder') {
            const residence = agent.residenceId ? this.residences.get(agent.residenceId) : null;
            if (residence && !this.tryBeginBackyardWork(agent, residence)) {
              this.tryBeginWalk(agent, residence);
            }
          } else {
            agent.idleRemaining = pickIdleDuration(agent.pathSeed) * 0.7;
          }
        }
      }
      return;
    }

    const currentPathPoint = samplePolylineXZ(agent.path, agent.simPathCursor);
    const onRoad = Boolean(
      currentPathPoint
      && this.roadNetwork
      && isOnRoadSurface(currentPathPoint.x, currentPathPoint.z, this.roadNetwork),
    );
    agent.currentMoveSpeed = surfaceAdjustedTravelSpeed(
      agent.walkSpeed,
      onRoad,
      PEDESTRIAN_ROAD_SPEED_MULTIPLIER,
    ) * (agent.mode === 'run' || agent.mode === 'flee' ? 1.62 : 1);
    const nextPathCursor = Math.min(
      agent.pathDistance,
      agent.simPathCursor + agent.currentMoveSpeed * dt,
    );
    if (
      (agent.pathPurpose === 'worker_work_loop'
        || agent.pathPurpose === 'backyard_work')
      && agent.workActivity
      && agent.workTarget
      && !agent.workPerformed
      && nextPathCursor >= agent.workStopDistance
    ) {
      this.beginWorkerActivity(agent);
      return;
    }

    agent.simPathCursor = nextPathCursor;
    agent.pathCursor = agent.simPathCursor;
    if (agent.simPathCursor >= agent.pathDistance) {
      switch (agent.pathPurpose) {
        case 'return_home':
          this.completeWorkerReturnHome(agent);
          break;
        case 'return_to_work':
          this.completeWorkerReturnToWork(agent);
          break;
        case 'return_for_observance':
          this.completeWorkerObservanceReturn(agent);
          break;
        case 'chapel_mass':
          this.completeMassArrival(agent);
          break;
        case 'return_from_mass':
          this.completeMassReturn(agent);
          break;
        case 'monastery_feast':
          this.completeFeastArrival(agent);
          break;
        case 'return_from_feast':
          this.completeFeastReturn(agent);
          break;
        case 'wayside_shrine_prayer':
          this.completeWaysideShrineArrival(agent);
          break;
        case 'return_from_shrine':
          this.completeWaysideShrineReturn(agent);
          break;
        case 'graveyard_prayer':
          this.completeGraveyardArrival(agent);
          break;
        case 'return_from_graveyard':
          this.completeGraveyardReturn(agent);
          break;
        case 'refuge_rally':
          this.completeRefugeArrival(agent);
          break;
        case 'return_from_refuge':
          this.completeRefugeReturn(agent);
          break;
        case 'guard_muster':
          this.completeGuardMuster(agent);
          break;
        case 'return_from_muster':
          this.completeGuardMusterReturn(agent);
          break;
        case 'fire_assembly':
          this.completeFireAssemblyArrival(agent);
          break;
        case 'return_from_fire_assembly':
          this.completeFireAssemblyReturn(agent);
          break;
        case 'worker_work_loop':
          this.resetWorkerToIdle(agent);
          break;
        case 'home_wander': {
          const residence = agent.residenceId ? this.residences.get(agent.residenceId) : null;
          if (residence) this.resetToIdle(agent, residence);
          break;
        }
        case 'backyard_work': {
          const residence = agent.residenceId ? this.residences.get(agent.residenceId) : null;
          if (residence) this.resetToIdle(agent, residence);
          break;
        }
        case 'ambient':
          this.completeAmbientArrival(agent);
          break;
        default:
          this.clearPath(agent);
          break;
      }
    }
  }

  private interpolateDisplay(agent: VillagerAgent, dt: number): void {
    if (!isTravelMode(agent.mode)) return;
    const blend = 1 - Math.exp(-dt * 18);
    agent.displayPathCursor += (agent.simPathCursor - agent.displayPathCursor) * blend;
  }

  private syncDisplayPose(agent: VillagerAgent): void {
    if (isTravelMode(agent.mode)) {
      const sample = samplePolylineXZ(agent.path, agent.displayPathCursor);
      if (sample) {
        agent.x = sample.x;
        agent.z = sample.z;
        agent.yaw = sample.yaw;
      }
      return;
    }
    if (agent.pathPurpose === 'backyard_work') return;
    if (
      agent.routinePhase === 'work'
      || agent.routinePhase === 'at_mass'
      || agent.routinePhase === 'at_feast'
      || agent.routinePhase === 'praying_at_shrine'
      || agent.routinePhase === 'praying_at_graveyard'
      || agent.routinePhase === 'at_refuge'
      || agent.routinePhase === 'at_muster'
    ) {
      return;
    }
    const residence = agent.residenceId ? this.residences.get(agent.residenceId) : null;
    if (residence) agent.yaw = residence.yaw + agent.idleOffset.yaw;
  }

  private updateWorkerLocalAvoidance(dtSeconds: number): void {
    if (dtSeconds <= 0) return;
    const candidates = this.workerAvoidanceAgents;
    candidates.length = 0;
    for (const agent of this.agents.values()) {
      if (
        agent.role !== 'worker'
        || agent.routinePhase === 'indoors'
        || agent.routinePhase === 'asleep'
        || this.isInstitutionInteriorAgent(agent)
      ) {
        continue;
      }
      const workplace = agent.workplaceId
        ? this.buildings.get(agent.workplaceId)
        : null;
      if (!workplace || workplace.assignedLabor <= agent.workplaceSlot) continue;
      candidates.push(agent);
    }
    this.workerAvoidance.update(candidates, dtSeconds);
  }

  private beginWorkerActivity(agent: VillagerAgent): void {
    if (!agent.workActivity || !agent.workTarget) return;
    const workplace = agent.workplaceId
      ? this.buildings.get(agent.workplaceId)
      : null;
    if (workplace && workerProductionBlocker(workplace)) {
      agent.workActivity = null;
      agent.workTarget = null;
      agent.workPerformed = true;
      return;
    }
    agent.mode = workplace && isClericWorkplaceKind(workplace.kind)
      ? clericDutyAnimation(agent.workTarget.clericDuty, agent.pathSeed) as VillagerMode
      : agent.workActivity;
    agent.simPathCursor = agent.workStopDistance;
    agent.pathCursor = agent.workStopDistance;
    agent.displayPathCursor = agent.workStopDistance;
    agent.workRemaining = WORKER_ACTIVITY_SECONDS;

    const sample = samplePolylineXZ(agent.path, agent.workStopDistance);
    if (sample) {
      agent.x = sample.x;
      agent.z = sample.z;
    }
    agent.yaw = Math.atan2(
      agent.workTarget.x - agent.x,
      agent.workTarget.z - agent.z,
    );
    agent.y = this.resolveGroundY(agent.x, agent.z) + 0.02;
  }

  private finishWorkerActivity(agent: VillagerAgent): void {
    agent.mode = 'walk';
    agent.workRemaining = 0;
    agent.workPerformed = true;
    agent.simPathCursor = Math.min(
      agent.pathDistance,
      agent.workStopDistance + 0.01,
    );
    agent.pathCursor = agent.simPathCursor;
    agent.displayPathCursor = agent.simPathCursor;
  }

  private tryBeginWalk(agent: VillagerAgent, residence: ResidenceState): boolean {
    const candidatePath = pickVillagerWalkPath(
      residence,
      [...this.residences.values()],
      this.roadNetwork,
      agent.pathSeed,
      agent.nearestEdge,
      this.homePlotLeisureAreas.get(residence.id) ?? null,
      { x: agent.x, z: agent.z },
    );
    agent.pathSeed = (agent.pathSeed * 1_664_525) ^ 0x7feb352d;

    const path = candidatePath ? this.routePath(candidatePath) : null;
    const pathDistance = path ? polylineLengthXZ(path) : 0;
    if (!path || pathDistance < 4) {
      agent.idleRemaining = pickIdleDuration(agent.pathSeed);
      return false;
    }

    agent.mode = 'walk';
    agent.pathPurpose = 'home_wander';
    agent.path = path;
    agent.pathDistance = pathDistance;
    agent.pathCursor = 0;
    agent.simPathCursor = 0;
    agent.displayPathCursor = 0;
    this.clearWorkerActivity(agent);
    agent.idleDirty = false;
    return true;
  }

  private tryBeginWorkerWalk(agent: VillagerAgent): void {
    const building = agent.workplaceId ? this.buildings.get(agent.workplaceId) : null;
    if (!building) return;
    if (building.kind === 'watchtower' && building.constructionComplete !== false) {
      this.scanFromWatchtower(agent, building);
      return;
    }
    if (this.marketStallDutyForAgent(agent)) {
      this.placeWorkerIdle(agent, building);
      agent.idleRemaining = pickIdleDuration(agent.pathSeed) * 0.45;
      agent.pathSeed = (agent.pathSeed * 1_664_525) ^ 0x165667b1;
      return;
    }
    const allTargets = this.workerTargets.get(building.id) ?? [];
    const targets = this.essentialSabbathDutyFor(building) === 'livestock_care'
      ? allTargets.filter((target) => target.kind === 'pasture')
      : allTargets;
    const plan = pickWorkerWalkPlan(
      building,
      agent.workplaceSlot,
      targets,
      agent.pathSeed,
      this.roadNetwork,
      this.isWaterAt,
      this.oxen.hasWorkerAssignment(building.id, agent.workplaceSlot),
    );
    agent.pathSeed = (agent.pathSeed * 1_664_525) ^ 0x165667b1;

    const routedPlan = plan
      ? this.routeWorkerPath(plan.path, plan.workDistance)
      : null;
    const path = routedPlan?.path ?? null;
    const pathDistance = path ? polylineLengthXZ(path) : 0;
    const fishingPathTouchesWater = building.kind === 'fishing_camp'
      && path
      && (
        !this.isWaterAt
        || polylineTouchesWater(path, this.isWaterAt)
      );
    const minimumPathDistance = plan?.activity === 'fish' ? 0.25 : 4;
    if (!path || pathDistance < minimumPathDistance || fishingPathTouchesWater) {
      agent.idleRemaining = pickIdleDuration(agent.pathSeed) * 0.5;
      return;
    }

    agent.mode = 'walk';
    agent.pathPurpose = 'worker_work_loop';
    agent.path = path;
    agent.pathDistance = pathDistance;
    agent.pathCursor = 0;
    agent.simPathCursor = 0;
    agent.displayPathCursor = 0;
    agent.workActivity = plan?.activity ?? null;
    agent.workTarget = plan?.target ? { ...plan.target } : null;
    agent.workStopDistance = routedPlan?.workStopDistance ?? 0;
    agent.workRemaining = 0;
    agent.workPerformed = false;
    agent.idleDirty = false;
  }

  private tryBeginBackyardWork(
    agent: VillagerAgent,
    residence: ResidenceState,
  ): boolean {
    const worksite = this.backyardWorksites.get(residence.id);
    if (!worksite || this.sabbathPausedToday || this.laborPaused) return false;

    // Keep the household action readable without sending every off-duty person
    // into the same small bed on every idle cycle.
    const seed = agent.pathSeed >>> 0;
    if (residence.smallholding !== true && seed % 3 !== 0) return false;
    const unitA = ((seed ^ 0x9e3779b9) >>> 0) / 0x1_0000_0000;
    const unitB = (Math.imul(seed ^ 0x85ebca6b, 0xc2b2ae35) >>> 0) / 0x1_0000_0000;
    const localX = (unitA - 0.5) * worksite.width * 0.5;
    const localZ = (unitB - 0.5) * worksite.depth * 0.52;
    const cos = Math.cos(worksite.yaw);
    const sin = Math.sin(worksite.yaw);
    const target = {
      x: worksite.x + localX * cos + localZ * sin,
      z: worksite.z - localX * sin + localZ * cos,
    };
    const home = residenceDoorPosition(residence);
    const rawPath = [
      { x: agent.x, z: agent.z },
      target,
      { x: home.x, z: home.z },
    ];
    const approachDistance = Math.hypot(target.x - agent.x, target.z - agent.z);
    const routed = this.routeWorkerPath(rawPath, approachDistance);
    if (!routed || routed.workStopDistance == null) return false;
    const pathDistance = polylineLengthXZ(routed.path);
    if (pathDistance < 0.35) return false;

    this.clearWorkerActivity(agent);
    agent.mode = 'walk';
    agent.pathPurpose = 'backyard_work';
    agent.path = routed.path;
    agent.pathDistance = pathDistance;
    agent.pathCursor = 0;
    agent.simPathCursor = 0;
    agent.displayPathCursor = 0;
    agent.workActivity = 'gather';
    agent.workTarget = target;
    agent.workStopDistance = routed.workStopDistance;
    agent.workPerformed = false;
    agent.idleDirty = false;
    agent.pathSeed = (agent.pathSeed * 1_664_525) ^ 0x27d4eb2d;
    return true;
  }

  private syncRefugeRallySlots(): void {
    const rosters = new Map<string, VillagerAgent[]>();
    if (this.frontierAlertActive) {
      for (const agent of this.agents.values()) {
        const refuge = this.assignedRefugeForResidence(agent);
        if (!refuge) continue;
        const roster = rosters.get(refuge.id);
        if (roster) roster.push(agent);
        else rosters.set(refuge.id, [agent]);
      }
    }

    const assignedSlots = new Map<string, number>();
    for (const roster of rosters.values()) {
      roster.sort((left, right) =>
        left.personIdentity < right.personIdentity
          ? -1
          : left.personIdentity > right.personIdentity
            ? 1
            : 0
      );
      for (let slot = 0; slot < roster.length; slot += 1) {
        assignedSlots.set(roster[slot]!.id, slot);
      }
    }
    for (const agent of this.agents.values()) {
      const slot = assignedSlots.get(agent.id);
      if (slot !== undefined) {
        agent.refugeSlot = slot;
      } else if (
        agent.routinePhase !== 'going_to_refuge'
        && agent.routinePhase !== 'at_refuge'
        && agent.routinePhase !== 'returning_from_refuge'
      ) {
        agent.refugeId = null;
        agent.refugeSlot = -1;
      }
    }
  }

  private syncGuardMusterSlots(): void {
    const rosters = new Map<string, VillagerAgent[]>();
    if (this.frontierAlertActive) {
      for (const agent of this.agents.values()) {
        const tower = this.assignedGuardMusterTower(agent);
        if (!tower) continue;
        const roster = rosters.get(tower.id);
        if (roster) roster.push(agent);
        else rosters.set(tower.id, [agent]);
      }
    }

    const assignedSlots = new Map<string, number>();
    for (const roster of rosters.values()) {
      roster.sort((left, right) => {
        const workplaceOrder = (left.workplaceId ?? '')
          .localeCompare(right.workplaceId ?? '');
        return workplaceOrder !== 0
          ? workplaceOrder
          : left.workplaceSlot - right.workplaceSlot;
      });
      for (let slot = 0; slot < roster.length; slot += 1) {
        assignedSlots.set(roster[slot]!.id, slot);
      }
    }
    for (const agent of this.agents.values()) {
      const slot = assignedSlots.get(agent.id);
      if (slot !== undefined) {
        agent.musterSlot = slot;
      } else if (
        agent.routinePhase !== 'going_to_muster'
        && agent.routinePhase !== 'at_muster'
        && agent.routinePhase !== 'returning_from_muster'
      ) {
        agent.musterTowerId = null;
        agent.musterSlot = -1;
      }
    }
  }

  private isDefenseDutyAgent(agent: VillagerAgent): boolean {
    if (agent.role !== 'worker' || !agent.workplaceId) return false;
    const workplace = this.buildings.get(agent.workplaceId);
    return !this.fireDisabledBuildingIds.has(agent.workplaceId)
      && (workplace?.kind === 'watchtower' || workplace?.kind === 'guardhouse');
  }

  private assignedRefugeForResidence(agent: VillagerAgent): BuildingState | null {
    if (
      !this.frontierAlertActive
      || !agent.residenceId
      || this.isDefenseDutyAgent(agent)
    ) return null;
    const refugeId = this.refugeAssignments.get(agent.residenceId);
    const refuge = refugeId ? this.buildings.get(refugeId) : null;
    return refuge?.kind === 'palisaded_refuge'
      && refuge.constructionComplete !== false
      && !this.fireDisabledBuildingIds.has(refuge.id)
      ? refuge
      : null;
  }

  private assignedGuardMusterTower(
    agent: VillagerAgent,
  ): BuildingState | null {
    if (
      !this.frontierAlertActive
      || agent.role !== 'worker'
      || !agent.workplaceId
    ) return null;
    const guardhouse = this.buildings.get(agent.workplaceId);
    if (
      guardhouse?.kind !== 'guardhouse'
      || guardhouse.constructionComplete === false
      || this.fireDisabledBuildingIds.has(guardhouse.id)
      || agent.workplaceSlot >= Math.floor(guardhouse.polearms ?? 0)
    ) return null;
    const assignment = this.guardMusterAssignments.get(guardhouse.id);
    const tower = assignment
      ? this.buildings.get(assignment.towerId)
      : null;
    return tower?.kind === 'watchtower'
      && tower.constructionComplete !== false
      && tower.assignedLabor > 0
      && !this.fireDisabledBuildingIds.has(tower.id)
      ? tower
      : null;
  }

  private reconcileRoutine(agent: VillagerAgent): boolean {
    if (!this.clock) return false;
    const musterTower = this.assignedGuardMusterTower(agent);
    if (musterTower) {
      if (
        agent.musterTowerId === musterTower.id
        && (
          agent.routinePhase === 'going_to_muster'
          || agent.routinePhase === 'at_muster'
        )
      ) {
        return false;
      }
      return this.beginGuardMuster(agent, musterTower);
    }
    if (
      agent.routinePhase === 'going_to_muster'
      || agent.routinePhase === 'at_muster'
    ) {
      const emergencyRefuge = this.assignedRefugeForResidence(agent);
      if (emergencyRefuge) {
        return this.beginRefugeJourney(agent, emergencyRefuge);
      }
      return this.beginGuardMusterReturn(agent);
    }
    if (agent.routinePhase === 'returning_from_muster') {
      const workplaceFireDisabled = agent.workplaceId
        ? this.fireDisabledBuildingIds.has(agent.workplaceId)
        : false;
      if (!workplaceFireDisabled) return false;
      const emergencyRefuge = this.assignedRefugeForResidence(agent);
      return emergencyRefuge
        ? this.beginRefugeJourney(agent, emergencyRefuge)
        : this.beginWorkerReturnHome(agent);
    }

    const refuge = this.assignedRefugeForResidence(agent);
    if (refuge) {
      if (
        agent.refugeId === refuge.id
        && (
          agent.routinePhase === 'going_to_refuge'
          || agent.routinePhase === 'at_refuge'
        )
      ) {
        return false;
      }
      return this.beginRefugeJourney(agent, refuge);
    }
    if (
      agent.routinePhase === 'going_to_refuge'
      || agent.routinePhase === 'at_refuge'
    ) {
      return this.beginRefugeReturn(agent);
    }
    if (agent.routinePhase === 'returning_from_refuge') return false;

    const workplace = agent.role === 'worker' && agent.workplaceId
      ? this.buildings.get(agent.workplaceId) ?? null
      : null;
    const shouldWork = agent.role === 'worker'
      && this.shouldWorkerReportToWork(workplace);
    const essentialSabbathDuty = agent.role === 'worker'
      ? this.essentialSabbathDutyFor(workplace)
      : null;
    const residence = agent.residenceId
      ? this.residences.get(agent.residenceId) ?? null
      : null;
    const residenceFireDisabled = residence
      ? this.fireDisabledResidenceIds.has(residence.id)
      : false;

    if (
      residenceFireDisabled
      && residence
      && !shouldWork
    ) {
      if (
        agent.routinePhase === 'going_to_fire_assembly'
        || agent.routinePhase === 'at_fire_assembly'
      ) {
        return false;
      }
      return this.beginFireAssemblyJourney(agent, residence);
    }
    if (
      agent.routinePhase === 'going_to_fire_assembly'
      || agent.routinePhase === 'at_fire_assembly'
    ) {
      return shouldWork
        ? this.beginWorkerReturnToWork(agent)
        : this.beginFireAssemblyReturn(agent);
    }
    if (agent.routinePhase === 'returning_from_fire_assembly') {
      return shouldWork
        ? this.beginWorkerReturnToWork(agent)
        : false;
    }

    if (agent.isSick) {
      return this.transitionToSickRest(agent);
    }

    if (
      essentialSabbathDuty === 'livestock_care'
      && agent.routinePhase === 'work'
      && (agent.mode === 'gather' || agent.workActivity === 'gather')
    ) {
      // Swineherds may normally range into the mast trees. At Sabbath they
      // physically return to the holding and limit the visible loop to pasture
      // care, matching the server's zero productive-labor cycle.
      return this.beginWorkerReturnToWork(agent);
    }

    if (
      !shouldWork
      && this.sabbathPausedToday
      && workplace
      && agent.routinePhase === 'work'
      && !this.workerCanCompleteObservanceHomecoming(agent, workplace)
    ) {
      return this.transitionToWorksiteObservance(agent);
    }
    if (agent.routinePhase === 'observance_at_worksite') {
      if (shouldWork) return this.beginWorkerReturnToWork(agent);
      if (
        !this.sabbathPausedToday
        || !workplace
        || this.fireDisabledBuildingIds.has(workplace.id)
      ) {
        return this.beginWorkerReturnHome(agent);
      }
      return false;
    }
    if (agent.pathPurpose === 'return_for_observance') {
      if (!workplace || this.fireDisabledBuildingIds.has(workplace.id)) {
        return this.beginWorkerReturnHome(agent);
      }
      return false;
    }
    if (
      !shouldWork
      && this.sabbathPausedToday
      && workplace
      && this.shouldBeginWorkerObservanceReturn(agent, workplace)
    ) {
      return this.beginWorkerReturnToWork(agent, true);
    }

    const homeState = this.householdHomeStateFor(agent);
    const chapel = this.findMassChapel(agent);
    const sundayMassTime = isSundayMassTime(
      this.clock,
      chapel != null && this.sabbathPausedToday,
    );
    const holidayMassTime = Boolean(
      chapel
      && this.holidayObservance
      && holidayChapelActivityFor(
        this.clock,
        this.holidayObservance,
        agent.personIdentity,
      ),
    );
    const shouldAttendMass = holidayMassTime
      || (
        sundayMassTime
        && (agent.role !== 'worker' || !shouldWork)
      );

    const devotionalVisitKey = this.currentDevotionalVisitKey();
    const devotionalVisitCompleted = devotionalVisitKey !== ''
      && agent.lastDevotionalVisitKey === devotionalVisitKey;
    const waysideShrine = this.findWaysideShrine(agent);
    const waysideShrineSlot = devotionalVisitCompleted
      ? undefined
      : this.waysideShrineVisitorSlots.get(agent.id);
    const graveyardVisit = devotionalVisitCompleted
      ? undefined
      : this.graveyardVisitorSlots.get(agent.id);
    const graveyard = graveyardVisit
      ? this.graveyards.get(graveyardVisit.graveyardId) ?? null
      : null;
    const shouldVisitWaysideShrine = waysideShrine != null
      && waysideShrineSlot !== undefined
      && (agent.role !== 'worker' || !shouldWork);
    const shouldVisitGraveyard = graveyard != null
      && graveyardVisit !== undefined
      && (agent.role !== 'worker' || !shouldWork);

    if (shouldAttendMass && chapel) {
      if (
        agent.routinePhase === 'going_to_mass'
        || agent.routinePhase === 'at_mass'
      ) {
        return false;
      }
      return this.beginMassJourney(agent, chapel);
    }

    if (
      agent.routinePhase === 'going_to_mass'
      || agent.routinePhase === 'at_mass'
    ) {
      if (
        this.clock.isSunday
        && this.sabbathPausedToday
        && this.holidayObservance === null
      ) {
        if (shouldVisitWaysideShrine && waysideShrine) {
          return this.beginWaysideShrineJourney(
            agent,
            waysideShrine,
            waysideShrineSlot,
          );
        }
        if (shouldVisitGraveyard && graveyard && graveyardVisit) {
          return this.beginGraveyardJourney(
            agent,
            graveyard,
            graveyardVisit.slot,
          );
        }
      }
      return this.beginMassReturn(agent);
    }
    if (agent.routinePhase === 'returning_from_mass') return false;

    const feastMonastery = this.findFeastMonastery(agent);
    const feastGatheringTime = isMonasteryFeastGatheringTime(
      this.clock,
      this.monasteryFeastsEnabled && !this.frontierAlertActive,
      feastMonastery != null,
    );
    const shouldAttendFeast = feastGatheringTime
      && (agent.role !== 'worker' || !shouldWork);
    if (shouldAttendFeast && feastMonastery) {
      if (
        agent.routinePhase === 'going_to_feast'
        || agent.routinePhase === 'at_feast'
      ) {
        return false;
      }
      return this.beginFeastJourney(agent, feastMonastery);
    }
    if (
      agent.routinePhase === 'going_to_feast'
      || agent.routinePhase === 'at_feast'
    ) {
      return this.beginFeastReturn(agent);
    }
    if (agent.routinePhase === 'returning_from_feast') return false;

    if (agent.routinePhase === 'going_to_shrine') return false;
    if (agent.routinePhase === 'praying_at_shrine') return false;
    if (shouldVisitWaysideShrine && waysideShrine) {
      return this.beginWaysideShrineJourney(
        agent,
        waysideShrine,
        waysideShrineSlot,
      );
    }
    if (agent.routinePhase === 'returning_from_shrine') return false;

    if (agent.routinePhase === 'going_to_graveyard') return false;
    if (agent.routinePhase === 'praying_at_graveyard') return false;
    if (shouldVisitGraveyard && graveyard && graveyardVisit) {
      return this.beginGraveyardJourney(
        agent,
        graveyard,
        graveyardVisit.slot,
      );
    }
    if (agent.routinePhase === 'returning_from_graveyard') return false;

    if (
      !shouldWork
      && agent.role === 'worker'
      && agent.pathPurpose === 'return_to_work'
    ) {
      return this.beginWorkerReturnHome(agent);
    }

    // Ordinary schedule changes never reverse a journey already under way.
    // Emergencies and explicit religious gatherings may still preempt it.
    if (
      agent.pathPurpose === 'return_home'
      || agent.pathPurpose === 'return_to_work'
    ) {
      return false;
    }

    if (agent.role === 'founder') {
      return this.transitionToHomeState(agent, 'home_outdoors');
    }

    if (agent.role === 'worker') {
      if (shouldWork) {
        if (agent.routinePhase === 'work' || agent.routinePhase === 'returning_to_work') {
          return false;
        }
        return this.beginWorkerReturnToWork(agent);
      }

      if (agent.routinePhase === 'returning_home') return false;
      if (agent.routinePhase === 'work' || agent.routinePhase === 'returning_to_work') {
        return this.beginWorkerReturnHome(agent);
      }
    }

    return this.transitionToHomeState(agent, homeState);
  }

  private shouldWorkerReportToWork(
    workplace: BuildingState | null,
  ): boolean {
    if (
      !this.clock
      || !workplace
      || this.fireDisabledBuildingIds.has(workplace.id)
    ) {
      return false;
    }
    if (this.essentialSabbathDutyFor(workplace)) return true;
    return !this.laborPaused
      && !this.sabbathPausedToday
      && this.holidayObservance === null;
  }

  private essentialSabbathDutyFor(
    workplace: BuildingState | null,
  ): EssentialSabbathDuty | null {
    if (
      !this.clock?.isSunday
      || !this.sabbathPausedToday
      || this.holidayObservance !== null
      || !workplace
      || this.fireDisabledBuildingIds.has(workplace.id)
    ) {
      return null;
    }
    switch (workplace.kind) {
      case 'pastoral_farmstead':
      case 'swineherd':
        return this.frontierAlertActive ? null : 'livestock_care';
      case 'watchtower':
        return 'watch';
      case 'guardhouse':
        return 'guard_readiness';
      default:
        return null;
    }
  }

  private householdHomeStateFor(agent: VillagerAgent): HouseholdHomeState {
    const hour = this.clock
      ? this.clock.hour + this.clock.minute / 60
      : 0;
    if (
      agent.residenceId
      && this.clock?.isSunday
      && this.sabbathPausedToday
      && this.holidayObservance === null
      && hour >= SABBATH_DEVOTION_START_HOUR
    ) {
      return 'indoors';
    }
    const presentationClock = this.householdPresentationClock ?? this.clock;
    if (
      agent.role === 'worker'
      && agent.residenceId
      && presentationClock
      && !this.backyardWorksites.has(agent.residenceId)
      && (this.laborPaused || this.sabbathPausedToday || this.holidayObservance !== null)
      && isDaytimeHouseholdIndoorPause(agent.personIdentity, presentationClock)
    ) {
      return 'indoors';
    }
    return presentationClock
      ? householdMemberHomeState(agent.personIdentity, presentationClock)
      : 'home_outdoors';
  }

  private workerCanCompleteObservanceHomecoming(
    agent: VillagerAgent,
    workplace: BuildingState,
  ): boolean {
    const home = this.workerPermanentHomeDestination(agent);
    if (!home) return false;
    const duty = this.workerDutyPosition(workplace, agent.workplaceSlot);
    const outward = pickWorkerTravelPath(agent, home, this.roadNetwork);
    const returning = pickWorkerTravelPath(home, duty, this.roadNetwork);
    const travelDistance = (outward ? polylineLengthXZ(outward) : 0)
      + (returning ? polylineLengthXZ(returning) : 0);
    const optimisticTravelSeconds = travelDistance / Math.max(
      0.1,
      agent.walkSpeed
        * WORKFORCE_MOVEMENT_SPEED_MULTIPLIER
        * PEDESTRIAN_ROAD_SPEED_MULTIPLIER,
    );
    return optimisticTravelSeconds <= CALENDAR_SECONDS_PER_DAY;
  }

  private shouldBeginWorkerObservanceReturn(
    agent: VillagerAgent,
    workplace: BuildingState,
  ): boolean {
    if (
      !this.clock
      || (
        agent.routinePhase !== 'home_outdoors'
        && agent.routinePhase !== 'indoors'
        && agent.routinePhase !== 'asleep'
      )
    ) {
      return false;
    }
    const duty = this.workerDutyPosition(workplace, agent.workplaceSlot);
    const path = pickWorkerTravelPath(agent, duty, this.roadNetwork);
    if (!path) return true;
    const conservativeTravelSeconds = polylineLengthXZ(path)
      / Math.max(
        0.1,
        agent.walkSpeed * WORKFORCE_MOVEMENT_SPEED_MULTIPLIER,
      )
      + 1;
    const hour = this.clock.preciseHour
      ?? this.clock.hour + this.clock.minute / 60;
    const secondsRemaining = Math.max(
      0,
      (CALENDAR_HOURS_PER_DAY - hour)
        / CALENDAR_HOURS_PER_DAY
        * CALENDAR_SECONDS_PER_DAY,
    );
    return secondsRemaining <= conservativeTravelSeconds;
  }

  private transitionToWorksiteObservance(agent: VillagerAgent): boolean {
    this.clearPath(agent);
    agent.routinePhase = 'observance_at_worksite';
    agent.idleRemaining = Number.POSITIVE_INFINITY;
    agent.idleDirty = false;
    return true;
  }

  private findMassChapel(agent: VillagerAgent): BuildingState | null {
    const clericWorkplace = this.clericWorkplaceFor(agent);
    if (
      clericWorkplace?.kind === 'chapel'
      && this.massChapels.some((chapel) => chapel.id === clericWorkplace.id)
    ) {
      return clericWorkplace;
    }
    if (agent.residenceId) {
      if (this.fireDisabledResidenceIds.has(agent.residenceId)) return null;
      return this.massChapelClaims.get(agent.residenceId)?.chapel ?? null;
    }
    const origin = this.foundingCamp ?? agent;
    return claimMassChapelFromPoint(
      origin,
      this.massChapels,
      this.roadNetwork,
    )?.chapel ?? null;
  }

  private beginMassJourney(agent: VillagerAgent, chapel: BuildingState): boolean {
    const isPriest = this.isPriestAgent(agent);
    const destination = isPriest
      ? chapelClergyGatheringPoint(chapel)
      : chapelGatheringPoint(chapel, agent.personIdentity);
    const distance = Math.hypot(destination.x - agent.x, destination.z - agent.z);
    agent.massChapelId = chapel.id;
    if (distance < 0.25) {
      this.completeMassArrival(agent);
      return true;
    }
    const path = isPriest
      ? pickWorkerTravelPath(
          { x: agent.x, z: agent.z },
          destination,
          this.roadNetwork,
        )
      : chapelAttendancePath(
          { x: agent.x, z: agent.z },
          chapel,
          agent.personIdentity,
          this.roadNetwork,
        );
    if (!path || !this.beginJourney(agent, path, 'chapel_mass')) {
      agent.massChapelId = null;
      return false;
    }
    agent.routinePhase = 'going_to_mass';
    return true;
  }

  private completeMassArrival(agent: VillagerAgent): void {
    this.clearPath(agent);
    const chapel = agent.massChapelId
      ? this.buildings.get(agent.massChapelId) ?? null
      : null;
    if (!chapel) {
      agent.massChapelId = null;
      return;
    }
    const gathering = this.isPriestAgent(agent)
      ? chapelClergyGatheringPoint(chapel)
      : chapelGatheringPoint(chapel, agent.personIdentity);
    agent.x = gathering.x;
    agent.z = gathering.z;
    agent.y = this.resolveGroundY(agent.x, agent.z) + 0.02;
    agent.yaw = Math.atan2(chapel.x - agent.x, chapel.z - agent.z);
    agent.routinePhase = 'at_mass';
    agent.idleRemaining = 60;
    this.syncChapelAmbientAssignments();
    this.applyAmbientAssignment(agent);
  }

  private beginMassReturn(agent: VillagerAgent): boolean {
    this.chapelAmbientAssignments.delete(agent.id);
    agent.ambientBehavior = null;
    const chapel = agent.massChapelId
      ? this.buildings.get(agent.massChapelId) ?? null
      : null;
    if (chapel && this.isPriestAgent(agent)) {
      this.clearPath(agent);
      agent.massChapelId = null;
      agent.x = chapel.x;
      agent.z = chapel.z;
      agent.y = this.resolveGroundY(agent.x, agent.z) + 0.02;
      agent.yaw = resolvedPlacedBuildingYaw(chapel);
      agent.routinePhase = 'observance_at_worksite';
      agent.mode = clericMassAnimation('service', agent.pathSeed) as VillagerMode;
      agent.idleRemaining = Number.POSITIVE_INFINITY;
      this.syncChapelAmbientAssignments();
      return true;
    }
    const residence = agent.residenceId ? this.residences.get(agent.residenceId) : null;
    const destination = residence
      ? residenceDoorPosition(residence)
      : this.foundingCamp
        ? this.foundingCampRestPosition(agent, this.foundingCamp)
        : null;
    if (!destination) {
      this.completeMassReturn(agent);
      return true;
    }
    const path = pickWorkerTravelPath(
      { x: agent.x, z: agent.z },
      destination,
      this.roadNetwork,
    );
    if (!path || !this.beginJourney(agent, path, 'return_from_mass')) {
      this.completeMassReturn(agent);
      return true;
    }
    agent.routinePhase = 'returning_from_mass';
    this.syncChapelAmbientAssignments();
    return true;
  }

  private completeMassReturn(agent: VillagerAgent): void {
    this.clearPath(agent);
    agent.massChapelId = null;
    const homeState = this.householdHomeStateFor(agent);
    agent.routinePhase = 'returning_from_mass';
    this.transitionToHomeState(agent, homeState);
    this.reconcileRoutine(agent);
    this.syncCampAmbientAssignments();
    this.syncChapelAmbientAssignments();
  }

  private findFeastMonastery(agent: VillagerAgent): BuildingState | null {
    if (
      !agent.residenceId
      || this.fireDisabledResidenceIds.has(agent.residenceId)
    ) {
      return null;
    }
    return this.feastMonasteryClaims.get(agent.residenceId)?.monastery ?? null;
  }

  private beginFeastJourney(
    agent: VillagerAgent,
    monastery: BuildingState,
  ): boolean {
    const destination = monasteryFeastGatheringPoint(
      monastery,
      agent.personIdentity,
    );
    const distance = Math.hypot(destination.x - agent.x, destination.z - agent.z);
    agent.massChapelId = monastery.id;
    if (distance < 0.25) {
      this.completeFeastArrival(agent);
      return true;
    }
    const path = monasteryFeastAttendancePath(
      { x: agent.x, z: agent.z },
      monastery,
      agent.personIdentity,
      this.roadNetwork,
    );
    if (!path || !this.beginJourney(agent, path, 'monastery_feast')) {
      agent.massChapelId = null;
      return false;
    }
    agent.routinePhase = 'going_to_feast';
    return true;
  }

  private completeFeastArrival(agent: VillagerAgent): void {
    this.clearPath(agent);
    const monastery = agent.massChapelId
      ? this.buildings.get(agent.massChapelId) ?? null
      : null;
    if (monastery?.kind !== 'monastery') {
      agent.massChapelId = null;
      return;
    }
    const gathering = monasteryFeastGatheringPoint(
      monastery,
      agent.personIdentity,
    );
    agent.x = gathering.x;
    agent.z = gathering.z;
    agent.y = this.resolveGroundY(agent.x, agent.z) + 0.02;
    agent.yaw = Math.atan2(monastery.x - agent.x, monastery.z - agent.z);
    agent.routinePhase = 'at_feast';
    agent.idleRemaining = 60;
  }

  private beginFeastReturn(agent: VillagerAgent): boolean {
    agent.ambientBehavior = null;
    const residence = agent.residenceId
      ? this.residences.get(agent.residenceId) ?? null
      : null;
    const destination = residence ? residenceDoorPosition(residence) : null;
    if (!destination) {
      this.completeFeastReturn(agent);
      return true;
    }
    const path = pickWorkerTravelPath(
      { x: agent.x, z: agent.z },
      destination,
      this.roadNetwork,
    );
    if (!path || !this.beginJourney(agent, path, 'return_from_feast')) {
      this.completeFeastReturn(agent);
      return true;
    }
    agent.routinePhase = 'returning_from_feast';
    return true;
  }

  private completeFeastReturn(agent: VillagerAgent): void {
    this.clearPath(agent);
    agent.massChapelId = null;
    const homeState = this.householdHomeStateFor(agent);
    agent.routinePhase = 'returning_from_feast';
    this.transitionToHomeState(agent, homeState);
    this.reconcileRoutine(agent);
    this.syncCampAmbientAssignments();
  }

  private refreshWaysideShrineVisitorRoster(): void {
    this.waysideShrineVisitorSlots.clear();
    this.graveyardVisitorSlots.clear();
    if (
      !this.clock
      || this.frontierAlertActive
      || (
        this.waysideShrines.length === 0
        && this.sabbathGraveyardsByChapel.size === 0
      )
    ) {
      return;
    }

    const candidatesByShrine = new Map<
      string,
      Array<{ agent: VillagerAgent; priority: number }>
    >();
    const candidatesByGraveyard = new Map<
      string,
      Array<{ agent: VillagerAgent; priority: number }>
    >();
    const visitKey = this.currentDevotionalVisitKey();
    for (const agent of this.agents.values()) {
      const workplace = agent.role === 'worker' && agent.workplaceId
        ? this.buildings.get(agent.workplaceId) ?? null
        : null;
      const sabbathVisitTime = this.holidayObservance === null
        && isSabbathDevotionTime(
          this.clock,
          this.sabbathPausedToday,
          agent.personIdentity,
        );
      const holidayShrineTime = this.holidayObservance !== null
        && isWaysideShrinePrayerTime(
          this.clock,
          this.sabbathPausedToday,
          this.holidayObservance,
          agent.personIdentity,
        );
      if (
        agent.isSick
        || (visitKey !== '' && agent.lastDevotionalVisitKey === visitKey)
        || (agent.role === 'worker' && this.shouldWorkerReportToWork(workplace))
        || (!sabbathVisitTime && !holidayShrineTime)
      ) {
        continue;
      }

      const chapel = this.findMassChapel(agent);
      const attendingChurch = Boolean(
        chapel
        && (
          isSundayMassTime(this.clock, this.sabbathPausedToday)
          || (
            this.holidayObservance
            && holidayChapelActivityFor(
              this.clock,
              this.holidayObservance,
              agent.personIdentity,
            )
          )
        )
      );
      if (attendingChurch) continue;

      const feastMonastery = this.findFeastMonastery(agent);
      if (isMonasteryFeastGatheringTime(
        this.clock,
        this.monasteryFeastsEnabled && !this.frontierAlertActive,
        feastMonastery != null,
      )) {
        continue;
      }

      const shrine = this.findWaysideShrine(agent);
      const graveyard = sabbathVisitTime
        ? this.findSabbathGraveyard(agent)
        : null;
      const preference = sabbathVisitTime
        ? sabbathDevotionPreference(
            this.clock.totalDays,
            agent.personIdentity,
          )
        : 'shrine';
      if (graveyard && (!shrine || preference === 'graveyard')) {
        const candidates = candidatesByGraveyard.get(graveyard.id) ?? [];
        candidates.push({
          agent,
          priority: waysideShrineVisitorPriority(
            this.clock,
            null,
            agent.personIdentity,
          ),
        });
        candidatesByGraveyard.set(graveyard.id, candidates);
        continue;
      }
      if (!shrine) continue;
      const candidates = candidatesByShrine.get(shrine.id) ?? [];
      candidates.push({
        agent,
        priority: waysideShrineVisitorPriority(
          this.clock,
          this.holidayObservance,
          agent.personIdentity,
        ),
      });
      candidatesByShrine.set(shrine.id, candidates);
    }

    for (const candidates of candidatesByShrine.values()) {
      candidates.sort((left, right) =>
        left.priority - right.priority
        || left.agent.personIdentity.localeCompare(right.agent.personIdentity)
      );
      for (
        let slot = 0;
        slot < Math.min(MAX_WAYSIDE_SHRINE_VISITORS, candidates.length);
        slot += 1
      ) {
        this.waysideShrineVisitorSlots.set(candidates[slot]!.agent.id, slot);
      }
    }
    for (const [graveyardId, candidates] of candidatesByGraveyard) {
      candidates.sort((left, right) =>
        left.priority - right.priority
        || left.agent.personIdentity.localeCompare(right.agent.personIdentity)
      );
      for (
        let slot = 0;
        slot < Math.min(MAX_GRAVEYARD_VISITORS, candidates.length);
        slot += 1
      ) {
        this.graveyardVisitorSlots.set(candidates[slot]!.agent.id, {
          graveyardId,
          slot,
        });
      }
    }
  }

  private currentDevotionalVisitKey(): string {
    if (!this.clock) return '';
    if (this.holidayObservance) {
      return `holiday:${this.holidayObservance.historicalYear}:${this.holidayObservance.id}`;
    }
    return this.clock.isSunday && this.sabbathPausedToday
      ? sabbathDevotionObservanceKey(this.clock)
      : '';
  }

  private findWaysideShrine(agent: VillagerAgent): BuildingState | null {
    if (agent.residenceId) {
      if (this.fireDisabledResidenceIds.has(agent.residenceId)) return null;
      return this.waysideShrineClaims.get(agent.residenceId)?.shrine ?? null;
    }
    const origin = this.foundingCamp ?? agent;
    return claimWaysideShrineFromPoint(
      origin,
      this.waysideShrines,
      this.roadNetwork,
    )?.shrine ?? null;
  }

  private findSabbathGraveyard(agent: VillagerAgent): GraveyardState | null {
    if (!this.clock) return null;
    const chapel = this.findMassChapel(agent);
    if (!chapel) return null;
    return pickSabbathGraveyard(
      this.sabbathGraveyardsByChapel.get(chapel.id) ?? [],
      this.clock.totalDays,
      agent.personIdentity,
    );
  }

  private beginWaysideShrineJourney(
    agent: VillagerAgent,
    shrine: BuildingState,
    visitorSlot: number,
  ): boolean {
    this.chapelAmbientAssignments.delete(agent.id);
    agent.massChapelId = null;
    agent.devotionalGraveyardId = null;
    agent.devotionalGraveyardSlot = -1;
    const destination = waysideShrinePrayerPoint(
      shrine,
      visitorSlot,
      this.roadNetwork,
    );
    const distance = Math.hypot(destination.x - agent.x, destination.z - agent.z);
    agent.devotionalShrineId = shrine.id;
    agent.devotionalShrineSlot = visitorSlot;
    if (distance < 0.25) {
      this.completeWaysideShrineArrival(agent);
      return true;
    }
    const path = waysideShrinePrayerPath(
      { x: agent.x, z: agent.z },
      shrine,
      visitorSlot,
      this.roadNetwork,
    );
    if (!path || !this.beginJourney(agent, path, 'wayside_shrine_prayer')) {
      agent.devotionalShrineId = null;
      agent.devotionalShrineSlot = -1;
      return false;
    }
    agent.routinePhase = 'going_to_shrine';
    return true;
  }

  private completeWaysideShrineArrival(agent: VillagerAgent): void {
    this.clearPath(agent);
    const shrine = agent.devotionalShrineId
      ? this.buildings.get(agent.devotionalShrineId) ?? null
      : null;
    if (
      shrine?.kind !== 'wayside_shrine'
      || shrine.constructionComplete === false
      || this.fireDisabledBuildingIds.has(shrine.id)
    ) {
      agent.devotionalShrineId = null;
      agent.devotionalShrineSlot = -1;
      return;
    }
    const prayerPoint = waysideShrinePrayerPoint(
      shrine,
      agent.devotionalShrineSlot,
      this.roadNetwork,
    );
    agent.x = prayerPoint.x;
    agent.z = prayerPoint.z;
    agent.y = this.resolveGroundY(agent.x, agent.z) + 0.02;
    agent.yaw = prayerPoint.yaw;
    agent.routinePhase = 'praying_at_shrine';
    agent.mode = 'pray';
    agent.currentMoveSpeed = 0;
    agent.idleRemaining = DEVOTIONAL_PRAYER_SECONDS;
    agent.lastDevotionalVisitKey = this.currentDevotionalVisitKey();
  }

  private beginWaysideShrineReturn(agent: VillagerAgent): boolean {
    const residence = agent.residenceId
      ? this.residences.get(agent.residenceId) ?? null
      : null;
    const destination = residence
      ? residenceDoorPosition(residence)
      : this.foundingCamp
        ? this.foundingCampRestPosition(agent, this.foundingCamp)
        : null;
    if (!destination) {
      this.completeWaysideShrineReturn(agent);
      return true;
    }
    const path = pickWorkerTravelPath(
      { x: agent.x, z: agent.z },
      destination,
      this.roadNetwork,
    );
    if (!path || !this.beginJourney(agent, path, 'return_from_shrine')) {
      this.completeWaysideShrineReturn(agent);
      return true;
    }
    agent.routinePhase = 'returning_from_shrine';
    return true;
  }

  private completeWaysideShrineReturn(agent: VillagerAgent): void {
    this.clearPath(agent);
    agent.devotionalShrineId = null;
    agent.devotionalShrineSlot = -1;
    const homeState = this.householdHomeStateFor(agent);
    agent.routinePhase = 'returning_from_shrine';
    this.transitionToHomeState(agent, homeState);
    this.reconcileRoutine(agent);
    this.syncCampAmbientAssignments();
  }

  private beginGraveyardJourney(
    agent: VillagerAgent,
    graveyard: GraveyardState,
    visitorSlot: number,
  ): boolean {
    this.chapelAmbientAssignments.delete(agent.id);
    agent.massChapelId = null;
    agent.devotionalShrineId = null;
    agent.devotionalShrineSlot = -1;
    const destination = graveyardPrayerPoint(graveyard, visitorSlot);
    const distance = Math.hypot(destination.x - agent.x, destination.z - agent.z);
    agent.devotionalGraveyardId = graveyard.id;
    agent.devotionalGraveyardSlot = visitorSlot;
    if (distance < 0.25) {
      this.completeGraveyardArrival(agent);
      return true;
    }
    const path = graveyardDevotionPath(
      { x: agent.x, z: agent.z },
      graveyard,
      visitorSlot,
      this.roadNetwork,
    );
    if (!this.beginJourney(agent, path, 'graveyard_prayer')) {
      agent.devotionalGraveyardId = null;
      agent.devotionalGraveyardSlot = -1;
      return false;
    }
    agent.routinePhase = 'going_to_graveyard';
    return true;
  }

  private completeGraveyardArrival(agent: VillagerAgent): void {
    this.clearPath(agent);
    const graveyard = agent.devotionalGraveyardId
      ? this.graveyards.get(agent.devotionalGraveyardId) ?? null
      : null;
    if (!graveyard) {
      agent.devotionalGraveyardId = null;
      agent.devotionalGraveyardSlot = -1;
      return;
    }
    const prayerPoint = graveyardPrayerPoint(
      graveyard,
      agent.devotionalGraveyardSlot,
    );
    agent.x = prayerPoint.x;
    agent.z = prayerPoint.z;
    agent.y = this.resolveGroundY(agent.x, agent.z) + 0.02;
    agent.yaw = prayerPoint.yaw;
    agent.routinePhase = 'praying_at_graveyard';
    agent.mode = 'pray';
    agent.currentMoveSpeed = 0;
    agent.idleRemaining = DEVOTIONAL_PRAYER_SECONDS;
    agent.lastDevotionalVisitKey = this.currentDevotionalVisitKey();
  }

  private beginGraveyardReturn(agent: VillagerAgent): boolean {
    const residence = agent.residenceId
      ? this.residences.get(agent.residenceId) ?? null
      : null;
    const destination = residence
      ? residenceDoorPosition(residence)
      : this.foundingCamp
        ? this.foundingCampRestPosition(agent, this.foundingCamp)
        : null;
    if (!destination) {
      this.completeGraveyardReturn(agent);
      return true;
    }
    const path = pickWorkerTravelPath(
      { x: agent.x, z: agent.z },
      destination,
      this.roadNetwork,
    );
    if (!path || !this.beginJourney(agent, path, 'return_from_graveyard')) {
      this.completeGraveyardReturn(agent);
      return true;
    }
    agent.routinePhase = 'returning_from_graveyard';
    return true;
  }

  private completeGraveyardReturn(agent: VillagerAgent): void {
    this.clearPath(agent);
    agent.devotionalGraveyardId = null;
    agent.devotionalGraveyardSlot = -1;
    const homeState = this.householdHomeStateFor(agent);
    agent.routinePhase = 'returning_from_graveyard';
    this.transitionToHomeState(agent, homeState);
    this.reconcileRoutine(agent);
    this.syncCampAmbientAssignments();
  }

  private beginGuardMuster(
    agent: VillagerAgent,
    tower: BuildingState,
  ): boolean {
    const destination = watchtowerMusterPosition(
      tower,
      Math.max(0, agent.musterSlot),
    );
    const path = pickWorkerTravelPath(
      { x: agent.x, z: agent.z },
      destination,
      this.roadNetwork,
    ) ?? [{ x: agent.x, z: agent.z }, destination];
    this.chapelAmbientAssignments.delete(agent.id);
    agent.massChapelId = null;
    agent.musterTowerId = tower.id;
    if (!this.beginJourney(agent, path, 'guard_muster')) {
      this.completeGuardMuster(agent);
      return true;
    }
    agent.routinePhase = 'going_to_muster';
    this.syncChapelAmbientAssignments();
    return true;
  }

  private completeGuardMuster(agent: VillagerAgent): void {
    this.clearPath(agent);
    const tower = agent.musterTowerId
      ? this.buildings.get(agent.musterTowerId) ?? null
      : null;
    const assignedTower = this.assignedGuardMusterTower(agent);
    if (
      !tower
      || tower.kind !== 'watchtower'
      || assignedTower?.id !== tower.id
    ) {
      this.beginGuardMusterReturn(agent);
      return;
    }
    const destination = watchtowerMusterPosition(
      tower,
      Math.max(0, agent.musterSlot),
    );
    agent.x = destination.x;
    agent.z = destination.z;
    agent.y = this.resolveGroundY(agent.x, agent.z) + 0.02;
    agent.yaw = destination.yaw;
    agent.routinePhase = 'at_muster';
    agent.idleRemaining = 60;
    agent.idleDirty = false;
  }

  private beginGuardMusterReturn(agent: VillagerAgent): boolean {
    const workplace = agent.workplaceId
      ? this.buildings.get(agent.workplaceId) ?? null
      : null;
    const residence = agent.residenceId
      ? this.residences.get(agent.residenceId) ?? null
      : null;
    const workplaceAvailable = workplace
      && !this.fireDisabledBuildingIds.has(workplace.id);
    const destination = workplaceAvailable
      ? this.workerDutyPosition(workplace, agent.workplaceSlot)
      : residence
        ? residenceDoorPosition(residence)
        : this.foundingCamp
          ? this.foundingCampRestPosition(agent, this.foundingCamp)
          : null;
    if (!destination) {
      this.completeGuardMusterReturn(agent);
      return true;
    }
    const path = pickWorkerTravelPath(
      { x: agent.x, z: agent.z },
      destination,
      this.roadNetwork,
    ) ?? [{ x: agent.x, z: agent.z }, destination];
    if (!this.beginJourney(agent, path, 'return_from_muster')) {
      this.completeGuardMusterReturn(agent);
      return true;
    }
    agent.routinePhase = 'returning_from_muster';
    return true;
  }

  private completeGuardMusterReturn(agent: VillagerAgent): void {
    this.clearPath(agent);
    agent.musterTowerId = null;
    agent.musterSlot = -1;
    const workplace = agent.workplaceId
      ? this.buildings.get(agent.workplaceId) ?? null
      : null;
    if (workplace && !this.fireDisabledBuildingIds.has(workplace.id)) {
      this.completeWorkerReturnToWork(agent);
      this.reconcileRoutine(agent);
      return;
    }
    agent.routinePhase = 'home_outdoors';
    const residence = agent.residenceId
      ? this.residences.get(agent.residenceId) ?? null
      : null;
    if (residence) this.placeIdle(agent, residence);
    this.reconcileRoutine(agent);
  }

  private beginRefugeJourney(
    agent: VillagerAgent,
    refuge: BuildingState,
  ): boolean {
    const destination = palisadedRefugeRallyPosition(
      refuge,
      Math.max(0, agent.refugeSlot),
    );
    const outside = palisadedRefugeGateOutside(refuge);
    const inside = palisadedRefugeGateInside(refuge);
    const previousRefuge = agent.refugeId && agent.refugeId !== refuge.id
      ? this.buildings.get(agent.refugeId) ?? null
      : null;
    const departure = previousRefuge?.kind === 'palisaded_refuge'
      && agent.routinePhase === 'at_refuge'
      ? [
          { x: agent.x, z: agent.z },
          palisadedRefugeGateInside(previousRefuge),
          palisadedRefugeGateOutside(previousRefuge),
        ]
      : [{ x: agent.x, z: agent.z }];
    const departureOutside = departure[departure.length - 1]!;
    const approach = pickWorkerTravelPath(
      departureOutside,
      outside,
      this.roadNetwork,
    ) ?? [departureOutside, outside];
    const routedApproach = this.routePath(approach) ?? approach;
    const path = joinPolylines(
      joinPolylines(departure, routedApproach),
      [outside, inside, destination],
    );

    this.chapelAmbientAssignments.delete(agent.id);
    agent.massChapelId = null;
    agent.refugeId = refuge.id;
    if (!this.beginPreparedJourney(agent, path, 'refuge_rally')) {
      this.completeRefugeArrival(agent);
      return true;
    }
    agent.routinePhase = 'going_to_refuge';
    this.syncChapelAmbientAssignments();
    return true;
  }

  private completeRefugeArrival(agent: VillagerAgent): void {
    this.clearPath(agent);
    const refuge = agent.refugeId
      ? this.buildings.get(agent.refugeId) ?? null
      : null;
    if (!refuge || refuge.kind !== 'palisaded_refuge') {
      agent.routinePhase = 'home_outdoors';
      return;
    }
    const destination = palisadedRefugeRallyPosition(
      refuge,
      Math.max(0, agent.refugeSlot),
    );
    agent.x = destination.x;
    agent.z = destination.z;
    agent.y = this.resolveGroundY(agent.x, agent.z) + 0.02;
    agent.yaw = destination.yaw;
    agent.routinePhase = 'at_refuge';
    agent.idleRemaining = 60;
    agent.idleDirty = false;
  }

  private beginRefugeReturn(agent: VillagerAgent): boolean {
    const residence = agent.residenceId
      ? this.residences.get(agent.residenceId) ?? null
      : null;
    const destination = residence
      ? this.fireDisabledResidenceIds.has(residence.id)
        ? this.fireAssemblyPosition(agent, residence)
        : residenceDoorPosition(residence)
      : this.foundingCamp
        ? this.foundingCampRestPosition(agent, this.foundingCamp)
        : null;
    if (!destination) {
      this.completeRefugeReturn(agent);
      return true;
    }

    const currentRefuge = agent.refugeId
      ? this.buildings.get(agent.refugeId) ?? null
      : null;
    const egress = currentRefuge?.kind === 'palisaded_refuge'
      && agent.routinePhase === 'at_refuge'
      ? [
          { x: agent.x, z: agent.z },
          palisadedRefugeGateInside(currentRefuge),
          palisadedRefugeGateOutside(currentRefuge),
        ]
      : [{ x: agent.x, z: agent.z }];
    const outside = egress[egress.length - 1]!;
    const returnPath = pickWorkerTravelPath(
      outside,
      destination,
      this.roadNetwork,
    ) ?? [outside, destination];
    const routedReturn = this.routePath(returnPath) ?? returnPath;
    const path = joinPolylines(egress, routedReturn);
    if (!this.beginPreparedJourney(agent, path, 'return_from_refuge')) {
      this.completeRefugeReturn(agent);
      return true;
    }
    agent.routinePhase = 'returning_from_refuge';
    return true;
  }

  private completeRefugeReturn(agent: VillagerAgent): void {
    this.clearPath(agent);
    agent.refugeId = null;
    agent.refugeSlot = -1;
    const residence = agent.residenceId
      ? this.residences.get(agent.residenceId) ?? null
      : null;
    if (residence && this.fireDisabledResidenceIds.has(residence.id)) {
      this.completeFireAssemblyArrival(agent);
      return;
    }
    if (residence) this.placeIdle(agent, residence);
    else if (this.foundingCamp) this.placeFounderIdle(agent, this.foundingCamp);
    agent.routinePhase = 'home_outdoors';
    agent.idleRemaining = 1;
    this.reconcileRoutine(agent);
  }

  private fireAssemblyPosition(
    agent: VillagerAgent,
    residence: ResidenceState,
  ): PointXZ & { yaw: number } {
    const door = residenceDoorPosition(residence);
    const frontX = Math.sin(residence.yaw);
    const frontZ = Math.cos(residence.yaw);
    const sideX = Math.cos(residence.yaw);
    const sideZ = -Math.sin(residence.yaw);
    const lateralOffset = agent.idleOffset.x * 1.35;
    const x = door.x + frontX * 4.8 + sideX * lateralOffset;
    const z = door.z + frontZ * 4.8 + sideZ * lateralOffset;
    return {
      x,
      z,
      yaw: Math.atan2(residence.x - x, residence.z - z),
    };
  }

  private beginFireAssemblyJourney(
    agent: VillagerAgent,
    residence: ResidenceState,
  ): boolean {
    const destination = this.fireAssemblyPosition(agent, residence);
    const path = [
      { x: agent.x, z: agent.z },
      { x: destination.x, z: destination.z },
    ];
    this.chapelAmbientAssignments.delete(agent.id);
    agent.massChapelId = null;
    const routedPath = this.routePath(path) ?? path;
    if (!this.beginPreparedJourney(agent, routedPath, 'fire_assembly')) {
      this.completeFireAssemblyArrival(agent);
      return true;
    }
    agent.routinePhase = 'going_to_fire_assembly';
    this.syncChapelAmbientAssignments();
    return true;
  }

  private completeFireAssemblyArrival(agent: VillagerAgent): void {
    this.clearPath(agent);
    const residence = agent.residenceId
      ? this.residences.get(agent.residenceId) ?? null
      : null;
    if (!residence || !this.fireDisabledResidenceIds.has(residence.id)) {
      agent.routinePhase = 'home_outdoors';
      this.reconcileRoutine(agent);
      return;
    }
    const destination = this.fireAssemblyPosition(agent, residence);
    agent.x = destination.x;
    agent.z = destination.z;
    agent.y = this.resolveGroundY(agent.x, agent.z) + 0.02;
    agent.yaw = destination.yaw;
    agent.routinePhase = 'at_fire_assembly';
    agent.idleRemaining = 60;
    agent.idleDirty = false;
  }

  private beginFireAssemblyReturn(agent: VillagerAgent): boolean {
    const residence = agent.residenceId
      ? this.residences.get(agent.residenceId) ?? null
      : null;
    if (!residence) {
      this.completeFireAssemblyReturn(agent);
      return true;
    }
    const destination = residenceDoorPosition(residence);
    const path = [
      { x: agent.x, z: agent.z },
      destination,
    ];
    const routedPath = this.routePath(path) ?? path;
    if (!this.beginPreparedJourney(agent, routedPath, 'return_from_fire_assembly')) {
      this.completeFireAssemblyReturn(agent);
      return true;
    }
    agent.routinePhase = 'returning_from_fire_assembly';
    return true;
  }

  private completeFireAssemblyReturn(agent: VillagerAgent): void {
    this.clearPath(agent);
    const residence = agent.residenceId
      ? this.residences.get(agent.residenceId) ?? null
      : null;
    if (residence && this.fireDisabledResidenceIds.has(residence.id)) {
      this.completeFireAssemblyArrival(agent);
      return;
    }
    if (residence) this.placeIdle(agent, residence);
    agent.routinePhase = this.householdHomeStateFor(agent);
    agent.idleRemaining = pickIdleDuration(agent.pathSeed) * 0.7;
    this.reconcileRoutine(agent);
  }

  private beginWorkerReturnHome(agent: VillagerAgent): boolean {
    const destination = this.workerPermanentHomeDestination(agent);
    if (!destination) {
      this.clearPath(agent);
      agent.routinePhase = 'indoors';
      return true;
    }

    const duty = this.marketStallDutyForAgent(agent);
    if (duty) {
      const roadDeparture = pickWorkerTravelPath(
        duty.approachOutside,
        destination,
        this.roadNetwork,
      ) ?? [duty.approachOutside, destination];
      const routedDeparture = this.routePath(roadDeparture);
      if (!routedDeparture) return false;
      const path = joinPolylines(
        [
          { x: agent.x, z: agent.z },
          duty.approachInside,
          duty.approachOutside,
        ],
        routedDeparture,
      );
      if (!this.beginPreparedJourney(agent, path, 'return_home')) {
        this.completeWorkerReturnHome(agent);
        return true;
      }
      agent.routinePhase = 'returning_home';
      return true;
    }

    const path = pickWorkerTravelPath(
      { x: agent.x, z: agent.z },
      destination,
      this.roadNetwork,
    );
    if (!path) {
      this.completeWorkerReturnHome(agent);
      return true;
    }
    if (!this.beginJourney(agent, path, 'return_home')) return false;
    agent.routinePhase = 'returning_home';
    return true;
  }

  private completeWorkerReturnHome(agent: VillagerAgent): void {
    this.clearPath(agent);
    const homeState = this.householdHomeStateFor(agent);
    const residence = agent.residenceId ? this.residences.get(agent.residenceId) : null;
    if (residence) this.placeIdle(agent, residence);
    else if (this.foundingCamp) this.placeFounderIdle(agent, this.foundingCamp);
    agent.routinePhase = homeState;
    agent.idleRemaining = pickIdleDuration(agent.pathSeed) * 0.7;
    this.reconcileRoutine(agent);
  }

  private beginWorkerReturnToWork(
    agent: VillagerAgent,
    forObservance = false,
  ): boolean {
    const building = agent.workplaceId ? this.buildings.get(agent.workplaceId) : null;
    if (!building || this.fireDisabledBuildingIds.has(building.id)) return false;
    const purpose = forObservance
      ? 'return_for_observance'
      : 'return_to_work';
    const phase = forObservance
      ? 'returning_for_observance'
      : 'returning_to_work';

    const duty = this.marketStallDutyForAgent(agent);
    if (duty) {
      const start = { x: agent.x, z: agent.z };
      const roadApproach = pickWorkerTravelPath(
        start,
        duty.approachOutside,
        this.roadNetwork,
      ) ?? [start, duty.approachOutside];
      const routedApproach = this.routePath(roadApproach);
      if (!routedApproach) return false;
      const path = joinPolylines(
        joinPolylines(routedApproach, [duty.approachOutside, duty.approachInside]),
        [duty.approachInside, { x: duty.x, z: duty.z }],
      );
      if (!this.beginPreparedJourney(agent, path, purpose)) {
        if (forObservance) this.completeWorkerObservanceReturn(agent);
        else this.completeWorkerReturnToWork(agent);
        return true;
      }
      agent.routinePhase = phase;
      return true;
    }

    const destination = this.workerDutyPosition(building, agent.workplaceSlot);
    const path = pickWorkerTravelPath(
      { x: agent.x, z: agent.z },
      destination,
      this.roadNetwork,
    );
    if (!path) {
      if (forObservance) this.completeWorkerObservanceReturn(agent);
      else this.completeWorkerReturnToWork(agent);
      return true;
    }
    if (!this.beginJourney(agent, path, purpose)) return false;
    agent.routinePhase = phase;
    return true;
  }

  private completeWorkerReturnToWork(agent: VillagerAgent): void {
    this.clearPath(agent);
    const building = agent.workplaceId ? this.buildings.get(agent.workplaceId) : null;
    if (!building || this.fireDisabledBuildingIds.has(building.id)) {
      agent.routinePhase = 'home_outdoors';
      this.beginWorkerReturnHome(agent);
      return;
    }
    agent.routinePhase = 'work';
    this.placeWorkerIdle(agent, building);
    agent.idleRemaining = pickIdleDuration(agent.pathSeed) * 0.45;
  }

  private completeWorkerObservanceReturn(agent: VillagerAgent): void {
    const workplace = agent.workplaceId
      ? this.buildings.get(agent.workplaceId) ?? null
      : null;
    if (this.shouldWorkerReportToWork(workplace)) {
      this.completeWorkerReturnToWork(agent);
      return;
    }
    this.transitionToWorksiteObservance(agent);
  }

  private buildMarketplaceStallDuties(
    buildings: readonly BuildingState[],
    disabledBuildingIds: ReadonlySet<string>,
  ): Map<string, MarketStallDuty> {
    const duties = new Map<string, MarketStallDuty>();
    if (!this.roadNetwork) return duties;
    const roster = assignMarketplaceStallRoster(
      buildings,
      (ax, az, bx, bz) =>
        this.roadNetwork?.getPathfinder().roadPathDistance(ax, az, bx, bz) ?? null,
      disabledBuildingIds,
    );
    for (const assignment of indexMarketplaceStallWorkers(roster)) {
      const marketplace = this.buildings.get(assignment.marketplaceId);
      if (!marketplace) continue;
      const buildingYaw = resolvedPlacedBuildingYaw(marketplace, this.roadNetwork);
      const position = marketplaceStallWorkerPosition(
        marketplace,
        buildingYaw,
        assignment.group,
        assignment.marketplaceSlotIndex,
      );
      const approach = marketplaceStallWorkerApproach(
        marketplace,
        buildingYaw,
        assignment.group,
        assignment.marketplaceSlotIndex,
      );
      if (!position || !approach) continue;
      duties.set(
        workerSlotKey(assignment.workplaceId, assignment.workplaceSlotIndex),
        {
          ...position,
          marketplaceId: assignment.marketplaceId,
          needKind: assignment.needKind,
          approachOutside: approach.outside,
          approachInside: approach.inside,
        },
      );
    }
    return duties;
  }

  private marketStallDutyForAgent(agent: VillagerAgent): MarketStallDuty | null {
    if (!agent.workplaceId || agent.workplaceSlot < 0) return null;
    return this.marketStallDutyByWorker.get(
      workerSlotKey(agent.workplaceId, agent.workplaceSlot),
    ) ?? null;
  }

  private workerDutyPosition(
    workplace: BuildingState,
    workplaceSlot: number,
  ): PointXZ & { yaw: number } {
    return this.marketStallDutyByWorker.get(
      workerSlotKey(workplace.id, workplaceSlot),
    ) ?? workplaceYardPosition(
      workplace,
      workplaceSlot,
      this.roadNetwork,
      this.isWaterAt,
    );
  }

  private workerPermanentHomeDestination(
    agent: VillagerAgent,
  ): (PointXZ & { yaw?: number }) | null {
    const residence = agent.residenceId
      ? this.residences.get(agent.residenceId) ?? null
      : null;
    if (residence) return residenceDoorPosition(residence);
    return this.foundingCamp
      ? this.foundingCampRestPosition(agent, this.foundingCamp)
      : null;
  }

  private transitionToHomeState(
    agent: VillagerAgent,
    homeState: HouseholdHomeState,
  ): boolean {
    const residence = agent.residenceId ? this.residences.get(agent.residenceId) : null;
    const backyard = residence
      && homeState === 'home_outdoors'
      && this.holidayObservance
      ? holidayBackyardPosition(residence, agent.personIdentity)
      : null;
    if (
      agent.routinePhase === homeState
      && !backyard
    ) return false;
    if (
      agent.routinePhase === homeState
      && backyard
      && agent.pathPurpose === null
      && Math.hypot(agent.x - backyard.x, agent.z - backyard.z) < 0.1
    ) return false;
    this.clearPath(agent);
    agent.routinePhase = homeState;
    if (residence && backyard) {
      this.placeHomeIdle(agent, residence);
    } else if (residence) this.placeIdle(agent, residence);
    else if (this.foundingCamp) this.placeFounderIdle(agent, this.foundingCamp);
    agent.idleRemaining = pickIdleDuration(agent.pathSeed) * 0.7;
    return true;
  }

  private beginJourney(
    agent: VillagerAgent,
    path: PointXZ[],
    purpose: Exclude<
      VillagerPathPurpose,
      'home_wander' | 'worker_work_loop' | 'ambient' | null
    >,
  ): boolean {
    const routedPath = this.routePath(path);
    return routedPath
      ? this.beginPreparedJourney(agent, routedPath, purpose)
      : false;
  }

  private beginPreparedJourney(
    agent: VillagerAgent,
    path: PointXZ[],
    purpose: Exclude<
      VillagerPathPurpose,
      'home_wander' | 'worker_work_loop' | 'ambient' | null
    >,
  ): boolean {
    const pathDistance = polylineLengthXZ(path);
    if (pathDistance < 0.25) return false;
    agent.mode = purpose === 'refuge_rally'
      ? 'flee'
      : purpose === 'fire_assembly'
        ? 'run'
        : 'walk';
    agent.pathPurpose = purpose;
    agent.path = path;
    agent.pathDistance = pathDistance;
    agent.pathCursor = 0;
    agent.simPathCursor = 0;
    agent.displayPathCursor = 0;
    this.clearWorkerActivity(agent);
    agent.ambientBehavior = null;
    agent.idleDirty = false;
    return true;
  }

  private routePath(path: readonly PointXZ[]): PointXZ[] | null {
    if (path.length < 2) return path.map((point) => ({ ...point }));
    if (!this.routePathAroundObstacles) return path.map((point) => ({ ...point }));
    return this.routePathAroundObstacles(path);
  }

  private routeWorkerPath(
    path: readonly PointXZ[],
    workDistance: number | null,
  ): { path: PointXZ[]; workStopDistance: number | null } | null {
    if (workDistance == null) {
      const routedPath = this.routePath(path);
      return routedPath ? { path: routedPath, workStopDistance: null } : null;
    }

    const split = splitPolylineAtDistance(path, workDistance);
    if (!split) return null;
    const approach = this.routePath(split.before);
    const departure = this.routePath(split.after);
    if (!approach || !departure) return null;
    return {
      path: joinPolylines(approach, departure),
      workStopDistance: polylineLengthXZ(approach),
    };
  }

  private cancelBlockedPath(agent: VillagerAgent): void {
    const purpose = agent.pathPurpose;
    const current = samplePolylineXZ(agent.path, agent.displayPathCursor);
    if (current) {
      agent.x = current.x;
      agent.z = current.z;
      agent.y = this.resolveGroundY(agent.x, agent.z) + 0.02;
    }
    this.clearPath(agent);
    if (purpose === 'guard_muster') {
      agent.routinePhase = 'work';
      const tower = this.assignedGuardMusterTower(agent);
      if (tower) this.beginGuardMuster(agent, tower);
      else this.beginGuardMusterReturn(agent);
      return;
    }
    if (purpose === 'return_from_muster') {
      agent.routinePhase = 'at_muster';
      this.beginGuardMusterReturn(agent);
      return;
    }
    if (purpose === 'refuge_rally') {
      agent.routinePhase = 'home_outdoors';
      const refuge = this.assignedRefugeForResidence(agent);
      if (refuge) this.beginRefugeJourney(agent, refuge);
      return;
    }
    if (purpose === 'return_from_refuge') {
      agent.routinePhase = 'at_refuge';
      this.beginRefugeReturn(agent);
      return;
    }
    if (purpose === 'chapel_mass') {
      agent.massChapelId = null;
      agent.ambientBehavior = null;
      agent.routinePhase = 'home_outdoors';
      agent.idleRemaining = 1;
      this.syncChapelAmbientAssignments();
      return;
    }
    if (purpose === 'return_from_mass') {
      this.completeMassReturn(agent);
      return;
    }
    if (purpose === 'monastery_feast') {
      agent.massChapelId = null;
      agent.ambientBehavior = null;
      agent.routinePhase = 'home_outdoors';
      agent.idleRemaining = 1;
      return;
    }
    if (purpose === 'return_from_feast') {
      this.completeFeastReturn(agent);
      return;
    }
    if (purpose === 'wayside_shrine_prayer') {
      agent.devotionalShrineId = null;
      agent.devotionalShrineSlot = -1;
      agent.routinePhase = 'home_outdoors';
      agent.idleRemaining = 1;
      return;
    }
    if (purpose === 'return_from_shrine') {
      this.completeWaysideShrineReturn(agent);
      return;
    }
    if (purpose === 'graveyard_prayer') {
      agent.devotionalGraveyardId = null;
      agent.devotionalGraveyardSlot = -1;
      agent.routinePhase = 'home_outdoors';
      agent.idleRemaining = 1;
      return;
    }
    if (purpose === 'return_from_graveyard') {
      this.completeGraveyardReturn(agent);
      return;
    }
    if (purpose === 'fire_assembly') {
      agent.routinePhase = 'home_outdoors';
      const residence = agent.residenceId
        ? this.residences.get(agent.residenceId) ?? null
        : null;
      if (residence && this.fireDisabledResidenceIds.has(residence.id)) {
        this.beginFireAssemblyJourney(agent, residence);
      } else {
        this.reconcileRoutine(agent);
      }
      return;
    }
    if (purpose === 'return_from_fire_assembly') {
      agent.routinePhase = 'at_fire_assembly';
      this.beginFireAssemblyReturn(agent);
      return;
    }
    if (purpose === 'ambient') {
      agent.ambientBehavior = null;
      agent.idleRemaining = 1;
      return;
    }
    if (
      purpose === 'return_to_work'
      || purpose === 'return_for_observance'
    ) agent.routinePhase = 'home_outdoors';
    if (purpose === 'return_home' || purpose === 'worker_work_loop') {
      agent.routinePhase = 'work';
    }
    agent.idleRemaining = 1;
  }

  private clearPath(agent: VillagerAgent): void {
    agent.mode = 'idle';
    agent.currentMoveSpeed = 0;
    agent.pathPurpose = null;
    agent.path = [];
    agent.pathDistance = 0;
    agent.pathCursor = 0;
    agent.simPathCursor = 0;
    agent.displayPathCursor = 0;
    agent.workActivity = null;
    agent.workTarget = null;
    agent.workStopDistance = 0;
    agent.workRemaining = 0;
    agent.workPerformed = false;
  }

  private resetToIdle(agent: VillagerAgent, residence: ResidenceState): void {
    agent.mode = 'idle';
    agent.ambientBehavior = null;
    agent.pathPurpose = null;
    agent.path = [];
    agent.pathDistance = 0;
    agent.pathCursor = 0;
    agent.simPathCursor = 0;
    agent.displayPathCursor = 0;
    this.clearWorkerActivity(agent);
    agent.idleRemaining = pickIdleDuration(agent.pathSeed);
    agent.idleDirty = true;
    this.placeHomeIdle(agent, residence);
    agent.idleDirty = false;
  }

  private resetWorkerToIdle(agent: VillagerAgent): void {
    const building = agent.workplaceId ? this.buildings.get(agent.workplaceId) : null;
    agent.mode = building && isClericWorkplaceKind(building.kind)
      ? clericIdleAnimation(agent.pathSeed)
      : 'idle';
    agent.ambientBehavior = null;
    agent.routinePhase = 'work';
    agent.pathPurpose = null;
    agent.path = [];
    agent.pathDistance = 0;
    agent.pathCursor = 0;
    agent.simPathCursor = 0;
    agent.displayPathCursor = 0;
    this.clearWorkerActivity(agent);
    agent.idleRemaining = pickIdleDuration(agent.pathSeed) * 0.45;
    agent.idleDirty = true;
    if (building) this.placeWorkerIdle(agent, building);
    agent.idleDirty = false;
  }

  private clearWorkerActivity(agent: VillagerAgent): void {
    agent.workActivity = null;
    agent.workTarget = null;
    agent.workStopDistance = 0;
    agent.workRemaining = 0;
    agent.workPerformed = false;
  }

  private placeIdle(agent: VillagerAgent, residence: ResidenceState): void {
    const door = residenceDoorPosition(residence);
    const sin = Math.sin(residence.yaw);
    const cos = Math.cos(residence.yaw);
    const offsetX = agent.idleOffset.x * cos - agent.idleOffset.z * sin;
    const offsetZ = agent.idleOffset.x * sin + agent.idleOffset.z * cos;
    agent.x = door.x + offsetX;
    agent.z = door.z + offsetZ;
    agent.y = this.resolveGroundY(agent.x, agent.z) + 0.02;
    agent.yaw = residence.yaw + agent.idleOffset.yaw;
  }

  private placeHomeIdle(agent: VillagerAgent, residence: ResidenceState): void {
    const backyard = agent.routinePhase === 'home_outdoors' && this.holidayObservance
      ? holidayBackyardPosition(residence, agent.personIdentity)
      : null;
    if (!backyard) {
      this.placeIdle(agent, residence);
      return;
    }
    agent.x = backyard.x;
    agent.z = backyard.z;
    agent.y = this.resolveGroundY(agent.x, agent.z) + 0.02;
    agent.yaw = backyard.yaw;
    agent.idleDirty = false;
  }

  private advanceCampAmbientCycle(dtSeconds: number): void {
    if (!this.foundingCamp || dtSeconds <= 0) return;
    this.campAmbientElapsedSeconds += dtSeconds;
    const completedCycles = Math.floor(
      this.campAmbientElapsedSeconds / FOUNDERS_CAMP_AMBIENT_CYCLE_SECONDS,
    );
    if (completedCycles <= 0) return;

    this.campAmbientElapsedSeconds %= FOUNDERS_CAMP_AMBIENT_CYCLE_SECONDS;
    this.campAmbientCycleIndex += completedCycles;
    this.syncCampAmbientAssignments();
  }

  private syncCampAmbientAssignments(): boolean {
    const camp = this.foundingCamp;
    const candidates = camp
      ? [...this.agents.values()]
        .filter(
          (agent) =>
            agent.role === 'founder'
            && agent.routinePhase === 'home_outdoors',
        )
        .sort((a, b) => a.personIdentity.localeCompare(b.personIdentity))
      : [];
    const signature = camp
      ? [
          camp.id,
          camp.x,
          camp.z,
          this.campAmbientCycleIndex,
          ...candidates.map((agent) => agent.id),
        ].join(':')
      : '';
    if (signature === this.campAmbientSignature) return false;
    this.campAmbientSignature = signature;

    const previousAssignments = this.campAmbientAssignments;
    const previousPendingAssignments = this.pendingCampSeatAssignments;
    const plannedAssignments = camp
      ? planFoundersCampAmbientBehaviors(
          camp,
          candidates.map((agent) => agent.id),
          this.campAmbientCycleIndex,
        )
      : new Map();
    const previousSeatOccupants = new Map<string, string>();
    for (const [actorId, assignment] of previousAssignments) {
      if (assignment.seatId) previousSeatOccupants.set(assignment.seatId, actorId);
    }
    for (const pending of previousPendingAssignments.values()) {
      if (pending.assignment.seatId) {
        previousSeatOccupants.set(
          pending.assignment.seatId,
          pending.previousOccupantId,
        );
      }
    }

    this.campAmbientAssignments = new Map(plannedAssignments);
    this.pendingCampSeatAssignments = new Map();
    let waitingIndex = 0;
    for (const [actorId, assignment] of plannedAssignments) {
      if (!camp || !assignment.seatId) continue;
      const previousOccupantId = previousSeatOccupants.get(assignment.seatId);
      if (!previousOccupantId || previousOccupantId === actorId) continue;

      const previousOccupant = this.agents.get(previousOccupantId);
      if (
        !previousOccupant
        || this.hasClearedCampSeat(previousOccupant, assignment)
      ) {
        continue;
      }

      this.pendingCampSeatAssignments.set(actorId, {
        assignment,
        previousOccupantId,
      });
      this.campAmbientAssignments.set(
        actorId,
        this.campSeatWaitingAssignment(
          camp,
          actorId,
          assignment,
          waitingIndex,
        ),
      );
      waitingIndex += 1;
    }
    for (const agent of candidates) this.applyAmbientAssignment(agent);
    return true;
  }

  private transitionToSickRest(agent: VillagerAgent): boolean {
    const alreadyResting = agent.routinePhase === 'sick_rest'
      && agent.mode === 'rest'
      && agent.pathPurpose === null
      && !agent.idleDirty;
    if (alreadyResting) return false;
    this.clearPath(agent);
    this.clearWorkerActivity(agent);
    agent.routinePhase = 'sick_rest';
    agent.mode = 'rest';
    agent.ambientBehavior = null;
    agent.currentMoveSpeed = 0;
    agent.idleRemaining = Number.POSITIVE_INFINITY;
    const residence = agent.residenceId ? this.residences.get(agent.residenceId) : null;
    if (residence) this.placeIdle(agent, residence);
    agent.idleDirty = false;
    return true;
  }

  private campSeatWaitingAssignment(
    camp: BuildingState,
    actorId: string,
    seatAssignment: AmbientBehaviorAssignment,
    waitingIndex: number,
  ): AmbientBehaviorAssignment {
    const waitingSpots = [
      { x: 3.35, z: -1.7 },
      { x: -0.45, z: 1.15 },
    ] as const;
    const spot = waitingSpots[waitingIndex % waitingSpots.length]!;
    return {
      actorId,
      id: `waiting-for-${seatAssignment.seatId ?? seatAssignment.id}`,
      kind: 'idle',
      destination: {
        x: camp.x + spot.x,
        z: camp.z + spot.z,
      },
      lookAt: {
        x: camp.x + FOUNDERS_CAMPFIRE_POSITION.x,
        z: camp.z + FOUNDERS_CAMPFIRE_POSITION.z,
      },
    };
  }

  private hasClearedCampSeat(
    occupant: VillagerAgent,
    seatAssignment: AmbientBehaviorAssignment,
  ): boolean {
    return Math.hypot(
      occupant.x - seatAssignment.destination.x,
      occupant.z - seatAssignment.destination.z,
    ) >= CAMP_SEAT_RELEASE_DISTANCE;
  }

  private releaseVacatedCampSeats(): void {
    if (this.pendingCampSeatAssignments.size === 0) return;

    for (const [actorId, pending] of [...this.pendingCampSeatAssignments]) {
      const actor = this.agents.get(actorId);
      if (
        !actor
        || actor.role !== 'founder'
        || actor.routinePhase !== 'home_outdoors'
      ) {
        this.pendingCampSeatAssignments.delete(actorId);
        continue;
      }

      const previousOccupant = this.agents.get(pending.previousOccupantId);
      if (
        previousOccupant
        && !this.hasClearedCampSeat(previousOccupant, pending.assignment)
      ) {
        continue;
      }

      this.pendingCampSeatAssignments.delete(actorId);
      this.campAmbientAssignments.set(actorId, pending.assignment);
      this.applyAmbientAssignment(actor);
    }
  }

  private advanceChapelAmbientCycle(dtSeconds: number): void {
    if (this.chapelAmbientAssignments.size === 0 || dtSeconds <= 0) return;
    this.chapelAmbientElapsedSeconds += dtSeconds;
    const completedCycles = Math.floor(
      this.chapelAmbientElapsedSeconds / CHAPEL_GATHERING_AMBIENT_CYCLE_SECONDS,
    );
    if (completedCycles <= 0) return;

    this.chapelAmbientElapsedSeconds %= CHAPEL_GATHERING_AMBIENT_CYCLE_SECONDS;
    this.chapelAmbientCycleIndex += completedCycles;
    this.syncChapelAmbientAssignments();
  }

  private syncChapelAmbientAssignments(): boolean {
    const rosters = new Map<string, VillagerAgent[]>();
    for (const agent of this.agents.values()) {
      if (
        !agent.massChapelId
        || (
          agent.routinePhase !== 'going_to_mass'
          && agent.routinePhase !== 'at_mass'
        )
      ) {
        continue;
      }
      const roster = rosters.get(agent.massChapelId) ?? [];
      roster.push(agent);
      rosters.set(agent.massChapelId, roster);
    }
    for (const roster of rosters.values()) {
      roster.sort((a, b) => a.personIdentity.localeCompare(b.personIdentity));
    }

    const phase = this.holidayObservance
      ? 'fellowship' as const
      : this.clock
        ? chapelMassPhase(this.clock, this.massChapels.length > 0)
        : null;
    const signature = [
      this.chapelAmbientCycleIndex,
      phase ?? 'none',
      ...[...rosters]
        .sort(([a], [b]) => a.localeCompare(b))
        .flatMap(([chapelId, roster]) => [
          chapelId,
          this.buildings.get(chapelId)?.x ?? '',
          this.buildings.get(chapelId)?.z ?? '',
          // Arrival state is significant during the service: a villager who
          // changes from travelling to at_mass must be moved into the nave even
          // though the chapel roster itself has not changed.
          ...roster.map((agent) => `${agent.id}=${agent.routinePhase}`),
        ]),
    ].join(':');
    if (signature === this.chapelAmbientSignature) return false;
    this.chapelAmbientSignature = signature;

    const assignments = new Map<string, AmbientBehaviorAssignment>();
    for (const [chapelId, roster] of rosters) {
      const chapel = this.buildings.get(chapelId);
      if (!chapel) continue;
      const clergyActorIds = roster
        .filter((agent) => this.isPriestAgent(agent))
        .map((agent) => agent.id);
      for (const [agentId, assignment] of planChapelGatheringBehaviors(
        chapel,
        roster.map((agent) => agent.id),
        this.chapelAmbientCycleIndex,
        {
          clergyActorIds,
          phase: phase ?? 'fellowship',
        },
      )) {
        assignments.set(agentId, assignment);
      }
    }
    this.chapelAmbientAssignments = assignments;
    for (const [chapelId, roster] of rosters) {
      const chapel = this.buildings.get(chapelId);
      for (const agent of roster) {
        if (agent.routinePhase !== 'at_mass') continue;
        if (phase === 'service' && chapel) {
          this.clearPath(agent);
          agent.ambientBehavior = null;
          agent.x = chapel.x;
          agent.z = chapel.z;
          agent.y = this.resolveGroundY(agent.x, agent.z) + 0.02;
          agent.yaw = resolvedPlacedBuildingYaw(chapel);
          agent.mode = this.isPriestAgent(agent)
            ? clericMassAnimation('service', agent.pathSeed) as VillagerMode
            : 'pray';
          agent.idleRemaining = Number.POSITIVE_INFINITY;
          continue;
        }
        this.applyAmbientAssignment(agent);
      }
    }
    return true;
  }

  private ambientAssignmentFor(
    agent: VillagerAgent,
  ): AmbientBehaviorAssignment | undefined {
    if (agent.routinePhase === 'at_mass') {
      return this.chapelAmbientAssignments.get(agent.id);
    }
    if (agent.role === 'founder' && agent.routinePhase === 'home_outdoors') {
      return this.campAmbientAssignments.get(agent.id);
    }
    return undefined;
  }

  private applyAmbientAssignment(agent: VillagerAgent): void {
    const assignment = this.ambientAssignmentFor(agent);
    if (!assignment) {
      agent.ambientBehavior = null;
      return;
    }
    agent.ambientBehavior = assignment.kind;

    const path = assignment.kind === 'wander' && assignment.waypoints?.length
      ? [
          { x: agent.x, z: agent.z },
          ...assignment.waypoints.map((point) => ({ ...point })),
        ]
      : [
          { x: agent.x, z: agent.z },
          { ...(assignment.approach ?? assignment.destination) },
        ];
    const routedPath = this.routePath(path);
    const pathDistance = routedPath ? polylineLengthXZ(routedPath) : 0;
    if (!routedPath || pathDistance < 0.25) {
      this.completeAmbientArrival(agent);
      return;
    }

    agent.mode = 'walk';
    agent.pathPurpose = 'ambient';
    agent.path = routedPath;
    agent.pathDistance = pathDistance;
    agent.pathCursor = 0;
    agent.simPathCursor = 0;
    agent.displayPathCursor = 0;
    agent.currentMoveSpeed = 0;
    this.clearWorkerActivity(agent);
    agent.idleDirty = false;
  }

  private completeAmbientArrival(agent: VillagerAgent): void {
    const assignment = this.ambientAssignmentFor(agent);
    this.clearPath(agent);
    if (!assignment) {
      agent.ambientBehavior = null;
      return;
    }

    agent.ambientBehavior = assignment.kind;
    agent.x = assignment.destination.x;
    agent.z = assignment.destination.z;
    agent.y = this.resolveAmbientY(agent, assignment);
    if (assignment.lookAt) {
      agent.yaw = Math.atan2(
        assignment.lookAt.x - agent.x,
        assignment.lookAt.z - agent.z,
      );
    }
    const massPhase = this.clock && !this.holidayObservance
      ? chapelMassPhase(this.clock, agent.massChapelId !== null)
      : 'fellowship';
    agent.mode = agent.routinePhase === 'at_mass' && this.isPriestAgent(agent)
      ? clericMassAnimation(massPhase ?? 'fellowship', agent.pathSeed) as VillagerMode
      : assignment.kind === 'wander'
        ? 'idle'
        : assignment.kind === 'idle'
          ? villagerStandingActionMode(agent.pathSeed)
          : assignment.kind;
    const cycleSeconds = agent.routinePhase === 'at_mass'
      ? CHAPEL_GATHERING_AMBIENT_CYCLE_SECONDS
      : FOUNDERS_CAMP_AMBIENT_CYCLE_SECONDS;
    const elapsedSeconds = agent.routinePhase === 'at_mass'
      ? this.chapelAmbientElapsedSeconds
      : this.campAmbientElapsedSeconds;
    agent.idleRemaining = Math.max(
      1,
      cycleSeconds - elapsedSeconds,
    );
    agent.idleDirty = false;
  }

  private foundingCampRestPosition(
    agent: VillagerAgent,
    camp: BuildingState,
  ): PointXZ & { yaw: number } {
    return {
      x: camp.x + agent.idleOffset.x * 2.6,
      z: camp.z + 0.4 + agent.idleOffset.z * 2.6,
      yaw: agent.idleOffset.yaw,
    };
  }

  private placeFounderIdle(agent: VillagerAgent, camp: BuildingState): void {
    const rest = this.foundingCampRestPosition(agent, camp);
    agent.ambientBehavior = null;
    agent.x = rest.x;
    agent.z = rest.z;
    agent.y = this.resolveGroundY(agent.x, agent.z) + 0.02;
    agent.yaw = rest.yaw;
  }

  private placeWorkerIdle(agent: VillagerAgent, building: BuildingState): void {
    if (building.kind === 'watchtower' && building.constructionComplete !== false) {
      const lookout = watchtowerDutyPosition(building, agent.workplaceSlot);
      agent.x = lookout.x;
      agent.z = lookout.z;
      agent.y = this.resolveGroundY(building.x, building.z) + lookout.yOffset;
      agent.yaw = lookout.yaw;
      return;
    }
    const yard = this.workerDutyPosition(building, agent.workplaceSlot);
    agent.x = yard.x;
    agent.z = yard.z;
    agent.y = this.resolveGroundY(agent.x, agent.z) + 0.02;
    agent.yaw = yard.yaw;
  }

  private scanFromWatchtower(agent: VillagerAgent, building: BuildingState): void {
    this.placeWorkerIdle(agent, building);
    const sweepUnit = ((agent.pathSeed >>> 8) & 0xff) / 0xff;
    agent.yaw += (sweepUnit - 0.5) * 1.15;
    agent.pathSeed = (agent.pathSeed * 1_664_525) ^ 0x51f15e5d;
    agent.idleRemaining = 2.5 + sweepUnit * 2.5;
    agent.idleDirty = false;
  }

  private resolveAgentY(agent: VillagerAgent): number {
    const ambient = this.campAmbientAssignments.get(agent.id);
    if (
      ambient
      && agent.routinePhase === 'home_outdoors'
      && agent.mode !== 'walk'
    ) {
      return this.resolveAmbientY(agent, ambient);
    }
    if (
      agent.role === 'worker'
      && (
        agent.routinePhase === 'work'
        || agent.routinePhase === 'observance_at_worksite'
      )
      && agent.mode === 'idle'
      && agent.workplaceId
    ) {
      const building = this.buildings.get(agent.workplaceId);
      if (building?.kind === 'watchtower' && building.constructionComplete !== false) {
        return this.resolveGroundY(building.x, building.z)
          + watchtowerDutyPosition(building, agent.workplaceSlot).yOffset;
      }
    }
    return this.resolveGroundY(agent.x, agent.z) + 0.02;
  }

  private resolveAmbientY(
    agent: VillagerAgent,
    assignment: AmbientBehaviorAssignment,
  ): number {
    if (
      assignment.seatSurfaceHeight !== undefined
      && (assignment.kind === 'sit' || assignment.kind === 'rest')
    ) {
      const supportGroundY = this.foundingCamp
        ? this.resolveGroundY(this.foundingCamp.x, this.foundingCamp.z)
        : this.resolveGroundY(agent.x, agent.z);
      return supportGroundY
        + assignment.seatSurfaceHeight
        - seatedVillagerContactHeight(agent.modelVariant, agent.appearanceSeed);
    }
    return this.resolveGroundY(agent.x, agent.z)
      + 0.02
      + (assignment.groundOffset ?? 0);
  }

  private resolveGroundY(x: number, z: number): number {
    return resolveRoadAwareGroundY(
      this.getHeightAt(x, z),
      this.getRoadDeckY?.(x, z) ?? null,
    );
  }

  private workerToolFor(agent: VillagerAgent): WorkerToolKind | null {
    if (agent.role !== 'worker' || !agent.workplaceId) return null;
    if (
      agent.routinePhase === 'going_to_refuge'
      || agent.routinePhase === 'at_refuge'
      || agent.routinePhase === 'returning_from_refuge'
      || agent.routinePhase === 'going_to_mass'
      || agent.routinePhase === 'at_mass'
      || agent.routinePhase === 'returning_from_mass'
      || agent.routinePhase === 'going_to_feast'
      || agent.routinePhase === 'at_feast'
      || agent.routinePhase === 'returning_from_feast'
      || agent.routinePhase === 'going_to_shrine'
      || agent.routinePhase === 'praying_at_shrine'
      || agent.routinePhase === 'returning_from_shrine'
      || agent.routinePhase === 'going_to_fire_assembly'
      || agent.routinePhase === 'at_fire_assembly'
      || agent.routinePhase === 'returning_from_fire_assembly'
      || agent.routinePhase === 'observance_at_worksite'
      || agent.routinePhase === 'returning_for_observance'
    ) return null;
    const workplace = this.buildings.get(agent.workplaceId);
    if (workplace && this.fireDisabledBuildingIds.has(workplace.id)) return null;
    if (workplace?.constructionComplete === false) return 'hammer';
    if (workplace && workerProductionBlocker(workplace)) return null;
    const kind = workplace?.kind;
    if (kind === 'monastery' && agent.workTarget?.clericDuty === 'pruning') {
      return 'hatchet';
    }
    if (kind === 'monastery' && agent.workTarget?.clericDuty === 'soil_work') {
      return 'shovel';
    }
    if (kind === 'lumber_mill' || kind === 'woodcutters_lodge') return 'hatchet';
    if (
      kind === 'stone_quarry'
      || kind === 'large_quarry'
      || kind === 'mine'
    ) return 'pickaxe';
    if (
      kind === 'reforester'
      || kind === 'charcoal_burner'
    ) return 'shovel';
    if (
      kind === 'threshing_barn'
      || (kind === 'monastery' && agent.workTarget?.id?.includes(':monastery:vineyard:'))
    ) return 'hoe';
    if (kind === 'carpenter' || kind === 'smithy') return 'hammer';
    return null;
  }
}

function remainingPolyline(path: readonly PointXZ[], distance: number): PointXZ[] {
  const split = splitPolylineAtDistance(path, distance);
  return split?.after ?? [];
}

function splitPolylineAtDistance(
  path: readonly PointXZ[],
  distance: number,
): { before: PointXZ[]; after: PointXZ[] } | null {
  if (path.length === 0) return null;
  if (path.length === 1) {
    const point = { ...path[0] };
    return { before: [point], after: [{ ...point }] };
  }

  let remaining = Math.max(0, distance);
  const before: PointXZ[] = [{ ...path[0] }];
  for (let index = 0; index < path.length - 1; index++) {
    const start = path[index];
    const end = path[index + 1];
    const segmentLength = Math.hypot(end.x - start.x, end.z - start.z);
    if (segmentLength <= 1e-6) continue;
    if (remaining <= segmentLength + 1e-6) {
      const t = Math.min(1, remaining / segmentLength);
      const splitPoint = {
        x: start.x + (end.x - start.x) * t,
        z: start.z + (end.z - start.z) * t,
      };
      pushPathPoint(before, splitPoint);
      const after: PointXZ[] = [{ ...splitPoint }];
      for (let tail = index + 1; tail < path.length; tail++) {
        pushPathPoint(after, path[tail]);
      }
      return { before, after };
    }
    remaining -= segmentLength;
    pushPathPoint(before, end);
  }

  const last = { ...path[path.length - 1] };
  return { before, after: [last] };
}

function joinPolylines(first: readonly PointXZ[], second: readonly PointXZ[]): PointXZ[] {
  const joined = first.map((point) => ({ ...point }));
  for (const point of second) pushPathPoint(joined, point);
  return joined;
}

function pushPathPoint(path: PointXZ[], point: PointXZ): void {
  const previous = path[path.length - 1];
  if (previous && Math.hypot(previous.x - point.x, previous.z - point.z) <= 1e-5) return;
  path.push({ ...point });
}

function polylineTouchesWater(
  path: readonly PointXZ[],
  isWaterAt: (x: number, z: number) => boolean,
): boolean {
  for (let index = 0; index < path.length - 1; index += 1) {
    const start = path[index];
    const end = path[index + 1];
    const distance = Math.hypot(end.x - start.x, end.z - start.z);
    const samples = Math.max(
      1,
      Math.ceil(distance / FISHING_PATH_WATER_SAMPLE_STEP),
    );
    for (let sample = 0; sample <= samples; sample += 1) {
      const t = sample / samples;
      if (isWaterAt(
        start.x + (end.x - start.x) * t,
        start.z + (end.z - start.z) * t,
      )) return true;
    }
  }
  return false;
}

function refugeAssignmentMapsEqual(
  left: ReadonlyMap<string, string>,
  right: ReadonlyMap<string, string>,
): boolean {
  if (left === right) return true;
  if (left.size !== right.size) return false;
  for (const [residenceId, refugeId] of left) {
    if (right.get(residenceId) !== refugeId) return false;
  }
  return true;
}

function guardMusterAssignmentMapsEqual(
  left: ReadonlyMap<string, GuardMusterPresentationAssignment>,
  right: ReadonlyMap<string, GuardMusterPresentationAssignment>,
): boolean {
  if (left === right) return true;
  if (left.size !== right.size) return false;
  for (const [guardhouseId, assignment] of left) {
    if (right.get(guardhouseId)?.towerId !== assignment.towerId) return false;
  }
  return true;
}

function describeVillagerActivity(
  agent: VillagerAgent,
  workplace: BuildingState | null,
  residenceWorksLabel = 'household improvement works',
  workplaceFireDisabled = false,
  residenceFireDisabled = false,
  holiday: HolidayObservance | null = null,
  marketStallDuty: MarketStallDuty | null = null,
  backyardWorksite: BackyardWorksite | null = null,
  essentialSabbathDuty: EssentialSabbathDuty | null = null,
  sabbathRestAtHome = false,
  massPhase: 'assembly' | 'service' | 'fellowship' | null = null,
): string {
  const workplaceLabel = workplace
    ? isResidenceUpgradeWorkplaceId(workplace.id)
      ? residenceWorksLabel
      : getBuildingDefinition(workplace.kind).label
    : 'their workplace';

  switch (agent.routinePhase) {
    case 'returning_to_work':
      if (workplaceFireDisabled) return `Turning back from the fire at ${workplaceLabel}`;
      return marketStallDuty
        ? 'Walking to the Marketplace stall'
        : `Walking to ${workplaceLabel}`;
    case 'returning_for_observance':
      return `Returning to ${workplaceLabel} before the observance ends`;
    case 'returning_home':
      return workplaceFireDisabled
        ? `Evacuating from the fire at ${workplaceLabel}`
        : 'Walking home';
    case 'going_to_mass':
      return holiday
        ? `Walking to the ${holiday.label} gathering`
        : 'Walking to Sunday mass';
    case 'at_mass':
      if (massPhase === 'service') {
        return workplace?.kind === 'chapel'
          ? 'Leading Sunday mass inside the chapel'
          : 'Attending Sunday mass inside the chapel';
      }
      if (massPhase === 'assembly' && workplace?.kind === 'chapel') {
        return 'Greeting the parish and calling the congregation to mass';
      }
      if (massPhase === 'fellowship' && workplace?.kind === 'chapel') {
        return 'Speaking with parishioners after mass';
      }
      if (agent.ambientBehavior === 'talk') {
        return holiday
          ? `Celebrating ${holiday.label} with the congregation`
          : 'Mingling with the Sunday congregation';
      }
      if (agent.ambientBehavior === 'wander') {
        return holiday
          ? `Joining the ${holiday.label} procession and congregation`
          : 'Circulating through the Sunday congregation';
      }
      return holiday ? `Observing ${holiday.label} at church` : 'Attending Sunday mass';
    case 'returning_from_mass':
      return holiday
        ? `Walking home from the ${holiday.label} gathering`
        : 'Walking home from Sunday mass';
    case 'going_to_feast':
      return 'Walking by road to the monastery feast';
    case 'at_feast':
      return 'Sharing the feast at the monastery';
    case 'returning_from_feast':
      return 'Walking home from the monastery feast';
    case 'going_to_shrine':
      return holiday
        ? `Walking to a wayside shrine for ${holiday.label}`
        : 'Walking to a wayside shrine for Sabbath prayer';
    case 'praying_at_shrine':
      return holiday
        ? `Praying at a wayside shrine for ${holiday.label}`
        : 'Praying at a wayside shrine on the Sabbath';
    case 'returning_from_shrine':
      return 'Walking home from the wayside shrine';
    case 'going_to_graveyard':
      return 'Walking from the Sunday congregation to the parish graveyard';
    case 'praying_at_graveyard':
      return 'Remembering the dead at the parish graveyard';
    case 'returning_from_graveyard':
      return 'Walking home from the parish graveyard';
    case 'going_to_muster':
      return 'Marching by road to the linked frontier watch';
    case 'at_muster':
      return 'Holding the watch muster line during the frontier alert';
    case 'returning_from_muster':
      return workplaceFireDisabled
        ? `Evacuating from the fire at ${workplaceLabel}`
        : 'Returning to the guardhouse after the alert';
    case 'going_to_refuge':
      return 'Rallying through the palisaded refuge gate';
    case 'at_refuge':
      return 'Sheltering with their household during the frontier alert';
    case 'returning_from_refuge':
      return 'Returning from the civilian refuge';
    case 'going_to_fire_assembly':
      return 'Evacuating from a household fire';
    case 'at_fire_assembly':
      return 'Waiting safely outside a fire-disabled home';
    case 'returning_from_fire_assembly':
      return 'Returning home after fire recovery';
    case 'work':
      if (workplaceFireDisabled) {
        return `Leaving ${workplaceLabel} — the site is closed by fire`;
      }
      if (essentialSabbathDuty === 'livestock_care') {
        return `Providing essential Sabbath livestock care at ${workplaceLabel}`;
      }
      if (essentialSabbathDuty === 'watch') {
        return `Keeping the essential Sabbath watch at ${workplaceLabel}`;
      }
      if (essentialSabbathDuty === 'guard_readiness') {
        return `Maintaining Sabbath guard readiness at ${workplaceLabel}`;
      }
      if (marketStallDuty) {
        return marketStallDuty.needKind
          ? `Minding the ${marketStallLabel(marketStallDuty.needKind).toLocaleLowerCase()} stall at the Marketplace`
          : 'Preparing an empty stall at the Marketplace';
      }
      if (workplace?.kind === 'chapel') {
        switch (agent.workTarget?.clericDuty) {
          case 'interior_prayer': return 'Praying and preparing the chapel interior';
          case 'interior_study': return 'Studying scripture in the vestry';
          case 'churchyard_prayer': return 'Keeping prayer and watch in the churchyard';
          case 'parish_visit': return 'Making a pastoral visit to a nearby household';
          case 'sermon_rehearsal': return 'Rehearsing the sermon before the chapel doors';
        }
        return agent.mode === 'walk'
          ? 'Walking parish rounds around the chapel'
          : 'Serving the parish at the chapel';
      }
      if (workplace?.kind === 'monastery') {
        switch (agent.workTarget?.clericDuty) {
          case 'cloister_prayer': return 'Keeping the hours in the monastery cloister';
          case 'scriptorium': return 'Reading and copying texts in the scriptorium';
          case 'infirmary_care': return 'Caring for the sick in the monastery infirmary';
          case 'hospitality': return 'Receiving travelers and giving alms at the monastery';
          case 'brewing': return 'Brewing and pressing the monastery harvest';
          case 'harvest': return 'Gathering herbs, fruit, and honey on the monastery estate';
          case 'soil_work': return 'Digging and tending the monastery croft';
          case 'pruning': return 'Pruning the monastery orchard and vineyard';
          case 'livestock_care': return 'Feeding and handling the monastery livestock';
          case 'ox_guidance': return 'Guiding an ox through the monastery pasture';
        }
      }
      if (workplace?.kind === 'watchtower') {
        return 'Keeping watch from the frontier gallery';
      }
      if (workplace) {
        const blocker = workerProductionBlocker(workplace);
        if (blocker) {
          return `Waiting at ${workplaceLabel} — ${workerProductionBlockerDescription(blocker)}`;
        }
      }
      if (agent.mode === 'chop') {
        return workplace?.kind === 'woodcutters_lodge'
          ? `Cutting firewood near ${workplaceLabel}`
          : `Chopping timber near ${workplaceLabel}`;
      }
      if (agent.mode === 'mine') {
        if (workplace?.kind === 'large_quarry') return `Cutting rich stone at ${workplaceLabel}`;
        if (workplace?.kind === 'mine') return `Working the deep face at ${workplaceLabel}`;
        return `Extracting surface material near ${workplaceLabel}`;
      }
      if (agent.mode === 'plant') {
        return `Planting saplings near ${workplaceLabel}`;
      }
      if (agent.mode === 'sow') return `Broadcast sowing seed for ${workplaceLabel}`;
      if (agent.mode === 'fish') return `Fishing near ${workplaceLabel}`;
      if (agent.mode === 'gather') {
        if (workplace?.kind === 'hunters_hall') return `Checking game near ${workplaceLabel}`;
        if (workplace?.kind === 'swineherd') return `Collecting mast near ${workplaceLabel}`;
        if (workplace?.kind === 'apiary') return `Inspecting hives at ${workplaceLabel}`;
        if (workplace?.kind === 'monastery' && agent.workTarget?.id?.includes(':monastery:vineyard:')) {
          return `Tending the vineyard rows for ${workplaceLabel}`;
        }
        return `Gathering wild food near ${workplaceLabel}`;
      }
      if (agent.mode === 'tend') {
        if (workplace?.kind === 'monastery') {
          if (agent.workTarget?.id?.endsWith(':vintner')) {
            return `Pressing and fermenting vineyard grapes at ${workplaceLabel}`;
          }
          if (agent.workTarget?.id?.endsWith(':mead-brewhouse')) {
            return `Brewing monastic mead at ${workplaceLabel}`;
          }
          if (agent.workTarget?.id?.endsWith(':cider-press')) {
            return `Pressing orchard fruit for cider at ${workplaceLabel}`;
          }
        }
        switch (workplace?.kind) {
          case 'well': return `Drawing water at ${workplaceLabel}`;
          case 'threshing_barn':
            if (agent.workTarget?.fieldStage === 'ploughing') {
              return `Ploughing a field for ${workplaceLabel}`;
            }
            if (agent.workTarget?.fieldStage === 'harvesting') {
              return `Harvesting a field for ${workplaceLabel}`;
            }
            return `Working the fields for ${workplaceLabel}`;
          case 'pastoral_farmstead':
          case 'swineherd': return `Tending livestock for ${workplaceLabel}`;
          case 'brewery': return `Tending the brew at ${workplaceLabel}`;
          case 'smokehouse': return `Tending the smoke racks at ${workplaceLabel}`;
          case 'granary': return `Handling grain at ${workplaceLabel}`;
          case 'bakery': return `Baking bread at ${workplaceLabel}`;
          case 'watermill': return `Tending the mill at ${workplaceLabel}`;
          case 'windmill': return `Tending the sails at ${workplaceLabel}`;
          case 'charcoal_burner': return `Sealing and venting the clamp at ${workplaceLabel}`;
          case 'potter_kiln': return `Shaping and firing vessels at ${workplaceLabel}`;
          default: return `Tending work at ${workplaceLabel}`;
        }
      }
      if (agent.mode === 'build') {
        if (workplace?.kind === 'guardhouse') {
          return `Drilling with the guard at ${workplaceLabel}`;
        }
        if (workplace?.kind === 'smithy') {
          return `Forging ironwork at ${workplaceLabel}`;
        }
        return `Hammering on ${workplaceLabel}`;
      }
      if (workplace?.constructionComplete === false) {
        return agent.mode === 'walk'
          ? `Building ${workplaceLabel}`
          : `Working on ${workplaceLabel}`;
      }
      return agent.mode === 'walk'
        ? `Working around ${workplaceLabel}`
        : `Working at ${workplaceLabel}`;
    case 'observance_at_worksite':
      if (workplace?.kind === 'chapel') {
        return 'Inside the chapel after Sunday services';
      }
      return holiday
        ? `Observing ${holiday.label} without working at ${workplaceLabel}`
        : `Observing the Sabbath without working at ${workplaceLabel}`;
    case 'sick_rest':
      return 'Resting at home while ill';
    case 'home_outdoors':
      if (residenceFireDisabled) {
        return 'Leaving a fire-disabled home';
      }
      if (agent.role === 'worker' && workplaceFireDisabled) {
        return `Waiting near home — ${workplaceLabel} is closed by fire`;
      }
      if (agent.pathPurpose === 'backyard_work') {
        if (backyardWorksite) {
          return agent.mode === 'gather'
            ? `Harvesting ${backyardGardenLabel(backyardWorksite.kind).toLowerCase()}`
            : `Walking to household harvest at ${backyardGardenLabel(backyardWorksite.kind).toLowerCase()}`;
        }
      }
      if (holiday && agent.role !== 'founder') {
        if (agent.pathPurpose === 'home_wander' && agent.mode === 'walk') {
          return `Taking a ${holiday.label} holiday walk`;
        }
        return `Celebrating ${holiday.label} with the household in the backyard`;
      }
      if (agent.role === 'founder') {
        if (holiday) return `Celebrating ${holiday.label} at the founders' camp`;
        switch (agent.ambientBehavior) {
          case 'wander': return "Walking around the founders' camp";
          case 'sit': return 'Sitting on the camp bench';
          case 'rest': return 'Sitting on a stump beside the campfire';
          case 'talk': return 'Talking with another founder';
          default: return "Waiting at the founders' camp";
        }
      }
      return agent.mode === 'walk' ? 'Walking near home' : 'Outside at home';
    case 'indoors':
      if (residenceFireDisabled) return 'Evacuating a fire-disabled home';
      if (sabbathRestAtHome) return 'Resting at home after Sabbath devotions';
      return agent.role === 'worker' && workplaceFireDisabled
        ? `At home — ${workplaceLabel} is closed by fire`
        : 'At home';
    case 'asleep':
      return 'Sleeping';
  }
}

function projectWorldPoint(
  x: number,
  y: number,
  z: number,
  camera: THREE.Camera,
  bounds: DOMRect,
): { x: number; y: number } | null {
  const projected = new THREE.Vector3(x, y, z).project(camera);
  if (
    !Number.isFinite(projected.x)
    || !Number.isFinite(projected.y)
    || !Number.isFinite(projected.z)
    || projected.z < -1
    || projected.z > 1
  ) {
    return null;
  }
  return {
    x: bounds.left + (projected.x * 0.5 + 0.5) * bounds.width,
    y: bounds.top + (-projected.y * 0.5 + 0.5) * bounds.height,
  };
}

function projectedAgentHitDistance(
  clientX: number,
  clientY: number,
  x: number,
  y: number,
  z: number,
  camera: THREE.Camera,
  bounds: DOMRect,
): number | null {
  const feet = projectWorldPoint(x, y + 0.08, z, camera, bounds);
  const head = projectWorldPoint(x, y + 1.72, z, camera, bounds);
  if (!feet || !head) return null;
  const projectedHeight = Math.hypot(feet.x - head.x, feet.y - head.y);
  const hitRadius = Math.min(30, Math.max(11, projectedHeight * 0.34));
  const distance = distanceToScreenSegment(
    clientX,
    clientY,
    feet.x,
    feet.y,
    head.x,
    head.y,
  );
  return distance <= hitRadius ? distance : null;
}

function distanceToScreenSegment(
  pointX: number,
  pointY: number,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
): number {
  const segmentX = endX - startX;
  const segmentY = endY - startY;
  const lengthSq = segmentX * segmentX + segmentY * segmentY;
  if (lengthSq <= 0.0001) return Math.hypot(pointX - startX, pointY - startY);
  const t = Math.min(
    1,
    Math.max(
      0,
      ((pointX - startX) * segmentX + (pointY - startY) * segmentY) / lengthSq,
    ),
  );
  return Math.hypot(
    pointX - (startX + segmentX * t),
    pointY - (startY + segmentY * t),
  );
}

function combatGuardSlotKey(buildingId: string, sourceSlot: number): string {
  return `${buildingId}:${Math.max(0, Math.floor(sourceSlot))}`;
}

function combatAppearanceSeed(agent: CombatAgentState): number {
  const value = `${agent.faction}:${agent.raidId}:${agent.id}`;
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function combatFactionsAreHostile(
  left: CombatAgentState['faction'],
  right: CombatAgentState['faction'],
): boolean {
  const leftHostile = isHostileCombatFaction(left);
  const rightHostile = isHostileCombatFaction(right);
  return leftHostile !== rightHostile;
}

function combatRenderMode(
  combat: CombatAgentState,
  running = false,
  reactingToHit = false,
  threatening = false,
  displayMoveSpeed = 0,
): VillagerRenderMode {
  if (combat.status === 'downed') return 'fall';
  if (reactingToHit) return 'hurt';
  if (combat.faction === 'raider' && threatening) return 'talk';
  switch (combat.status) {
    case 'fighting': return 'fight';
    case 'looting': {
      if (combat.faction === 'raider') {
        if (combat.raidAnchorBuildingId) return 'chop';
        if (combat.targetKind === 'cart') return 'gather';
        if (combat.lootProgress < RAIDER_ENTRY_BREAK_SECONDS) return 'chop';
        if (combat.lootProgress >= RAIDER_LOOT_CHEER_START_SECONDS) return 'laugh';
        return 'gather';
      }
      return combat.targetKind !== 'cart' ? 'fight' : 'gather';
    }
    case 'recovering': return 'rest';
    case 'advancing': return running ? 'run' : 'walk';
    case 'retreating': return combat.faction === 'raider' ? 'flee' : 'walk';
    case 'returning':
    case 'wounded-returning':
    case 'mustering':
      return 'walk';
    case 'holding': {
      // Camp patrols retain the authoritative "holding" status while moving
      // between nearby posts. Drive their animation from actual screen-space
      // locomotion so they never slide around in an idle pose.
      if (displayMoveSpeed > 0.12) return displayMoveSpeed > 1.85 ? 'run' : 'walk';
      if (combat.faction !== 'raider') return 'idle';
      const variations: VillagerRenderMode[] = ['idle', 'relax', 'look', 'wait'];
      return variations[combatAppearanceSeed(combat) % variations.length] ?? 'idle';
    }
  }
}

function combatToolFor(combat: CombatAgentState): WorkerToolKind | null {
  const { faction } = combat;
  switch (faction) {
    case 'guard': return 'spear-shield';
    case 'raider': {
      if (ottomanRaiderIsRanged(combat.sourceSlot)) return 'bow';
      if (combat.ottomanRole === 'azab') return 'spear';
      if (combat.ottomanRole === 'sipahi') return 'spear-shield';
      return 'sidearm';
    }
    case 'bandit': return 'spear';
    case 'militia': return 'spear';
    case 'spearman': return 'spear-shield';
    case 'crossbow': return 'crossbow';
    case 'mercenary-spear': return 'pike-kit';
    case 'bowman': return 'bow';
    case 'hussar': return 'spear-shield';
    case 'armored-lancer': return 'spear';
    case 'mounted-archer': return 'bow';
    case 'man-at-arms': return 'sword-shield';
    case 'footman': return 'sidearm-shield';
    case 'polearm': return 'halberd';
    case 'dog':
    case 'fox':
    case 'wolf': return null;
  }
}

function combatAttackSeconds(
  combat: CombatAgentState,
  targetDistance: number,
): number {
  switch (combat.faction) {
    case 'guard': return 1.75 - THREE.MathUtils.clamp(combat.readiness, 0, 1) * 0.35;
    case 'raider': return 1.85;
    case 'bandit': return 1.2;
    case 'militia': return 1.1;
    case 'spearman': return 1;
    case 'man-at-arms': return 0.92;
    case 'crossbow': return targetDistance > 3.25 ? 2.45 : 0.9;
    case 'mercenary-spear': return 0.94;
    case 'footman': return 0.82;
    case 'polearm': return 1.08;
    case 'bowman': return targetDistance > 3.25 ? 1.55 : 0.9;
    case 'hussar': return 1.05;
    case 'armored-lancer': return 1.16;
    case 'mounted-archer': return targetDistance > 3.25 ? 1.5 : 0.9;
    case 'dog': return 1.05;
    case 'fox': return 1.4;
    case 'wolf': return 1.15;
  }
}

function combatWeaponSoundFamily(
  tool: WorkerToolKind | null,
  targetDistance: number,
): CombatWeaponSoundKind | undefined {
  if (!tool) return undefined;
  const presentation = resolveCombatWeaponPresentation(tool, targetDistance);
  switch (presentation?.family) {
    case 'spear-pike': return 'spear-pike';
    case 'sword-shield': return 'sword-sidearm';
    case 'halberd': return 'halberd-polearm';
    case 'bow': return 'bow';
    case 'crossbow': return 'crossbow';
    default: return undefined;
  }
}

export function clearCrowdCombatPresentation(renderAgent: CrowdRenderAgent): void {
  renderAgent.animationRateScale = undefined;
  renderAgent.mounted = undefined;
  renderAgent.companyStandard = undefined;
  renderAgent.battlefieldWeaponDrop = undefined;
  renderAgent.combatAttackCooldown = undefined;
  renderAgent.combatAttackSeconds = undefined;
  renderAgent.combatLocomotion = undefined;
  renderAgent.combatTargetDistance = undefined;
  renderAgent.combatTargetX = undefined;
  renderAgent.combatTargetY = undefined;
  renderAgent.combatTargetZ = undefined;
}

function cavalryHorsePresentation(combat: CombatAgentState): CavalryHorsePresentation {
  if (combat.faction === 'hussar') return 'hussar';
  if (combat.faction === 'armored-lancer') return 'lancer';
  if (combat.faction === 'mounted-archer') return 'archer';
  return 'ottoman';
}

function cavalryHorsePasturePose(
  pasture: PastureState,
  horse: CavalryHorseState,
  elapsedSeconds: number,
): {
  x: number;
  z: number;
  yaw: number;
  moveSpeed: number;
  activity: CavalryHorsePose['activity'];
} {
  const seed = horseAppearanceSeed(horse.id);
  const homeU = 0.16 + ((seed >>> 3) % 680) / 1000;
  const homeV = 0.16 + ((seed >>> 13) % 680) / 1000;
  const destinationU = 0.16 + ((seed >>> 19) % 680) / 1000;
  const destinationV = 0.16 + ((Math.imul(seed, 2654435761) >>> 11) % 680) / 1000;
  const home = pastureBilinearPoint(pasture, homeU, homeV);
  const destination = pastureBilinearPoint(pasture, destinationU, destinationV);
  let x = home.x;
  let z = home.z;
  let yaw = ((seed >>> 6) % 6283) / 1000;
  let moveSpeed = 0;
  let activity: CavalryHorsePose['activity'] = 'standing';
  const cycleSeconds = 34;
  const cycleOffset = (seed % 34_000) / 1000;
  const phase = (elapsedSeconds + cycleOffset) % cycleSeconds;
  if (phase < 7) {
    activity = 'grazing';
  } else if (phase < 15) {
    const progress = smoothHorseStep((phase - 7) / 8);
    x = THREE.MathUtils.lerp(home.x, destination.x, progress);
    z = THREE.MathUtils.lerp(home.z, destination.z, progress);
    yaw = Math.atan2(destination.x - home.x, destination.z - home.z);
    moveSpeed = 0.5;
    activity = 'walking';
  } else if (phase < 25) {
    x = destination.x;
    z = destination.z;
    activity = 'grazing';
  } else if (phase < 33) {
    const progress = smoothHorseStep((phase - 25) / 8);
    x = THREE.MathUtils.lerp(destination.x, home.x, progress);
    z = THREE.MathUtils.lerp(destination.z, home.z, progress);
    yaw = Math.atan2(home.x - destination.x, home.z - destination.z);
    moveSpeed = 0.5;
    activity = 'walking';
  }
  return {
    x,
    z,
    yaw,
    moveSpeed,
    activity,
  };
}

function pastureBilinearPoint(
  pasture: PastureState,
  u: number,
  v: number,
): PointXZ {
  const [a, b, c, d] = pasture.corners;
  const topX = THREE.MathUtils.lerp(a.x, b.x, u);
  const topZ = THREE.MathUtils.lerp(a.z, b.z, u);
  const bottomX = THREE.MathUtils.lerp(d.x, c.x, u);
  const bottomZ = THREE.MathUtils.lerp(d.z, c.z, u);
  return {
    x: THREE.MathUtils.lerp(topX, bottomX, v),
    z: THREE.MathUtils.lerp(topZ, bottomZ, v),
  };
}

function smoothHorseStep(value: number): number {
  const clamped = THREE.MathUtils.clamp(value, 0, 1);
  return clamped * clamped * (3 - 2 * clamped);
}

function horseAppearanceSeed(id: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function combatUnitName(combat: CombatAgentState): string {
  if (combat.faction === 'raider') {
    const role = combat.ottomanRole ?? 'azab';
    const roleLabel = role === 'akinci'
      ? 'Akıncı horse archer'
      : role === 'sipahi'
        ? 'Timariot sipahi'
        : role === 'janissary'
          ? 'Janissary'
          : 'Azab frontier infantry';
    return `${roleLabel} #${combat.id}`;
  }
  const label: Record<CombatAgentState['faction'], string> = {
    guard: 'Guard', raider: 'Ottoman raider', bandit: 'Bandit',
    militia: 'Militia spearman', spearman: 'Company spearman',
    'man-at-arms': 'Man-at-Arms', crossbow: 'Crossbowman',
    'mercenary-spear': 'Mercenary pikeman', footman: 'Footman',
    polearm: 'Halberdier', bowman: 'Bowman',
    hussar: 'Frontier hussar', 'armored-lancer': 'Armored lancer',
    'mounted-archer': 'Mounted archer',
    dog: 'Guard dog', fox: 'Fox', wolf: 'Wolf',
  };
  return `${label[combat.faction]} #${combat.id}`;
}

function combatFactionInitials(faction: CombatAgentState['faction']): string {
  const labels: Record<CombatAgentState['faction'], string> = {
    guard: 'G', raider: 'OR', bandit: 'B', militia: 'M', spearman: 'SP',
    'man-at-arms': 'MA', crossbow: 'CB', 'mercenary-spear': 'MS',
    footman: 'FT', polearm: 'PL', bowman: 'BW',
    hussar: 'HU', 'armored-lancer': 'AL', 'mounted-archer': 'HA',
    dog: 'GD', fox: 'FX', wolf: 'WP',
  };
  return labels[faction];
}

function combatOccupation(combat: CombatAgentState): string {
  const { faction } = combat;
  if (faction === 'raider') {
    switch (combat.ottomanRole) {
      case 'janissary': return 'Ottoman household infantry';
      case 'akinci': return 'Ottoman frontier light cavalry';
      case 'sipahi': return 'Timariot armored cavalry';
      default: return 'Ottoman provincial light infantry';
    }
  }
  const labels: Partial<Record<CombatAgentState['faction'], string>> = {
    militia: 'Town militia spearman', spearman: 'Spear company soldier',
    'man-at-arms': 'Armored sword-and-shield professional', crossbow: 'Company crossbowman',
    'mercenary-spear': 'Hired mercenary pikeman', footman: 'Shielded footman',
    polearm: 'Armor-breaking polearm soldier', bowman: 'Company bowman',
    hussar: 'Frontier light cavalryman', 'armored-lancer': 'Mail-armored cavalryman',
    'mounted-archer': 'Mounted frontier skirmisher',
    dog: 'Kennel-trained settlement guard dog', fox: 'Solitary food thief',
    wolf: 'Coordinated pack hunter',
  };
  return labels[faction] ?? 'Company soldier';
}

function combatEquipmentLabel(combat: CombatAgentState): string {
  const { faction } = combat;
  if (faction === 'raider') {
    const ranged = ottomanRaiderIsRanged(combat.sourceSlot);
    switch (combat.ottomanRole) {
      case 'janissary': return ranged
        ? 'War bow, sidearm, Ottoman cap, and disciplined field kit'
        : 'Sidearm, Ottoman cap, and disciplined field kit';
      case 'akinci': return ranged
        ? 'Composite bow, sidearm, quiver, and pasture horse'
        : 'Sidearm, small shield, and pasture horse';
      case 'sipahi': return 'Lance, sidearm, shield, mail, and trained warhorse';
      default: return ranged
        ? 'War bow, sidearm, and provincial field kit'
        : 'Spear and provincial field kit';
    }
  }
  switch (faction) {
    case 'footman': return 'Sidearm and small shield';
    case 'man-at-arms': return 'Sword, large shield, mail, and helmet';
    case 'polearm': return 'Halberd and light armor';
    case 'militia': return 'Ordinary spear and clothing';
    case 'crossbow': return 'Steel crossbow, bolt case, and padded coat';
    case 'bowman': return 'War bow, quiver, arrows, and light clothing';
    case 'mercenary-spear': return 'Long pike, Katzbalger sidearm, and field kit';
    case 'spearman': return 'Short spear, round shield, and quilted jack';
    case 'hussar': return 'Lance, sidearm, small shield, padded coat, and pasture horse';
    case 'armored-lancer': return 'Lance, sidearm, mail harness, and pasture horse';
    case 'mounted-archer': return 'Composite bow, quiver, sidearm, padded coat, and pasture horse';
    case 'bandit': return 'Ordinary spear and scavenged clothing';
    case 'dog': return 'Teeth and trained protective instinct';
    case 'fox': return 'Speed and evasive instinct';
    case 'wolf': return 'Pack hunting and powerful bite';
    default: return 'Spear, shield, and field kit';
  }
}

function combatStatusLabel(status: CombatAgentState['status']): string {
  switch (status) {
    case 'advancing': return 'Advancing';
    case 'fighting': return 'In close combat';
    case 'looting': return 'At the objective';
    case 'retreating': return 'Withdrawing';
    case 'returning': return 'Returning to company';
    case 'downed': return 'Downed';
    case 'wounded-returning': return 'Wounded and returning';
    case 'recovering': return 'Recovering';
    case 'mustering': return 'Mustering at assigned watch';
    case 'holding': return 'Holding assigned post';
  }
}

function combatActivityLabel(
  combat: CombatAgentState,
  target: string,
): string {
  switch (combat.status) {
    case 'advancing':
      return combat.faction === 'guard' || isPlayerMilitaryFaction(combat.faction)
        ? `Moving to intercept the attack near ${target}`
        : `Advancing on ${target}`;
    case 'fighting':
      return `Fighting at close quarters near ${target}`;
    case 'looting':
      return combat.raidAnchorBuildingId
        ? `Forcing the ${target.toLocaleLowerCase()} · ${combat.lootProgress.toFixed(1)} seconds in contact`
        : `Taking portable stores from ${target} · ${combat.lootProgress.toFixed(1)} seconds in contact`;
    case 'retreating':
      return combat.carryingLoot
        ? 'Withdrawing toward the frontier with captured stores'
        : 'Withdrawing toward the frontier';
    case 'returning':
      if (combat.faction === 'dog') return 'Continuing the settlement patrol';
      return combat.faction === 'bandit'
        ? combat.carryingLoot ? 'Returning to camp with stolen stores' : 'Returning to camp'
        : isPlayerMilitaryFaction(combat.faction)
          ? 'Returning to the commanded position or home'
          : 'Returning to the guardhouse after the incursion';
    case 'downed':
      return combat.faction === 'guard' || isPlayerMilitaryFaction(combat.faction)
        ? 'Downed on the battlefield and awaiting evacuation'
        : 'Downed on the battlefield';
    case 'wounded-returning':
      return 'Wounded and moving back to the guardhouse';
    case 'recovering':
      return 'Recovering at the guardhouse and unavailable for duty';
    case 'mustering':
      return `Marching to the assigned watch near ${target}`;
    case 'holding':
      return `Holding the watch line near ${target}`;
  }
}

function isAnimalCombatFaction(
  faction: CombatAgentState['faction'],
): faction is 'dog' | 'fox' | 'wolf' {
  return faction === 'dog' || faction === 'fox' || faction === 'wolf';
}

function raiderTunicColor(combat: CombatAgentState, seed: number): number {
  const colors = combat.ottomanRole === 'janissary'
    ? [0x792d2d, 0x2f4658, 0x6b593f] as const
    : combat.ottomanRole === 'akinci'
      ? [0x43593a, 0x684a31, 0x374942] as const
      : combat.ottomanRole === 'sipahi'
        ? [0x7a312d, 0x304767, 0x6a5734] as const
        : [0x694037, 0x76533a, 0x55493c, 0x6b5b3f, 0x4d4639] as const;
  return colors[(seed >>> 12) % colors.length] ?? colors[0];
}

function banditTunicColor(seed: number): number {
  const colors = [0x302c27, 0x3f352b, 0x292f2b, 0x49352b, 0x34312d] as const;
  return colors[seed % colors.length]!;
}
