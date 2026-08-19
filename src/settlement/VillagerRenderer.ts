import * as THREE from 'three';
import type { RoadNetwork } from '../roads/RoadNetwork.ts';
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
  FarmFieldState,
  ForagingNodeState,
  PastureState,
  ResourceNodeState,
  ResidenceState,
  TreeEntityState,
  TreeLayoutEntry,
} from '../resources/types.ts';
import { backyardGardenPlacement } from '../residences/backyardPosition.ts';
import { backyardGardenLabel } from '../residences/backyardGarden.ts';
import { backyardGardenPhenology } from '../economy/backyardGardenTick.ts';
import { getBuildingDefinition } from '../resources/buildings.ts';
import { buildingPlacementYaw } from '../buildings/buildingPlacement.ts';
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
import {
  DEFAULT_NIGHT_POLICY,
  isNightWorkBuilding,
  type NightPolicyState,
} from '../economy/nightPolicy.ts';
import { polylineLengthXZ, samplePolylineXZ, type PointXZ } from '../utils/pathGeometry.ts';
import type { GameClock } from '../world/gameCalendar.ts';
import type { HolidayObservance } from '../world/holidayCalendar.ts';
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
} from '../audio/CombatAudio.ts';
import {
  CROWD_SIM_DT,
  isAgentAnimalRenderingEnabled,
  isWithinCrowdView,
  type CrowdViewState,
} from './crowdView.ts';
import {
  seatedVillagerContactHeight,
  SettlementCrowdRenderer,
  type CrowdRenderAgent,
  type VillagerModelVariant,
  type VillagerRenderMode,
} from './SettlementCrowdRenderer.ts';
import {
  MAX_VILLAGERS_TOTAL,
  computeVillagerSlots,
  findNearestRoadEdgePath,
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
  pickWorkerCommutePath,
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
import type { WorkerToolKind } from './workerTools.ts';
import {
  villagerDisplayName,
  villagerOccupation,
} from './villagerIdentity.ts';
import {
  chapelAttendancePath,
  chapelGatheringPoint,
  claimMassChapelFromPoint,
  claimMassChapelsForResidences,
  isSundayMassTime,
  operationalMassChapels,
  type MassChapelClaim,
} from './chapelMass.ts';
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
import { SIM_REALTIME_RATE, STARTING_POPULATION } from '../generated/gameBalance.ts';
import {
  fireDisabledBuildingIds,
  fireDisabledResidenceIds,
  type FireIncidentState,
} from '../fires/fireIncident.ts';
import type { CombatAgentState } from '../security/combatAgents.ts';
import { COMBAT_WADING_SPEED_MULTIPLIER } from '../security/combatRiverNavigation.ts';
import {
  SELECTED_AGENT_ROUTE_Y_OFFSET,
  type SelectedAgentRoutePoint,
} from '../scene/SelectedAgentRoute.ts';
import {
  resolveWorksiteLodging,
  workLodgingDoorPosition,
  workLodgingFiresidePosition,
  type WorksiteLodging,
} from '../buildings/remoteWorkCamp.ts';
import {
  clockElapsedSeconds,
  clockSecondsIntoDay,
  commuteBandForRatio,
  commuteEffectiveShiftRatio,
  estimatePedestrianTravelSeconds,
  WORK_END_SECONDS,
  WORK_START_SECONDS,
  WORKDAY_SECONDS,
  WORKER_MINIMUM_REST_SECONDS,
  WORKER_MINIMUM_SHIFT_SECONDS,
  type WorksiteCommuteSummary,
} from './workerCommute.ts';

type VillagerMode = VillagerRenderMode;
type VillagerRole = 'founder' | 'resident' | 'worker';
type VillagerRoutinePhase =
  | 'work'
  | 'commuting_to_work'
  | 'returning_home'
  | 'remote_camp_outdoors'
  | 'remote_camp_indoors'
  | 'remote_camp_asleep'
  | 'going_to_mass'
  | 'at_mass'
  | 'returning_from_mass'
  | 'going_to_feast'
  | 'at_feast'
  | 'returning_from_feast'
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
  | 'commute_to_work'
  | 'return_home'
  | 'chapel_mass'
  | 'return_from_mass'
  | 'monastery_feast'
  | 'return_from_feast'
  | 'refuge_rally'
  | 'return_from_refuge'
  | 'guard_muster'
  | 'return_from_muster'
  | 'fire_assembly'
  | 'return_from_fire_assembly'
  | 'ambient'
  | null;

type RemoteCampPhase =
  | 'remote_camp_outdoors'
  | 'remote_camp_indoors'
  | 'remote_camp_asleep';

function isRemoteCampPhase(phase: VillagerRoutinePhase): phase is RemoteCampPhase {
  return phase === 'remote_camp_outdoors'
    || phase === 'remote_camp_indoors'
    || phase === 'remote_camp_asleep';
}

function remoteCampPhaseForHomeState(homeState: HouseholdHomeState): RemoteCampPhase {
  if (homeState === 'asleep') return 'remote_camp_asleep';
  if (homeState === 'indoors') return 'remote_camp_indoors';
  return 'remote_camp_outdoors';
}

const WORKER_ACTIVITY_SECONDS = 9.5;
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
  yaw: number;
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

function workerSlotKey(workplaceId: string, workplaceSlot: number): string {
  return `${workplaceId}:${workplaceSlot}`;
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
  workTarget: PointXZ | null;
  workStopDistance: number;
  workRemaining: number;
  workPerformed: boolean;
  idleRemaining: number;
  walkSpeed: number;
  currentMoveSpeed: number;
  massChapelId: string | null;
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
  y: number;
  yaw: number;
  simAccumulator: number;
  frozen: boolean;
  restUntilElapsedSeconds: number;
  workArrivalElapsedSeconds: number | null;
  returnRequiresRest: boolean;
  returnLodgingId: string | null;
};

export type VillagerInspection = {
  personIdentity: string;
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
};

export class VillagerRenderer {
  readonly visualAssetsReady: Promise<boolean>;
  private readonly renderer: SettlementCrowdRenderer;
  private readonly activityAudio = new WorkerActivityAudio();
  private readonly farmWorkerSongAudio = new FarmWorkerSongAudio();
  private readonly combatAudio = new CombatAudio();
  private readonly getGameSpeed: () => GameSpeed;
  private readonly getHeightAt: (x: number, z: number) => number;
  private readonly getRoadDeckY: ((x: number, z: number) => number | null) | null;
  private readonly isWaterAt: ((x: number, z: number) => boolean) | null;
  private readonly routePathAroundObstacles:
    ((path: readonly PointXZ[]) => PointXZ[] | null) | null;
  private readonly agents = new Map<string, VillagerAgent>();
  private readonly renderAgents: CrowdRenderAgent[] = [];
  private readonly renderAgentsById = new Map<string, CrowdRenderAgent>();
  private readonly workerSoundSources: WorkerActivitySoundSource[] = [];
  private readonly workerSoundSourcePool: WorkerActivitySoundSource[] = [];
  private readonly farmSongSources: FarmSongSource[] = [];
  private readonly farmSongSourcePool: FarmSongSource[] = [];
  private readonly combatAudioFighters: CombatAudioFighter[] = [];
  private readonly combatAudioFighterPool: CombatAudioFighter[] = [];
  private readonly combatAudioSourceWorkspace = createCombatAudioSourceWorkspace();
  private residences = new Map<string, ResidenceState>();
  private buildings = new Map<string, BuildingState>();
  private backyardWorksites = new Map<string, BackyardWorksite>();
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
  private activeCombatGuardSlots = new Set<string>();
  private roadNetwork: RoadNetwork | null = null;
  private clock: GameClock | null = null;
  private laborPaused = false;
  private sabbathPausedToday = false;
  private holidayObservance: HolidayObservance | null = null;
  private lastScheduleElapsedSeconds: number | null = null;
  private lastRoutineClockTotalDays = Number.NaN;
  private lastRoutineClockHour = Number.NaN;
  private lastRoutineClockMinute = Number.NaN;
  private lastRoutineClockMonth = Number.NaN;
  private lastRoutineClockMonthDay = Number.NaN;
  private lastRoutineClockIsSunday: boolean | null = null;
  private lastRoutineClockIsWorkHours: boolean | null = null;
  private lastRoutineLaborPaused: boolean | null = null;
  private lastRoutineNightWatch = Number.NaN;
  private lastRoutineNightGathering = Number.NaN;
  private lastRoutineNightWork = Number.NaN;
  private lastRoutineNightCurfew = Number.NaN;
  private lastRoutineMonasteryFeastsEnabled: boolean | null = null;
  private lastRoutineSabbathPausedToday: boolean | null = null;
  private lastRoutineHolidaySignature = '';
  private commuteEstimateNetwork: RoadNetwork | null = null;
  private commuteEstimateTopologyRevision = -1;
  private readonly workerCommuteEstimateCache = new Map<
    string,
    { key: string; seconds: number }
  >();
  private nightPolicy: NightPolicyState = { ...DEFAULT_NIGHT_POLICY };
  private lastView: CrowdViewState | undefined;
  private inspectedAgentCache: VillagerAgent | null = null;

  constructor(options: VillagerRendererOptions) {
    this.getGameSpeed = options.getGameSpeed;
    this.getHeightAt = options.getHeightAt;
    this.getRoadDeckY = options.getRoadDeckY ?? null;
    this.isWaterAt = options.isWaterAt ?? null;
    this.routePathAroundObstacles = options.routePathAroundObstacles ?? null;
    this.renderer = new SettlementCrowdRenderer({ parent: options.parent });
    this.visualAssetsReady = this.renderer.ready;
  }

  beginFirstPlayableGpuPrewarm(): () => void {
    return this.renderer.beginFirstPlayableGpuPrewarm();
  }

  setSchedule(
    clock: GameClock,
    laborPaused: boolean,
    nightPolicy: NightPolicyState = DEFAULT_NIGHT_POLICY,
    monasteryFeastsEnabled = true,
    sabbathPausedToday = false,
    holidayObservance: HolidayObservance | null = null,
  ): void {
    const scheduleElapsed = clockElapsedSeconds(clock);
    const scheduleRewound = this.lastScheduleElapsedSeconds != null
      && scheduleElapsed + 1 < this.lastScheduleElapsedSeconds;
    if (scheduleRewound) {
      // Deterministic QA fixtures and world reconnects may replace the clock
      // with an earlier snapshot; stale rest deadlines must not survive it.
      for (const agent of this.agents.values()) {
        agent.restUntilElapsedSeconds = Math.min(
          agent.restUntilElapsedSeconds,
          scheduleElapsed,
        );
        agent.workArrivalElapsedSeconds = null;
      }
    }
    const holidaySignature = holidayObservance
      ? `${holidayObservance.historicalYear}:${holidayObservance.id}`
      : '';
    const restDayPausedToday = sabbathPausedToday || holidayObservance !== null;
    const fullRoutinePass = scheduleRewound
      || this.lastRoutineClockTotalDays !== clock.totalDays
      || this.lastRoutineClockHour !== clock.hour
      || this.lastRoutineClockMinute !== clock.minute
      || this.lastRoutineClockMonth !== clock.month
      || this.lastRoutineClockMonthDay !== clock.monthDay
      || this.lastRoutineClockIsSunday !== clock.isSunday
      || this.lastRoutineClockIsWorkHours !== clock.isWorkHours
      || this.lastRoutineLaborPaused !== laborPaused
      || this.lastRoutineNightWatch !== nightPolicy.watch
      || this.lastRoutineNightGathering !== nightPolicy.gathering
      || this.lastRoutineNightWork !== nightPolicy.work
      || this.lastRoutineNightCurfew !== nightPolicy.curfew
      || this.lastRoutineMonasteryFeastsEnabled !== monasteryFeastsEnabled
      || this.lastRoutineSabbathPausedToday !== restDayPausedToday
      || this.lastRoutineHolidaySignature !== holidaySignature;
    this.lastRoutineClockTotalDays = clock.totalDays;
    this.lastRoutineClockHour = clock.hour;
    this.lastRoutineClockMinute = clock.minute;
    this.lastRoutineClockMonth = clock.month;
    this.lastRoutineClockMonthDay = clock.monthDay;
    this.lastRoutineClockIsSunday = clock.isSunday;
    this.lastRoutineClockIsWorkHours = clock.isWorkHours;
    this.lastRoutineLaborPaused = laborPaused;
    this.lastRoutineNightWatch = nightPolicy.watch;
    this.lastRoutineNightGathering = nightPolicy.gathering;
    this.lastRoutineNightWork = nightPolicy.work;
    this.lastRoutineNightCurfew = nightPolicy.curfew;
    this.lastRoutineMonasteryFeastsEnabled = monasteryFeastsEnabled;
    this.lastRoutineSabbathPausedToday = restDayPausedToday;
    this.lastRoutineHolidaySignature = holidaySignature;
    this.lastScheduleElapsedSeconds = scheduleElapsed;
    this.clock = clock;
    this.laborPaused = laborPaused;
    this.nightPolicy = nightPolicy;
    this.monasteryFeastsEnabled = monasteryFeastsEnabled;
    this.sabbathPausedToday = restDayPausedToday;
    this.holidayObservance = holidayObservance;
    let changed = false;
    for (const agent of this.agents.values()) {
      // Residents and founders only observe minute-resolution home, mass, and
      // feast schedules. Workers additionally have precise commute/rest
      // deadlines, so they remain eligible between discrete clock changes.
      if (!fullRoutinePass && agent.role !== 'worker') continue;
      changed = this.reconcileRoutine(agent) || changed;
    }
    if (changed) {
      this.syncCampAmbientAssignments();
      this.syncChapelAmbientAssignments();
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
    let changed = false;
    for (const agent of this.agents.values()) {
      changed = this.reconcileRoutine(agent) || changed;
    }
    if (changed) this.pushRenderState();
  }

  setCombatAgents(agents: ReadonlyMap<string, CombatAgentState>): void {
    const nextVisuals = new Map<string, CombatAgentVisual>();
    const nextGuardSlots = new Set<string>();
    for (const state of agents.values()) {
      const prior = this.combatAgentVisuals.get(state.id);
      nextVisuals.set(state.id, {
        state,
        displayX: prior?.displayX ?? state.x,
        displayZ: prior?.displayZ ?? state.z,
        yaw: prior?.yaw ?? Math.atan2(
          state.x - state.homeX,
          state.z - state.homeZ,
        ),
      });
      if (state.faction === 'guard' && state.sourceBuildingId) {
        nextGuardSlots.add(
          combatGuardSlotKey(state.sourceBuildingId, state.sourceSlot),
        );
      }
    }
    for (const id of this.combatAgentVisuals.keys()) {
      if (!agents.has(id)) this.renderAgentsById.delete(`combat:${id}`);
    }
    this.combatAgentVisuals = nextVisuals;
    this.activeCombatGuardSlots = nextGuardSlots;
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
      if (!rerouted || polylineLengthXZ(rerouted.path) < 0.05) {
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
    backyardGardens?: Iterable<BackyardGardenState>;
    burgageZones?: Iterable<BurgageZoneState>;
    deliveryTrips?: Iterable<DeliveryTripState>;
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
    const backyardGardens = [...(options.backyardGardens ?? [])];
    const burgageZones = [...(options.burgageZones ?? [])];
    const fireIncidents = [...(options.fireIncidents ?? [])];
    const disabledBuildingIds = fireDisabledBuildingIds(fireIncidents);
    this.fireDisabledBuildingIds = disabledBuildingIds;
    this.fireDisabledResidenceIds = fireDisabledResidenceIds(fireIncidents);
    this.residences = new Map(residences.map((residence) => [residence.id, residence]));
    this.buildings = new Map(buildings.map((building) => [building.id, building]));
    const month = options.foragingMonth ?? this.clock?.month ?? 1;
    const zonesById = new Map(burgageZones.map((zone) => [zone.id, zone]));
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
    const topologyRevision = options.roadNetwork?.getTopologyRevision() ?? -1;
    if (
      this.commuteEstimateNetwork !== options.roadNetwork
      || this.commuteEstimateTopologyRevision !== topologyRevision
    ) {
      this.workerCommuteEstimateCache.clear();
      this.commuteEstimateNetwork = options.roadNetwork;
      this.commuteEstimateTopologyRevision = topologyRevision;
    }
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
      options.deliveryTrips ?? [],
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
          y: 0,
          yaw: residence.yaw,
          simAccumulator: 0,
          frozen: false,
          restUntilElapsedSeconds: 0,
          workArrivalElapsedSeconds: null,
          returnRequiresRest: false,
          returnLodgingId: null,
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
            y: 0,
            yaw: residence.yaw,
            simAccumulator: 0,
            frozen: false,
            restUntilElapsedSeconds: 0,
            workArrivalElapsedSeconds: null,
            returnRequiresRest: false,
            returnLodgingId: null,
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
      foragingMonth: options.foragingMonth,
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
        const yard = this.workerDutyPosition(building, assignment.slotIndex);
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
          routinePhase: 'work',
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
          refugeId: null,
          refugeSlot: -1,
          musterTowerId: null,
          musterSlot: -1,
          appearanceSeed,
          modelVariant: pickVillagerModelVariant(appearanceSeed),
          tunicColor: colors.tunic,
          skinColor: colors.skin,
          hairColor: pickVillagerHairColor(appearanceSeed),
          idleOffset: pickIdleOffset(assignment.personIdentity, assignment.slotIndex),
          pathSeed: appearanceSeed ^ 0x27d4eb2d,
          idleDirty: true,
          nearestEdge: null,
          x: yard.x,
          z: yard.z,
          y: 0,
          yaw: yard.yaw,
          simAccumulator: 0,
          frozen: false,
          restUntilElapsedSeconds: 0,
          workArrivalElapsedSeconds: null,
          returnRequiresRest: false,
          returnLodgingId: null,
        };
        this.agents.set(assignment.id, agent);
      } else {
        const previousHomeResidenceId = agent.residenceId;
        agent.personIdentity = assignment.personIdentity;
        agent.role = 'worker';
        agent.isSick = false;
        agent.residenceId = assignment.homeResidenceId;
        agent.workplaceId = assignment.buildingId;
        agent.workplaceSlot = assignment.slotIndex;
        agent.slotIndex = assignment.slotIndex;
        agent.nearestEdge = null;
        if (agent.appearanceSeed !== appearanceSeed) {
          const colors = pickVillagerColors(appearanceSeed);
          agent.appearanceSeed = appearanceSeed;
          agent.modelVariant = pickVillagerModelVariant(appearanceSeed);
          agent.tunicColor = colors.tunic;
          agent.skinColor = colors.skin;
          agent.hairColor = pickVillagerHairColor(appearanceSeed);
          agent.walkSpeed = pickWalkSpeed(appearanceSeed);
        }
        const previousBuilding = previousBuildings.get(assignment.buildingId);
        if (
          previousHomeResidenceId !== assignment.homeResidenceId
          || !previousBuilding
          || previousBuilding.x !== building.x
          || previousBuilding.z !== building.z
          || !sameDutyPosition(
            previousMarketStallDuties.get(workerSlotKey(building.id, assignment.slotIndex)),
            this.marketStallDutyByWorker.get(workerSlotKey(building.id, assignment.slotIndex)),
          )
        ) {
          agent.idleDirty = true;
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
          y: 0,
          yaw: 0,
          simAccumulator: 0,
          frozen: false,
          restUntilElapsedSeconds: 0,
          workArrivalElapsedSeconds: null,
          returnRequiresRest: false,
          returnLodgingId: null,
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
      this.workerCommuteEstimateCache.delete(id);
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
      for (const agent of this.agents.values()) {
        this.reconcileRoutine(agent);
      }
    }

    this.syncCampAmbientAssignments();
    this.syncChapelAmbientAssignments();
    this.pushRenderState();
  }

  tick(dt: number, view?: CrowdViewState): boolean {
    this.lastView = view;
    const realDt = Math.max(0, dt);
    const simulationDt = realDt * this.getGameSpeed() * SIM_REALTIME_RATE;
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
      const commuteMustAdvance = agent.pathPurpose === 'return_home'
        || agent.pathPurpose === 'commute_to_work'
        || agent.pathPurpose === 'chapel_mass'
        || agent.pathPurpose === 'return_from_mass'
        || agent.pathPurpose === 'monastery_feast'
        || agent.pathPurpose === 'return_from_feast'
        || agent.pathPurpose === 'refuge_rally'
        || agent.pathPurpose === 'return_from_refuge'
        || agent.pathPurpose === 'guard_muster'
        || agent.pathPurpose === 'return_from_muster'
        || agent.pathPurpose === 'fire_assembly'
        || agent.pathPurpose === 'return_from_fire_assembly';
      if (agent.frozen && !commuteMustAdvance) continue;

      agent.simAccumulator += simulationDt;
      while (agent.simAccumulator >= CROWD_SIM_DT) {
        this.simStep(agent, CROWD_SIM_DT);
        agent.simAccumulator -= CROWD_SIM_DT;
      }

      this.interpolateDisplay(agent, simulationDt);
      this.syncDisplayPose(agent);
      agent.y = this.resolveAgentY(agent);
    }

    this.releaseVacatedCampSeats();
    this.pushRenderState(view, simulationDt, simulationDt > 0 ? realDt : 0);
    return this.renderer.consumeShadowCastersChanged();
  }

  pickVillager(
    clientX: number,
    clientY: number,
    camera: THREE.Camera,
    domElement: HTMLElement,
  ): VillagerInspection | null {
    if (!isAgentAnimalRenderingEnabled(this.lastView)) return null;
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

  inspectVillager(personIdentity: string): VillagerInspection | null {
    if (personIdentity.startsWith('combat:')) {
      const visual = this.combatAgentVisuals.get(personIdentity.slice('combat:'.length));
      return visual ? this.describeCombatAgent(visual) : null;
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

  getWorksiteCommuteSummary(buildingId: string): WorksiteCommuteSummary | null {
    const workplace = this.buildings.get(buildingId);
    if (!workplace) return null;
    const lodging = resolveWorksiteLodging(
      workplace,
      this.buildings.values(),
      this.fireDisabledBuildingIds,
    );
    let measuredWorkers = 0;
    let totalDistance = 0;
    let longestDistance = 0;
    let totalSeconds = 0;
    let longestSeconds = 0;

    for (const agent of this.agents.values()) {
      if (agent.role !== 'worker' || agent.workplaceId !== buildingId) continue;
      const residence = agent.residenceId
        ? this.residences.get(agent.residenceId) ?? null
        : null;
      const origin = residence
        ? residenceDoorPosition(residence)
        : this.foundingCamp
          ? this.foundingCampRestPosition(agent, this.foundingCamp)
          : null;
      if (!origin) continue;
      const destination = this.workerDutyPosition(workplace, agent.workplaceSlot);
      const path = pickWorkerCommutePath(origin, destination, this.roadNetwork);
      if (!path) continue;
      const distance = polylineLengthXZ(path);
      const seconds = estimatePedestrianTravelSeconds(
        path,
        agent.walkSpeed,
        this.roadNetwork,
      );
      measuredWorkers += 1;
      totalDistance += distance;
      longestDistance = Math.max(longestDistance, distance);
      totalSeconds += seconds;
      longestSeconds = Math.max(longestSeconds, seconds);
    }

    const averageSeconds = measuredWorkers > 0 ? totalSeconds / measuredWorkers : 0;
    const effectiveShiftRatio = lodging
      ? 1
      : commuteEffectiveShiftRatio(averageSeconds);
    return {
      workerCount: workplace.assignedLabor,
      measuredWorkers,
      averageOneWayDistance: measuredWorkers > 0 ? totalDistance / measuredWorkers : 0,
      longestOneWayDistance: longestDistance,
      averageOneWaySeconds: averageSeconds,
      longestOneWaySeconds: longestSeconds,
      effectiveShiftRatio,
      band: commuteBandForRatio(lodging ? 0 : averageSeconds * 2 / WORKDAY_SECONDS),
      lodgingMode: lodging?.mode ?? 'none',
    };
  }

  dispose(): void {
    this.inspectedAgentCache = null;
    this.agents.clear();
    this.renderAgents.length = 0;
    this.renderAgentsById.clear();
    this.workerSoundSources.length = 0;
    this.workerSoundSourcePool.length = 0;
    this.farmSongSources.length = 0;
    this.farmSongSourcePool.length = 0;
    this.combatAudioFighters.length = 0;
    this.combatAudioFighterPool.length = 0;
    this.combatAudioSourceWorkspace.guards.length = 0;
    this.combatAudioSourceWorkspace.raiders.length = 0;
    this.combatAudioSourceWorkspace.sources.length = 0;
    this.combatAudioSourceWorkspace.sourcePool.length = 0;
    this.combatAudioSourceWorkspace.sourceFirstIds.length = 0;
    this.combatAudioSourceWorkspace.sourceSecondIds.length = 0;
    this.workerCommuteEstimateCache.clear();
    this.activityAudio.dispose();
    this.farmWorkerSongAudio.dispose();
    this.combatAudio.dispose();
    this.renderer.dispose();
  }

  private describeAgent(agent: VillagerAgent): VillagerInspection {
    const workplace = agent.workplaceId
      ? this.buildings.get(agent.workplaceId) ?? null
      : null;
    const residence = agent.residenceId
      ? this.residences.get(agent.residenceId) ?? null
      : null;
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
        || agent.routinePhase === 'commuting_to_work'
      );

    return {
      personIdentity: agent.personIdentity,
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
          ),
      activityState: onDuty ? 'active' : 'ready',
      workplaceLabel: 'Workplace',
      workplace: workplace
        ? isResidenceUpgradeWorkplaceId(workplace.id)
          ? upgradeWorkplaceLabel
          : getBuildingDefinition(workplace.kind).label
        : 'Unassigned',
      householdLabel: 'Household',
      household: residence
        ? `Tier ${residence.tier} home · ${residence.population} ${
          residence.population === 1 ? 'resident' : 'residents'
        }`
        : agent.role === 'founder' || this.foundingCamp
          ? "Founders' camp · no fixed household"
          : 'No fixed household',
      crewLabel: 'Crew',
      crew: agent.isSick
        ? 'Unavailable to the labor pool'
        : workplace
        ? `${workplace.assignedLabor} / ${
          isResidenceUpgradeWorkplaceId(workplace.id)
            ? 1
            : getBuildingDefinition(workplace.kind).maxLabor
        } assigned`
        : 'Free labor pool',
      paceLabel: 'Walking pace',
      pace: `${agent.walkSpeed.toFixed(1)} m/s off-road · ${
        (agent.walkSpeed * PEDESTRIAN_ROAD_SPEED_MULTIPLIER).toFixed(1)
      } m/s on roads`,
      position: { x: agent.x, y: agent.y, z: agent.z },
      route: this.inspectionRoute(agent, workplace),
      visible: this.isVisibleAgent(agent),
    };
  }

  private inspectionRoute(
    agent: VillagerAgent,
    workplace: BuildingState | null,
  ): SelectedAgentRoutePoint[] {
    let route: PointXZ[] = [];
    if (agent.pathPurpose && agent.path.length >= 2) {
      route = remainingPolyline(
        agent.path,
        Math.min(agent.pathDistance, agent.displayPathCursor),
      );
      if (route.length > 0) route[0] = { x: agent.x, z: agent.z };
    } else if (
      agent.role === 'worker'
      && workplace
      && !this.fireDisabledBuildingIds.has(workplace.id)
    ) {
      const destination = agent.routinePhase === 'work'
        ? this.workerRestDestination(agent, workplace)
        : this.workerDutyPosition(workplace, agent.workplaceSlot);
      const commute = destination
        ? pickWorkerCommutePath(
            { x: agent.x, z: agent.z },
            destination,
            this.roadNetwork,
          )
        : null;
      route = commute ? this.routePath(commute) ?? [] : [];
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
    const ordinaryGuard = combat.faction === 'guard' && combat.sourceBuildingId
      ? this.agents.get(
          `worker:${combat.sourceBuildingId}:${combat.sourceSlot}`,
        ) ?? null
      : null;
    const guardhouse = combat.sourceBuildingId
      ? this.buildings.get(combat.sourceBuildingId) ?? null
      : null;
    const personIdentity = `combat:${combat.id}`;
    const name = ordinaryGuard
      ? villagerDisplayName(
          ordinaryGuard.personIdentity,
          ordinaryGuard.modelVariant,
        )
      : combat.faction === 'guard'
        ? `Guard #${combat.id}`
        : `Ottoman raider #${combat.id}`;
    const status = combatStatusLabel(combat.status);
    const target = this.combatTargetLabel(combat);
    const activity = combatActivityLabel(combat, target);
    const health = `${Math.ceil(combat.health)} / ${Math.ceil(combat.maxHealth)}`;
    const equipment = combat.faction === 'guard'
      ? combat.issuedPolearms > 0
        ? `Polearm issued · readiness ${Math.round(combat.readiness * 100)}%`
        : `Unarmed · readiness ${Math.round(combat.readiness * 100)}%`
      : combat.carryingLoot
        ? 'Spear · carrying stolen stores'
        : 'Spear · no captured stores';
    const y = this.resolveGroundY(visual.displayX, visual.displayZ) + 0.02;
    return {
      personIdentity,
      modelVariant: ordinaryGuard?.modelVariant ?? 'man',
      name,
      initials: ordinaryGuard
        ? name
            .split(/\s+/)
            .slice(0, 2)
            .map((part) => part[0] ?? '')
            .join('')
            .toLocaleUpperCase()
        : combat.faction === 'guard'
          ? 'G'
          : 'OR',
      eyebrow: combat.faction === 'guard'
        ? `Defender · ${status}`
        : `Raider · ${status}`,
      occupation: combat.faction === 'guard'
        ? 'Guard company spearman'
        : 'Ottoman frontier raider',
      activity,
      activityState: combat.status === 'recovering' ? 'ready' : 'active',
      workplaceLabel: combat.faction === 'guard' ? 'Company' : 'Warband',
      workplace: guardhouse
        ? getBuildingDefinition(guardhouse.kind).label
        : 'Incursion party',
      householdLabel: 'Objective',
      household: target,
      crewLabel: 'Condition',
      crew: `${health} health`,
      paceLabel: combat.faction === 'guard' ? 'Equipment' : 'Arms and spoils',
      pace: equipment,
      position: { x: visual.displayX, y, z: visual.displayZ },
      route: [],
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
    return 'Moving supply cart';
  }

  private isVisibleAgent(agent: VillagerAgent): boolean {
    if (
      agent.routinePhase === 'indoors'
      || agent.routinePhase === 'asleep'
      || agent.routinePhase === 'remote_camp_indoors'
      || agent.routinePhase === 'remote_camp_asleep'
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

  private pushRenderState(
    view?: CrowdViewState,
    animationDt = 0,
    audioDt = animationDt,
  ): void {
    const renderAgents = this.renderAgents;
    renderAgents.length = 0;
    if (audioDt > 0) {
      this.workerSoundSources.length = 0;
      this.farmSongSources.length = 0;
      this.combatAudioFighters.length = 0;
    }
    let slot = 0;
    for (const agent of this.agents.values()) {
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
        || agent.routinePhase === 'remote_camp_indoors'
        || agent.routinePhase === 'remote_camp_asleep'
      ) {
        continue;
      }
      const renderAgent = this.renderAgentFor(agent.id);
      renderAgent.slot = slot++;
      renderAgent.x = agent.x;
      renderAgent.y = agent.y;
      renderAgent.z = agent.z;
      renderAgent.yaw = agent.yaw;
      renderAgent.appearanceSeed = agent.appearanceSeed;
      renderAgent.variant = agent.modelVariant;
      renderAgent.mode = agent.mode;
      renderAgent.tunicColor = agent.tunicColor;
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
    for (const visual of this.combatAgentVisuals.values()) {
      const combat = visual.state;
      const ordinaryGuard = combat.faction === 'guard' && combat.sourceBuildingId
        ? this.agents.get(
            `worker:${combat.sourceBuildingId}:${combat.sourceSlot}`,
          )
        : null;
      const appearanceSeed = ordinaryGuard?.appearanceSeed
        ?? combatAppearanceSeed(combat);
      const colors = pickVillagerColors(appearanceSeed);
      const target = this.nearestCombatOpponent(combat);
      const isWading = this.isWaterAt?.(visual.displayX, visual.displayZ) === true
        && this.getRoadDeckY?.(visual.displayX, visual.displayZ) == null;
      const yaw = target
        ? Math.atan2(
            target.displayX - visual.displayX,
            target.displayZ - visual.displayZ,
          )
        : visual.yaw;
      const renderAgent = this.renderAgentFor(`combat:${combat.id}`);
      renderAgent.slot = slot++;
      renderAgent.x = visual.displayX;
      renderAgent.y = this.resolveGroundY(visual.displayX, visual.displayZ) + 0.02;
      renderAgent.z = visual.displayZ;
      renderAgent.yaw = yaw;
      renderAgent.appearanceSeed = appearanceSeed;
      renderAgent.variant = ordinaryGuard?.modelVariant ?? 'man';
      renderAgent.mode = combatRenderMode(
        combat.status,
        combat.targetKind !== 'cart',
      );
      renderAgent.tunicColor = ordinaryGuard?.tunicColor
        ?? (combat.faction === 'raider'
          ? raiderTunicColor(appearanceSeed)
          : colors.tunic);
      renderAgent.skinColor = ordinaryGuard?.skinColor ?? colors.skin;
      renderAgent.hairColor = ordinaryGuard?.hairColor
        ?? pickVillagerHairColor(appearanceSeed);
      renderAgent.tool = 'spear';
      renderAgent.movementSpeed = (combat.status === 'wounded-returning'
        ? 0.68
        : combat.faction === 'guard'
          ? 1.42
          : 1.34) * (isWading ? COMBAT_WADING_SPEED_MULTIPLIER : 1);
      renderAgent.active = true;
      renderAgents.push(renderAgent);
      if (audioDt > 0) this.pushCombatAudioFighter(visual);
    }
    const activeView = view ?? this.lastView;
    this.renderer.syncAgents(renderAgents, activeView, animationDt);
    if (audioDt > 0) {
      this.combatAudio.tick(
        audioDt,
        buildCombatAudioSources(
          this.combatAudioFighters,
          this.combatAudioSourceWorkspace,
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
    } else if (this.getGameSpeed() === 0) {
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
    const blend = 1 - Math.exp(-Math.min(0.1, Math.max(0, realDt)) * 14);
    for (const visual of this.combatAgentVisuals.values()) {
      const previousX = visual.displayX;
      const previousZ = visual.displayZ;
      visual.displayX += (visual.state.x - visual.displayX) * blend;
      visual.displayZ += (visual.state.z - visual.displayZ) * blend;
      const dx = visual.displayX - previousX;
      const dz = visual.displayZ - previousZ;
      if (dx * dx + dz * dz > 1e-8) {
        visual.yaw = Math.atan2(dx, dz);
      }
    }
  }

  private nearestCombatOpponent(
    combat: CombatAgentState,
  ): CombatAgentVisual | null {
    if (combat.status !== 'fighting') return null;
    let nearest: CombatAgentVisual | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;
    const source = this.combatAgentVisuals.get(combat.id);
    if (!source) return null;
    for (const candidate of this.combatAgentVisuals.values()) {
      if (
        candidate.state.faction === combat.faction
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
    const mode = renderAgent.mode === 'chop'
      || renderAgent.mode === 'mine'
      ? renderAgent.mode
      : renderAgent.mode === 'build'
        ? workplace?.kind === 'smithy'
          ? null
          : 'build'
      : renderAgent.mode === 'plant'
        ? 'dig'
        : renderAgent.mode === 'fish'
          ? 'fish'
          : renderAgent.mode === 'gather'
            ? 'forage'
            : renderAgent.mode === 'tend'
              ? workplace?.kind === 'charcoal_burner'
                ? 'dig'
                : workplace?.kind === 'threshing_barn'
                ? 'cut_crop'
                : workplace?.kind === 'pastoral_farmstead'
                  || workplace?.kind === 'swineherd'
                  ? 'livestock'
                  : null
              : null;
    return mode;
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

  private pushCombatAudioFighter(visual: CombatAgentVisual): void {
    const fighterIndex = this.combatAudioFighters.length;
    let fighter = this.combatAudioFighterPool[fighterIndex];
    if (!fighter) {
      fighter = {
        id: visual.state.id,
        faction: visual.state.faction,
        status: visual.state.status,
        health: visual.state.health,
        x: visual.displayX,
        z: visual.displayZ,
      };
      this.combatAudioFighterPool.push(fighter);
    } else {
      fighter.id = visual.state.id;
      fighter.faction = visual.state.faction;
      fighter.status = visual.state.status;
      fighter.health = visual.state.health;
      fighter.x = visual.displayX;
      fighter.z = visual.displayZ;
    }
    this.combatAudioFighters.push(fighter);
  }

  private simStep(agent: VillagerAgent, dt: number): void {
    if (
      agent.mode === 'chop'
      || agent.mode === 'mine'
      || agent.mode === 'gather'
      || agent.mode === 'plant'
      || agent.mode === 'sow'
      || agent.mode === 'fish'
      || agent.mode === 'tend'
      || agent.mode === 'build'
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

    if (
      agent.mode === 'sit'
      || agent.mode === 'rest'
      || agent.mode === 'talk'
    ) {
      agent.currentMoveSpeed = 0;
      return;
    }

    if (agent.mode === 'idle') {
      agent.currentMoveSpeed = 0;
      if (agent.ambientBehavior) return;
      agent.idleRemaining -= dt;
      if (agent.idleRemaining <= 0) {
        if (agent.routinePhase === 'work' && agent.role === 'worker') {
          this.tryBeginWorkerWalk(agent);
        } else if (agent.routinePhase === 'home_outdoors') {
          if (agent.role !== 'founder' && !this.holidayObservance) {
            const residence = agent.residenceId ? this.residences.get(agent.residenceId) : null;
            if (residence && !this.tryBeginBackyardWork(agent, residence)) {
              if (agent.role === 'resident') this.tryBeginWalk(agent, residence);
              else agent.idleRemaining = pickIdleDuration(agent.pathSeed) * 0.7;
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
    );
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
        case 'commute_to_work':
          this.completeWorkerCommuteToWork(agent);
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
    if (agent.mode !== 'walk') return;
    const blend = 1 - Math.exp(-dt * 18);
    agent.displayPathCursor += (agent.simPathCursor - agent.displayPathCursor) * blend;
  }

  private syncDisplayPose(agent: VillagerAgent): void {
    if (agent.mode === 'walk') {
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
      || agent.routinePhase === 'at_refuge'
      || agent.routinePhase === 'at_muster'
    ) {
      return;
    }
    const residence = agent.residenceId ? this.residences.get(agent.residenceId) : null;
    if (residence) agent.yaw = residence.yaw + agent.idleOffset.yaw;
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
    agent.mode = agent.workActivity;
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

  private tryBeginWalk(agent: VillagerAgent, residence: ResidenceState): void {
    if (!this.roadNetwork || this.roadNetwork.edges.size === 0) {
      agent.idleRemaining = pickIdleDuration(agent.pathSeed);
      return;
    }

    const candidatePath = pickVillagerWalkPath(
      residence,
      [...this.residences.values()],
      this.roadNetwork,
      agent.pathSeed,
      agent.nearestEdge,
    );
    agent.pathSeed = (agent.pathSeed * 1_664_525) ^ 0x7feb352d;

    const path = candidatePath ? this.routePath(candidatePath) : null;
    const pathDistance = path ? polylineLengthXZ(path) : 0;
    if (!path || pathDistance < 4) {
      agent.idleRemaining = pickIdleDuration(agent.pathSeed);
      return;
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
    const targets = this.workerTargets.get(building.id) ?? [];
    const plan = pickWorkerWalkPlan(
      building,
      agent.workplaceSlot,
      targets,
      agent.pathSeed,
    );
    agent.pathSeed = (agent.pathSeed * 1_664_525) ^ 0x165667b1;

    const routedPlan = plan
      ? this.routeWorkerPath(plan.path, plan.workDistance)
      : null;
    const path = routedPlan?.path ?? null;
    const pathDistance = path ? polylineLengthXZ(path) : 0;
    if (!path || pathDistance < 4) {
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
    agent.workTarget = plan?.target
      ? { x: plan.target.x, z: plan.target.z }
      : null;
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
    if (seed % 3 !== 0) return false;
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
      && this.shouldWorkerReportToWork(agent, workplace);
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
      && !(workplace && resolveWorksiteLodging(
        workplace,
        this.buildings.values(),
        this.fireDisabledBuildingIds,
      ))
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
        ? this.beginWorkerCommuteToWork(agent)
        : this.beginFireAssemblyReturn(agent);
    }
    if (agent.routinePhase === 'returning_from_fire_assembly') {
      return shouldWork
        ? this.beginWorkerCommuteToWork(agent)
        : false;
    }

    if (agent.isSick) {
      return this.transitionToSickRest(agent);
    }

    const homeState = householdMemberHomeState(
      agent.personIdentity,
      this.clock,
      this.nightPolicy,
    );
    const chapel = this.findMassChapel(agent);
    const shouldAttendMass = isSundayMassTime(
      this.clock,
      chapel != null,
    ) || Boolean(
      chapel
      && this.holidayObservance
      && holidayChapelActivityFor(
        this.clock,
        this.holidayObservance,
        agent.personIdentity,
      ),
    );

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
      return this.beginMassReturn(agent);
    }
    if (agent.routinePhase === 'returning_from_mass') return false;

    const feastMonastery = this.findFeastMonastery(agent);
    const shouldAttendFeast = isMonasteryFeastGatheringTime(
      this.clock,
      this.monasteryFeastsEnabled && !this.frontierAlertActive,
      feastMonastery != null,
    );
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

    // Worksite lodging covers the working week, not the observed Sabbath.
    // Replan even an already-started trip so nobody reaches the tents only
    // to turn around for their household or the founders camp.
    if (
      this.sabbathPausedToday
      && agent.role === 'worker'
      && (
        isRemoteCampPhase(agent.routinePhase)
        || agent.pathPurpose === 'commute_to_work'
        || (
          agent.pathPurpose === 'return_home'
          && agent.returnLodgingId != null
        )
      )
    ) {
      return this.beginWorkerReturnHome(agent);
    }

    // Ordinary schedule changes never reverse a journey already under way.
    // Emergencies and explicit religious gatherings may still preempt it.
    if (
      agent.pathPurpose === 'return_home'
      || agent.pathPurpose === 'commute_to_work'
    ) {
      return false;
    }

    if (agent.role === 'founder') {
      return this.transitionToHomeState(agent, 'home_outdoors');
    }

    if (agent.role === 'worker') {
      if (shouldWork) {
        if (agent.routinePhase === 'work' || agent.routinePhase === 'commuting_to_work') {
          return false;
        }
        return this.beginWorkerCommuteToWork(agent);
      }

      if (agent.routinePhase === 'returning_home') return false;
      if (agent.routinePhase === 'work' || agent.routinePhase === 'commuting_to_work') {
        return this.beginWorkerReturnHome(agent);
      }
      if (workplace && this.workerWorksiteLodging(workplace)) {
        if (isRemoteCampPhase(agent.routinePhase)) {
          return this.transitionToRemoteCampState(agent, homeState, workplace);
        }
      }
      if (isRemoteCampPhase(agent.routinePhase)) {
        return this.beginWorkerReturnHome(agent);
      }
    }

    return this.transitionToHomeState(agent, homeState);
  }

  private shouldWorkerReportToWork(
    agent: VillagerAgent,
    workplace: BuildingState | null,
  ): boolean {
    if (
      !this.clock
      || !workplace
      || this.fireDisabledBuildingIds.has(workplace.id)
    ) {
      return false;
    }
    if (this.holidayObservance) return false;
    if (
      this.isNightWatchDuty(agent, workplace)
      || (
        !this.clock.isWorkHours
        && workplace.constructionComplete !== false
        && isNightWorkBuilding(workplace.kind, this.nightPolicy.work)
        && !this.frontierAlertActive
      )
    ) {
      return true;
    }

    const elapsed = clockElapsedSeconds(this.clock);
    if (elapsed + 1e-6 < agent.restUntilElapsedSeconds) return false;

    const secondsIntoDay = clockSecondsIntoDay(this.clock);
    const atWork = agent.routinePhase === 'work';
    const travelSeconds = this.estimateWorkerCommuteSeconds(agent, workplace);
    const weeklyReturnToLodging = this.workerWorksiteLodging(workplace) != null
      && !atWork
      && !isRemoteCampPhase(agent.routinePhase);
    const minimumUsefulShift = weeklyReturnToLodging
      ? 0
      : WORKER_MINIMUM_SHIFT_SECONDS;

    if (secondsIntoDay < WORK_START_SECONDS) {
      if (this.sabbathPausedToday) return false;
      const untilWork = WORK_START_SECONDS - secondsIntoDay;
      return travelSeconds + minimumUsefulShift <= WORKDAY_SECONDS
        && untilWork <= travelSeconds + 0.25;
    }

    if (secondsIntoDay >= WORK_END_SECONDS || this.laborPaused) return false;

    const remainingWorkday = WORK_END_SECONDS - secondsIntoDay;
    if (atWork) {
      const minimumShiftComplete = agent.workArrivalElapsedSeconds == null
        || elapsed - agent.workArrivalElapsedSeconds >= WORKER_MINIMUM_SHIFT_SECONDS;
      return !(minimumShiftComplete && remainingWorkday <= travelSeconds + 0.25);
    }

    return remainingWorkday >= travelSeconds + minimumUsefulShift;
  }

  private isNightWatchDuty(
    agent: VillagerAgent,
    workplace: BuildingState | null,
  ): boolean {
    if (
      !this.clock
      || this.clock.isWorkHours
      || !workplace
      || workplace.constructionComplete === false
      || this.fireDisabledBuildingIds.has(workplace.id)
      || this.nightPolicy.watch === 2
    ) {
      return false;
    }
    if (workplace.kind === 'watchtower') return true;
    if (workplace.kind !== 'guardhouse') return false;
    const armedSlots = Math.min(
      workplace.assignedLabor,
      Math.floor(workplace.polearms ?? 0),
    );
    if (agent.workplaceSlot >= armedSlots) return false;
    return this.nightPolicy.watch === 1
      || agent.workplaceSlot < Math.max(1, Math.ceil(armedSlots / 2));
  }

  private findMassChapel(agent: VillagerAgent): BuildingState | null {
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
    const destination = chapelGatheringPoint(chapel, agent.personIdentity);
    const distance = Math.hypot(destination.x - agent.x, destination.z - agent.z);
    agent.massChapelId = chapel.id;
    if (distance < 0.25) {
      this.completeMassArrival(agent);
      return true;
    }
    const path = chapelAttendancePath(
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
    const gathering = chapelGatheringPoint(chapel, agent.personIdentity);
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
    const path = pickWorkerCommutePath(
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
    const homeState = this.clock
      ? householdMemberHomeState(agent.personIdentity, this.clock)
      : 'home_outdoors';
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
    const path = pickWorkerCommutePath(
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
    const homeState = this.clock
      ? householdMemberHomeState(
          agent.personIdentity,
          this.clock,
          this.nightPolicy,
        )
      : 'home_outdoors';
    agent.routinePhase = 'returning_from_feast';
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
    const path = pickWorkerCommutePath(
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
    const path = pickWorkerCommutePath(
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
      this.completeWorkerCommuteToWork(agent);
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
    const approach = pickWorkerCommutePath(
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
    const returnPath = pickWorkerCommutePath(
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
    agent.routinePhase = this.clock
      ? householdMemberHomeState(agent.personIdentity, this.clock, this.nightPolicy)
      : 'home_outdoors';
    agent.idleRemaining = pickIdleDuration(agent.pathSeed) * 0.7;
    this.reconcileRoutine(agent);
  }

  private beginWorkerReturnHome(agent: VillagerAgent): boolean {
    const workplace = agent.workplaceId
      ? this.buildings.get(agent.workplaceId) ?? null
      : null;
    const destination = this.workerRestDestination(agent, workplace);
    agent.returnLodgingId = workplace
      ? this.workerWorksiteLodging(workplace)?.lodging.id ?? null
      : null;
    agent.returnRequiresRest = !(
      workplace && this.fireDisabledBuildingIds.has(workplace.id)
    );
    if (!destination) {
      this.clearPath(agent);
      agent.routinePhase = 'indoors';
      return true;
    }

    const duty = this.marketStallDutyForAgent(agent);
    if (duty) {
      const roadDeparture = pickWorkerCommutePath(
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

    const path = pickWorkerCommutePath(
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
    const workplace = agent.workplaceId
      ? this.buildings.get(agent.workplaceId) ?? null
      : null;
    const lodging = workplace
      ? resolveWorksiteLodging(
          workplace,
          this.buildings.values(),
          this.fireDisabledBuildingIds,
        )
      : null;
    if (agent.returnLodgingId && lodging?.lodging.id !== agent.returnLodgingId) {
      agent.returnLodgingId = null;
      const residence = agent.residenceId
        ? this.residences.get(agent.residenceId) ?? null
        : null;
      const home = residence
        ? residenceDoorPosition(residence)
        : this.foundingCamp
          ? this.foundingCampRestPosition(agent, this.foundingCamp)
          : null;
      const path = home
        ? pickWorkerCommutePath({ x: agent.x, z: agent.z }, home, this.roadNetwork)
        : null;
      if (path && this.beginJourney(agent, path, 'return_home')) {
        agent.routinePhase = 'returning_home';
        return;
      }
    }
    if (this.clock && agent.returnRequiresRest) {
      agent.restUntilElapsedSeconds = Math.max(
        agent.restUntilElapsedSeconds,
        clockElapsedSeconds(this.clock) + WORKER_MINIMUM_REST_SECONDS,
      );
    }
    agent.returnRequiresRest = false;
    agent.workArrivalElapsedSeconds = null;
    const completedAtLodging = agent.returnLodgingId != null
      && lodging?.lodging.id === agent.returnLodgingId;
    agent.returnLodgingId = null;
    const homeState = this.clock
      ? householdMemberHomeState(agent.personIdentity, this.clock, this.nightPolicy)
      : 'home_outdoors';
    if (workplace && completedAtLodging) {
      this.transitionToRemoteCampState(agent, homeState, workplace);
      agent.idleRemaining = pickIdleDuration(agent.pathSeed) * 0.7;
      this.reconcileRoutine(agent);
      return;
    }
    const residence = agent.residenceId ? this.residences.get(agent.residenceId) : null;
    if (residence) this.placeIdle(agent, residence);
    else if (this.foundingCamp) this.placeFounderIdle(agent, this.foundingCamp);
    agent.routinePhase = homeState;
    agent.idleRemaining = pickIdleDuration(agent.pathSeed) * 0.7;
    this.reconcileRoutine(agent);
  }

  private beginWorkerCommuteToWork(agent: VillagerAgent): boolean {
    const building = agent.workplaceId ? this.buildings.get(agent.workplaceId) : null;
    if (!building || this.fireDisabledBuildingIds.has(building.id)) return false;

    const duty = this.marketStallDutyForAgent(agent);
    if (duty) {
      const start = { x: agent.x, z: agent.z };
      const roadApproach = pickWorkerCommutePath(
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
      if (!this.beginPreparedJourney(agent, path, 'commute_to_work')) {
        this.completeWorkerCommuteToWork(agent);
        return true;
      }
      agent.routinePhase = 'commuting_to_work';
      return true;
    }

    const destination = this.workerDutyPosition(building, agent.workplaceSlot);
    const path = pickWorkerCommutePath(
      { x: agent.x, z: agent.z },
      destination,
      this.roadNetwork,
    );
    if (!path) {
      this.completeWorkerCommuteToWork(agent);
      return true;
    }
    if (!this.beginJourney(agent, path, 'commute_to_work')) return false;
    agent.routinePhase = 'commuting_to_work';
    return true;
  }

  private completeWorkerCommuteToWork(agent: VillagerAgent): void {
    this.clearPath(agent);
    const building = agent.workplaceId ? this.buildings.get(agent.workplaceId) : null;
    if (!building || this.fireDisabledBuildingIds.has(building.id)) {
      agent.routinePhase = 'home_outdoors';
      this.beginWorkerReturnHome(agent);
      return;
    }
    agent.routinePhase = 'work';
    agent.workArrivalElapsedSeconds = this.clock
      ? clockElapsedSeconds(this.clock)
      : null;
    this.placeWorkerIdle(agent, building);
    agent.idleRemaining = pickIdleDuration(agent.pathSeed) * 0.45;
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
      const buildingYaw = buildingPlacementYaw(
        marketplace.kind,
        marketplace.x,
        marketplace.z,
        this.roadNetwork,
      );
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
    ) ?? workplaceYardPosition(workplace, workplaceSlot);
  }

  private workerRestDestination(
    agent: VillagerAgent,
    workplace: BuildingState | null,
  ): (PointXZ & { yaw?: number }) | null {
    const lodging = workplace
      ? this.workerWorksiteLodging(workplace)
      : null;
    if (lodging) {
      return workLodgingDoorPosition(
        lodging.lodging,
        agent.workplaceSlot,
        this.roadNetwork,
      );
    }
    return this.workerPermanentHomeDestination(agent);
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

  private workerWorksiteLodging(
    workplace: BuildingState,
  ): WorksiteLodging | null {
    // Sunday homecoming deliberately applies to built-in bunks as well as
    // separately constructed camps.
    if (this.sabbathPausedToday) return null;
    return resolveWorksiteLodging(
      workplace,
      this.buildings.values(),
      this.fireDisabledBuildingIds,
    );
  }

  private estimateWorkerCommuteSeconds(
    agent: VillagerAgent,
    workplace: BuildingState,
  ): number {
    const origin = agent.routinePhase === 'work'
      || isRemoteCampPhase(agent.routinePhase)
      || (
        agent.routinePhase === 'returning_home'
        && agent.returnLodgingId != null
      )
      ? this.workerRestDestination(agent, workplace)
      : this.workerPermanentHomeDestination(agent);
    if (!origin) return 0;
    const destination = this.workerDutyPosition(workplace, agent.workplaceSlot);
    const key = [
      workplace.id,
      workplace.x,
      workplace.z,
      resolveWorksiteLodging(
        workplace,
        this.buildings.values(),
        this.fireDisabledBuildingIds,
      )?.lodging.id ?? 'home',
      agent.residenceId ?? 'founders',
      origin.x,
      origin.z,
      destination.x,
      destination.z,
      agent.walkSpeed,
      this.roadNetwork?.getTopologyRevision() ?? -1,
    ].join(':');
    const cached = this.workerCommuteEstimateCache.get(agent.id);
    if (cached?.key === key) return cached.seconds;
    const path = pickWorkerCommutePath(
      origin,
      destination,
      this.roadNetwork,
    );
    const seconds = path
      ? estimatePedestrianTravelSeconds(path, agent.walkSpeed, this.roadNetwork)
      : 0;
    this.workerCommuteEstimateCache.set(agent.id, { key, seconds });
    return seconds;
  }

  private transitionToRemoteCampState(
    agent: VillagerAgent,
    homeState: HouseholdHomeState,
    workplace: BuildingState,
  ): boolean {
    const lodging = resolveWorksiteLodging(
      workplace,
      this.buildings.values(),
      this.fireDisabledBuildingIds,
    );
    if (!lodging) return false;
    const nextPhase = remoteCampPhaseForHomeState(homeState);
    if (agent.routinePhase === nextPhase) return false;
    this.clearPath(agent);
    agent.routinePhase = nextPhase;
    const destination = homeState === 'home_outdoors'
      ? workLodgingFiresidePosition(
          lodging.lodging,
          agent.workplaceSlot,
          this.roadNetwork,
        )
      : workLodgingDoorPosition(
          lodging.lodging,
          agent.workplaceSlot,
          this.roadNetwork,
        );
    agent.x = destination.x;
    agent.z = destination.z;
    agent.y = this.resolveGroundY(agent.x, agent.z) + 0.02;
    agent.yaw = destination.yaw;
    agent.idleRemaining = pickIdleDuration(agent.pathSeed) * 0.7;
    agent.idleDirty = false;
    return true;
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
      agent.x = backyard.x;
      agent.z = backyard.z;
      agent.y = this.resolveGroundY(agent.x, agent.z) + 0.02;
      agent.yaw = backyard.yaw;
      agent.idleDirty = false;
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
    agent.mode = 'walk';
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
    if (purpose === 'commute_to_work') agent.routinePhase = 'home_outdoors';
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
    this.placeIdle(agent, residence);
    agent.idleDirty = false;
  }

  private resetWorkerToIdle(agent: VillagerAgent): void {
    const building = agent.workplaceId ? this.buildings.get(agent.workplaceId) : null;
    agent.mode = 'idle';
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

    const signature = [
      this.chapelAmbientCycleIndex,
      ...[...rosters]
        .sort(([a], [b]) => a.localeCompare(b))
        .flatMap(([chapelId, roster]) => [
          chapelId,
          this.buildings.get(chapelId)?.x ?? '',
          this.buildings.get(chapelId)?.z ?? '',
          ...roster.map((agent) => agent.id),
        ]),
    ].join(':');
    if (signature === this.chapelAmbientSignature) return false;
    this.chapelAmbientSignature = signature;

    const assignments = new Map<string, AmbientBehaviorAssignment>();
    for (const [chapelId, roster] of rosters) {
      const chapel = this.buildings.get(chapelId);
      if (!chapel) continue;
      for (const [agentId, assignment] of planChapelGatheringBehaviors(
        chapel,
        roster.map((agent) => agent.id),
        this.chapelAmbientCycleIndex,
      )) {
        assignments.set(agentId, assignment);
      }
    }
    this.chapelAmbientAssignments = assignments;
    for (const roster of rosters.values()) {
      for (const agent of roster) {
        if (agent.routinePhase === 'at_mass') this.applyAmbientAssignment(agent);
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
    if (!assignment) return;
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
    agent.mode = assignment.kind === 'wander' || assignment.kind === 'idle'
      ? 'idle'
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
      && agent.routinePhase === 'work'
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
      || agent.routinePhase === 'going_to_fire_assembly'
      || agent.routinePhase === 'at_fire_assembly'
      || agent.routinePhase === 'returning_from_fire_assembly'
      || isRemoteCampPhase(agent.routinePhase)
    ) return null;
    const workplace = this.buildings.get(agent.workplaceId);
    if (workplace && this.fireDisabledBuildingIds.has(workplace.id)) return null;
    if (workplace?.constructionComplete === false) return 'hammer';
    if (workplace && workerProductionBlocker(workplace)) return null;
    const kind = workplace?.kind;
    if (kind === 'lumber_mill' || kind === 'woodcutters_lodge') return 'hatchet';
    if (
      kind === 'stone_quarry'
      || kind === 'large_quarry'
      || kind === 'mine'
    ) return 'pickaxe';
    if (
      kind === 'reforester'
      || kind === 'clay_pit'
      || kind === 'charcoal_burner'
    ) return 'shovel';
    if (kind === 'threshing_barn' || kind === 'vineyard') return 'hoe';
    if (kind === 'carpenter' || kind === 'smithy') return 'hammer';
    if (kind === 'guardhouse') {
      return agent.workplaceSlot < Math.floor(workplace?.polearms ?? 0) ? 'spear' : null;
    }
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
): string {
  const workplaceLabel = workplace
    ? isResidenceUpgradeWorkplaceId(workplace.id)
      ? residenceWorksLabel
      : getBuildingDefinition(workplace.kind).label
    : 'their workplace';

  switch (agent.routinePhase) {
    case 'commuting_to_work':
      if (workplaceFireDisabled) return `Turning back from the fire at ${workplaceLabel}`;
      return marketStallDuty
        ? 'Walking to the Marketplace stall'
        : `Walking to ${workplaceLabel}`;
    case 'returning_home':
      return workplaceFireDisabled
        ? `Evacuating from the fire at ${workplaceLabel}`
        : 'Walking home';
    case 'going_to_mass':
      return holiday
        ? `Walking to the ${holiday.label} gathering`
        : 'Walking to Sunday mass';
    case 'at_mass':
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
      if (marketStallDuty) {
        return marketStallDuty.needKind
          ? `Minding the ${marketStallLabel(marketStallDuty.needKind).toLocaleLowerCase()} stall at the Marketplace`
          : 'Preparing an empty stall at the Marketplace';
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
      if (agent.mode === 'chop') return `Chopping timber near ${workplaceLabel}`;
      if (agent.mode === 'mine') return `Quarrying stone near ${workplaceLabel}`;
      if (agent.mode === 'plant') {
        return workplace?.kind === 'clay_pit'
          ? `Cutting wet river clay at ${workplaceLabel}`
          : `Planting saplings near ${workplaceLabel}`;
      }
      if (agent.mode === 'sow') return `Broadcast sowing seed for ${workplaceLabel}`;
      if (agent.mode === 'fish') return `Fishing near ${workplaceLabel}`;
      if (agent.mode === 'gather') {
        if (workplace?.kind === 'hunters_hall') return `Checking game near ${workplaceLabel}`;
        if (workplace?.kind === 'swineherd') return `Collecting mast near ${workplaceLabel}`;
        if (workplace?.kind === 'apiary') return `Inspecting hives at ${workplaceLabel}`;
        return `Gathering wild food near ${workplaceLabel}`;
      }
      if (agent.mode === 'tend') {
        switch (workplace?.kind) {
          case 'well': return `Drawing water at ${workplaceLabel}`;
          case 'threshing_barn': return `Working the fields for ${workplaceLabel}`;
          case 'pastoral_farmstead':
          case 'swineherd': return `Tending livestock for ${workplaceLabel}`;
          case 'brewery': return `Tending the brew at ${workplaceLabel}`;
          case 'smokehouse': return `Tending the smoke racks at ${workplaceLabel}`;
          case 'granary': return `Handling grain at ${workplaceLabel}`;
          case 'bakery': return `Baking bread at ${workplaceLabel}`;
          case 'watermill': return `Tending the mill at ${workplaceLabel}`;
          case 'windmill': return `Tending the sails at ${workplaceLabel}`;
          case 'vineyard': return `Tending vines at ${workplaceLabel}`;
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
    case 'sick_rest':
      return 'Resting at home while ill';
    case 'remote_camp_outdoors':
      return `Resting outside the crew lodging at ${workplaceLabel}`;
    case 'remote_camp_indoors':
      return `Inside the crew lodging at ${workplaceLabel}`;
    case 'remote_camp_asleep':
      return `Sleeping in the crew lodging at ${workplaceLabel}`;
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

function combatRenderMode(
  status: CombatAgentState['status'],
  attackingHolding: boolean,
): VillagerRenderMode {
  switch (status) {
    case 'fighting': return 'fight';
    case 'looting': return attackingHolding ? 'fight' : 'gather';
    case 'downed': return 'rest';
    case 'recovering': return 'rest';
    case 'advancing':
    case 'retreating':
    case 'returning':
    case 'wounded-returning':
    case 'mustering':
      return 'walk';
    case 'holding':
      return 'idle';
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
      return combat.faction === 'guard'
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
      return 'Returning to the guardhouse after the incursion';
    case 'downed':
      return combat.faction === 'guard'
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

function raiderTunicColor(seed: number): number {
  const colors = [0x694037, 0x76533a, 0x55493c, 0x6b5b3f, 0x4d4639] as const;
  return colors[(seed >>> 12) % colors.length] ?? colors[0];
}
