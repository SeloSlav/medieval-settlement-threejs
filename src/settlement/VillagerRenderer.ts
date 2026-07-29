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
  FarmFieldState,
  ForagingNodeState,
  PastureState,
  ResourceNodeState,
  ResidenceState,
  TreeEntityState,
  TreeLayoutEntry,
} from '../resources/types.ts';
import { getBuildingDefinition } from '../resources/buildings.ts';
import {
  householdMemberHomeState,
  type HouseholdHomeState,
} from '../residences/householdRoutine.ts';
import { polylineLengthXZ, samplePolylineXZ, type PointXZ } from '../utils/pathGeometry.ts';
import type { GameClock } from '../world/gameCalendar.ts';
import {
  WorkerActivityAudio,
  type WorkerActivitySoundSource,
} from '../audio/WorkerActivityAudio.ts';
import { FarmWorkerSongAudio } from '../audio/FarmWorkerSongAudio.ts';
import {
  CROWD_SIM_DT,
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
  palisadedRefugeGateInside,
  palisadedRefugeGateOutside,
  palisadedRefugeRallyPosition,
} from './palisadedRefugeRally.ts';
import type { GameSpeed } from '../world/gameSpeed.ts';
import { STARTING_POPULATION } from '../generated/gameBalance.ts';
import {
  fireDisabledBuildingIds,
  fireDisabledResidenceIds,
  type FireIncidentState,
} from '../fires/fireIncident.ts';
import type { CombatAgentState } from '../security/combatAgents.ts';
import { COMBAT_WADING_SPEED_MULTIPLIER } from '../security/combatRiverNavigation.ts';

type VillagerMode = VillagerRenderMode;
type VillagerRole = 'founder' | 'resident' | 'worker';
type VillagerRoutinePhase =
  | 'work'
  | 'commuting_to_work'
  | 'returning_home'
  | 'going_to_mass'
  | 'at_mass'
  | 'returning_from_mass'
  | 'going_to_refuge'
  | 'at_refuge'
  | 'returning_from_refuge'
  | 'going_to_muster'
  | 'at_muster'
  | 'returning_from_muster'
  | HouseholdHomeState;
type VillagerPathPurpose =
  | 'home_wander'
  | 'worker_work_loop'
  | 'commute_to_work'
  | 'return_home'
  | 'chapel_mass'
  | 'return_from_mass'
  | 'refuge_rally'
  | 'return_from_refuge'
  | 'guard_muster'
  | 'return_from_muster'
  | 'ambient'
  | null;

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

type VillagerAgent = {
  id: string;
  personIdentity: string;
  role: VillagerRole;
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
};

export type VillagerInspection = {
  personIdentity: string;
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
  private readonly renderer: SettlementCrowdRenderer;
  private readonly activityAudio = new WorkerActivityAudio();
  private readonly farmWorkerSongAudio = new FarmWorkerSongAudio();
  private readonly getGameSpeed: () => GameSpeed;
  private readonly getHeightAt: (x: number, z: number) => number;
  private readonly getRoadDeckY: ((x: number, z: number) => number | null) | null;
  private readonly isWaterAt: ((x: number, z: number) => boolean) | null;
  private readonly routePathAroundObstacles:
    ((path: readonly PointXZ[]) => PointXZ[] | null) | null;
  private readonly agents = new Map<string, VillagerAgent>();
  private residences = new Map<string, ResidenceState>();
  private buildings = new Map<string, BuildingState>();
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
  private frontierAlertActive = false;
  private refugeAssignments: ReadonlyMap<string, string> = new Map();
  private guardMusterAssignments:
    ReadonlyMap<string, GuardMusterPresentationAssignment> = new Map();
  private fireDisabledResidenceIds = new Set<string>();
  private combatAgentVisuals = new Map<string, CombatAgentVisual>();
  private activeCombatGuardSlots = new Set<string>();
  private roadNetwork: RoadNetwork | null = null;
  private clock: GameClock | null = null;
  private laborPaused = false;
  private lastView: CrowdViewState | undefined;

  constructor(options: VillagerRendererOptions) {
    this.getGameSpeed = options.getGameSpeed;
    this.getHeightAt = options.getHeightAt;
    this.getRoadDeckY = options.getRoadDeckY ?? null;
    this.isWaterAt = options.isWaterAt ?? null;
    this.routePathAroundObstacles = options.routePathAroundObstacles ?? null;
    this.renderer = new SettlementCrowdRenderer({ parent: options.parent });
  }

  setSchedule(clock: GameClock, laborPaused: boolean): void {
    this.clock = clock;
    this.laborPaused = laborPaused;
    let changed = false;
    for (const agent of this.agents.values()) {
      changed = this.reconcileRoutine(agent) || changed;
    }
    changed = this.syncCampAmbientAssignments() || changed;
    changed = this.syncChapelAmbientAssignments() || changed;
    if (changed) this.pushRenderState();
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
      const remainingWorkDistance = agent.pathPurpose === 'worker_work_loop'
        && agent.workActivity
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
    deliveryTrips?: Iterable<DeliveryTripState>;
    fireIncidents?: Iterable<FireIncidentState>;
    roadNetwork: RoadNetwork | null;
    foragingMonth?: number;
  }): void {
    const previousResidences = this.residences;
    const previousBuildings = this.buildings;
    const previousFoundingCamp = this.foundingCamp;
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
    const fireIncidents = [...(options.fireIncidents ?? [])];
    const disabledBuildingIds = fireDisabledBuildingIds(fireIncidents);
    this.fireDisabledResidenceIds = fireDisabledResidenceIds(fireIncidents);
    this.residences = new Map(residences.map((residence) => [residence.id, residence]));
    this.buildings = new Map(buildings.map((building) => [building.id, building]));
    this.foundingCamp = physicalBuildings.find(
      (building) =>
        building.kind === 'founders_camp'
        && building.constructionComplete !== false
        && building.foundingShelterActive !== false,
    ) ?? null;
    this.roadNetwork = options.roadNetwork;
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

    const travelingWorkers = rosteredCartWorkersByBuilding(
      this.buildings,
      options.deliveryTrips ?? [],
    );
    const roster = allocateProductionWorkers(residences, buildings, travelingWorkers);
    const onSiteAssignments = roster.assignments.filter((assignment) => assignment.onSite);
    const slots = computeVillagerSlots(
      residences,
      this.roadNetwork,
      roster.remainingPopulationByResidence,
      Math.max(0, MAX_VILLAGERS_TOTAL - roster.assignments.length),
    );
    const nextIds = new Set<string>();

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
          const appearanceSeed = pickVillagerAppearanceSeed(residenceId, slotIndex);
          const colors = pickVillagerColors(appearanceSeed);
          agent = {
            id,
            personIdentity,
            role: 'resident',
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
          };
          this.agents.set(id, agent);
        } else {
          agent.personIdentity = personIdentity;
          agent.role = 'resident';
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
      if (!building) continue;
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
        const yard = workplaceYardPosition(building, assignment.slotIndex);
        agent = {
          id: assignment.id,
          personIdentity: assignment.personIdentity,
          role: 'worker',
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
        };
        this.agents.set(assignment.id, agent);
      } else {
        const previousHomeResidenceId = agent.residenceId;
        agent.personIdentity = assignment.personIdentity;
        agent.role = 'worker';
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
        };
        this.agents.set(id, agent);
      } else {
        agent.personIdentity = personIdentity;
        agent.role = 'founder';
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

  tick(dt: number, view?: CrowdViewState): void {
    this.lastView = view;
    const realDt = Math.max(0, dt);
    const simulationDt = realDt * this.getGameSpeed();
    this.advanceCampAmbientCycle(simulationDt);
    this.advanceChapelAmbientCycle(simulationDt);
    this.advanceCombatAgentVisuals(realDt);

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
        || agent.pathPurpose === 'refuge_rally'
        || agent.pathPurpose === 'return_from_refuge'
        || agent.pathPurpose === 'guard_muster'
        || agent.pathPurpose === 'return_from_muster';
      if (agent.frozen && !commuteMustAdvance) continue;

      agent.simAccumulator += simulationDt;
      while (agent.simAccumulator >= CROWD_SIM_DT) {
        this.simStep(agent, CROWD_SIM_DT);
        agent.simAccumulator -= CROWD_SIM_DT;
      }

      this.interpolateDisplay(agent, simulationDt);
      agent.x = this.readDisplayX(agent);
      agent.z = this.readDisplayZ(agent);
      agent.yaw = this.readDisplayYaw(agent);
      agent.y = this.resolveAgentY(agent);
    }

    this.releaseVacatedCampSeats();
    this.pushRenderState(view, simulationDt, simulationDt > 0 ? realDt : 0);
  }

  pickVillager(
    clientX: number,
    clientY: number,
    camera: THREE.Camera,
    domElement: HTMLElement,
  ): VillagerInspection | null {
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
    for (const agent of this.agents.values()) {
      if (agent.personIdentity === personIdentity) return this.describeAgent(agent);
    }
    return null;
  }

  dispose(): void {
    this.agents.clear();
    this.activityAudio.dispose();
    this.farmWorkerSongAudio.dispose();
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
    const onDuty = agent.role === 'worker'
      && (
        agent.routinePhase === 'work'
        || agent.routinePhase === 'commuting_to_work'
      );

    return {
      personIdentity: agent.personIdentity,
      name,
      initials: name
        .split(/\s+/)
        .slice(0, 2)
        .map((part) => part[0] ?? '')
        .join('')
        .toLocaleUpperCase(),
      eyebrow: agent.role === 'founder'
        ? 'Founder · Awaiting housing'
        : agent.role === 'worker'
          ? `Worker · ${onDuty ? 'On duty' : 'Off duty'}`
          : 'Villager · Available labor',
      occupation: villagerOccupation(
        workplace?.kind ?? null,
        workplace?.constructionComplete === false,
      ),
      activity: describeVillagerActivity(
        agent,
        workplace,
        upgradeWorkplaceLabel.toLocaleLowerCase(),
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
      crew: workplace
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
      visible: this.isVisibleAgent(agent),
    };
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
    if (agent.routinePhase === 'indoors' || agent.routinePhase === 'asleep') {
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
    const renderAgents: CrowdRenderAgent[] = [];
    let slot = 0;
    for (const agent of this.agents.values()) {
      if (agent.role === 'worker') {
        const workplace = agent.workplaceId ? this.buildings.get(agent.workplaceId) : null;
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
      if (agent.routinePhase === 'indoors' || agent.routinePhase === 'asleep') {
        continue;
      }
      renderAgents.push({
        id: agent.id,
        slot: slot++,
        x: agent.x,
        y: agent.y,
        z: agent.z,
        yaw: agent.yaw,
        appearanceSeed: agent.appearanceSeed,
        variant: agent.modelVariant,
        mode: agent.mode,
        tunicColor: agent.tunicColor,
        skinColor: agent.skinColor,
        hairColor: agent.hairColor,
        tool: this.workerToolFor(agent),
        movementSpeed: agent.currentMoveSpeed,
        active: true,
      });
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
      renderAgents.push({
        id: `combat:${combat.id}`,
        slot: slot++,
        x: visual.displayX,
        y: this.resolveGroundY(visual.displayX, visual.displayZ) + 0.02,
        z: visual.displayZ,
        yaw,
        appearanceSeed,
        variant: ordinaryGuard?.modelVariant ?? 'man',
        mode: combatRenderMode(
          combat.status,
          combat.targetKind !== 'cart',
        ),
        tunicColor: ordinaryGuard?.tunicColor
          ?? (combat.faction === 'raider'
            ? raiderTunicColor(appearanceSeed)
            : colors.tunic),
        skinColor: ordinaryGuard?.skinColor ?? colors.skin,
        hairColor: ordinaryGuard?.hairColor
          ?? pickVillagerHairColor(appearanceSeed),
        tool: 'spear',
        movementSpeed: (combat.status === 'wounded-returning'
          ? 0.68
          : combat.faction === 'guard'
            ? 1.42
            : 1.34) * (isWading ? COMBAT_WADING_SPEED_MULTIPLIER : 1),
        active: true,
      });
    }
    const activeView = view ?? this.lastView;
    this.renderer.syncAgents(renderAgents, activeView, animationDt);
    if (audioDt > 0) {
      this.activityAudio.tick(
        audioDt,
        renderAgents.flatMap((agent) => {
          const source = this.workerActivitySoundSource(agent);
          return source ? [source] : [];
        }),
        activeView,
      );
      this.farmWorkerSongAudio.tick(
        audioDt,
        renderAgents.flatMap((renderAgent) => {
          const agent = this.agents.get(renderAgent.id);
          const workplace = agent?.workplaceId
            ? this.buildings.get(agent.workplaceId)
            : null;
          return (
            agent?.mode === 'tend'
            && workplace?.kind === 'threshing_barn'
          )
            ? [{
                id: renderAgent.id,
                x: renderAgent.x,
                z: renderAgent.z,
              }]
            : [];
        }),
        activeView,
      );
    }
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

  private workerActivitySoundSource(
    renderAgent: CrowdRenderAgent,
  ): WorkerActivitySoundSource | null {
    const agent = this.agents.get(renderAgent.id);
    const workplace = agent?.workplaceId
      ? this.buildings.get(agent.workplaceId)
      : null;
    const mode = renderAgent.mode === 'chop'
      || renderAgent.mode === 'mine'
      || renderAgent.mode === 'build'
      ? renderAgent.mode
      : renderAgent.mode === 'plant'
        ? 'dig'
        : renderAgent.mode === 'fish'
          ? 'fish'
          : renderAgent.mode === 'gather'
            ? 'forage'
            : renderAgent.mode === 'tend'
              ? workplace?.kind === 'threshing_barn'
                ? 'cut_crop'
                : workplace?.kind === 'pastoral_farmstead'
                  || workplace?.kind === 'swineherd'
                  ? 'livestock'
                  : null
              : null;
    return mode
      ? {
          id: renderAgent.id,
          mode,
          x: renderAgent.x,
          z: renderAgent.z,
        }
      : null;
  }

  private simStep(agent: VillagerAgent, dt: number): void {
    if (
      agent.mode === 'chop'
      || agent.mode === 'mine'
      || agent.mode === 'gather'
      || agent.mode === 'plant'
      || agent.mode === 'fish'
      || agent.mode === 'tend'
      || agent.mode === 'build'
    ) {
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
          if (agent.role === 'resident') {
            const residence = agent.residenceId ? this.residences.get(agent.residenceId) : null;
            if (residence) this.tryBeginWalk(agent, residence);
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
      agent.pathPurpose === 'worker_work_loop'
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
        case 'worker_work_loop':
          this.resetWorkerToIdle(agent);
          break;
        case 'home_wander': {
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

  private readDisplayX(agent: VillagerAgent): number {
    if (agent.mode !== 'walk') return agent.x;
    const sample = samplePolylineXZ(agent.path, agent.displayPathCursor);
    return sample?.x ?? agent.x;
  }

  private readDisplayZ(agent: VillagerAgent): number {
    if (agent.mode !== 'walk') return agent.z;
    const sample = samplePolylineXZ(agent.path, agent.displayPathCursor);
    return sample?.z ?? agent.z;
  }

  private readDisplayYaw(agent: VillagerAgent): number {
    if (agent.mode !== 'walk') {
      if (
        agent.routinePhase === 'work'
        || agent.routinePhase === 'at_mass'
        || agent.routinePhase === 'at_refuge'
        || agent.routinePhase === 'at_muster'
      ) {
        return agent.yaw;
      }
      const residence = agent.residenceId ? this.residences.get(agent.residenceId) : null;
      return residence ? residence.yaw + agent.idleOffset.yaw : agent.yaw;
    }
    const sample = samplePolylineXZ(agent.path, agent.displayPathCursor);
    return sample?.yaw ?? agent.yaw;
  }

  private beginWorkerActivity(agent: VillagerAgent): void {
    if (!agent.workActivity || !agent.workTarget) return;
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
    const kind = this.buildings.get(agent.workplaceId)?.kind;
    return kind === 'watchtower' || kind === 'guardhouse';
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
      || agent.workplaceSlot >= Math.floor(guardhouse.polearms ?? 0)
    ) return null;
    const assignment = this.guardMusterAssignments.get(guardhouse.id);
    const tower = assignment
      ? this.buildings.get(assignment.towerId)
      : null;
    return tower?.kind === 'watchtower'
      && tower.constructionComplete !== false
      && tower.assignedLabor > 0
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
      return this.beginGuardMusterReturn(agent);
    }
    if (agent.routinePhase === 'returning_from_muster') return false;

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

    const homeState = householdMemberHomeState(agent.personIdentity, this.clock);
    const chapel = this.findMassChapel(agent);
    const shouldAttendMass = isSundayMassTime(
      this.clock,
      chapel != null,
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

    if (agent.role === 'founder') {
      return this.transitionToHomeState(agent, 'home_outdoors');
    }

    if (agent.role === 'worker') {
      const shouldWork = this.clock.isWorkHours && !this.laborPaused;
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
    }

    return this.transitionToHomeState(agent, homeState);
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
    if (
      agent.role === 'worker'
      && this.clock?.isWorkHours
      && !this.laborPaused
    ) {
      agent.routinePhase = 'home_outdoors';
      this.beginWorkerCommuteToWork(agent);
      return;
    }
    const homeState = this.clock
      ? householdMemberHomeState(agent.personIdentity, this.clock)
      : 'home_outdoors';
    agent.routinePhase = 'returning_from_mass';
    this.transitionToHomeState(agent, homeState);
    this.syncCampAmbientAssignments();
    this.syncChapelAmbientAssignments();
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
    const destination = workplace
      ? workplaceYardPosition(workplace, agent.workplaceSlot)
      : residence
        ? residenceDoorPosition(residence)
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
    if (workplace) {
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
      ? residenceDoorPosition(residence)
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
    if (residence) this.placeIdle(agent, residence);
    else if (this.foundingCamp) this.placeFounderIdle(agent, this.foundingCamp);
    agent.routinePhase = 'home_outdoors';
    agent.idleRemaining = 1;
    this.reconcileRoutine(agent);
  }

  private beginWorkerReturnHome(agent: VillagerAgent): boolean {
    const residence = agent.residenceId ? this.residences.get(agent.residenceId) : null;
    const destination = residence
      ? residenceDoorPosition(residence)
      : this.foundingCamp
        ? this.foundingCampRestPosition(agent, this.foundingCamp)
        : null;
    if (!destination) {
      this.clearPath(agent);
      agent.routinePhase = 'indoors';
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
    const residence = agent.residenceId ? this.residences.get(agent.residenceId) : null;
    if (residence) this.placeIdle(agent, residence);
    else if (this.foundingCamp) this.placeFounderIdle(agent, this.foundingCamp);
    agent.routinePhase = this.clock
      ? householdMemberHomeState(agent.personIdentity, this.clock)
      : 'home_outdoors';
    agent.idleRemaining = pickIdleDuration(agent.pathSeed) * 0.7;
  }

  private beginWorkerCommuteToWork(agent: VillagerAgent): boolean {
    const building = agent.workplaceId ? this.buildings.get(agent.workplaceId) : null;
    if (!building) return false;

    const destination = workplaceYardPosition(building, agent.workplaceSlot);
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
    agent.routinePhase = 'work';
    const building = agent.workplaceId ? this.buildings.get(agent.workplaceId) : null;
    if (building) this.placeWorkerIdle(agent, building);
    agent.idleRemaining = pickIdleDuration(agent.pathSeed) * 0.45;
  }

  private transitionToHomeState(
    agent: VillagerAgent,
    homeState: HouseholdHomeState,
  ): boolean {
    if (agent.routinePhase === homeState) return false;
    this.clearPath(agent);
    agent.routinePhase = homeState;
    const residence = agent.residenceId ? this.residences.get(agent.residenceId) : null;
    if (residence) this.placeIdle(agent, residence);
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
    const yard = workplaceYardPosition(building, agent.workplaceSlot);
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
    ) return null;
    const workplace = this.buildings.get(agent.workplaceId);
    if (workplace?.constructionComplete === false) return 'hammer';
    const kind = workplace?.kind;
    if (kind === 'lumber_mill' || kind === 'woodcutters_lodge') return 'hatchet';
    if (kind === 'stone_quarry' || kind === 'large_quarry') return 'pickaxe';
    if (kind === 'reforester') return 'shovel';
    if (kind === 'threshing_barn' || kind === 'vineyard') return 'hoe';
    if (kind === 'carpenter') return 'hammer';
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
): string {
  const workplaceLabel = workplace
    ? isResidenceUpgradeWorkplaceId(workplace.id)
      ? residenceWorksLabel
      : getBuildingDefinition(workplace.kind).label
    : 'their workplace';

  switch (agent.routinePhase) {
    case 'commuting_to_work':
      return `Walking to ${workplaceLabel}`;
    case 'returning_home':
      return 'Walking home';
    case 'going_to_mass':
      return 'Walking to Sunday mass';
    case 'at_mass':
      if (agent.ambientBehavior === 'talk') {
        return 'Mingling with the Sunday congregation';
      }
      if (agent.ambientBehavior === 'wander') {
        return 'Circulating through the Sunday congregation';
      }
      return 'Attending Sunday mass';
    case 'returning_from_mass':
      return 'Walking home from Sunday mass';
    case 'going_to_muster':
      return 'Marching by road to the linked frontier watch';
    case 'at_muster':
      return 'Holding the watch muster line during the frontier alert';
    case 'returning_from_muster':
      return 'Returning to the guardhouse after the alert';
    case 'going_to_refuge':
      return 'Rallying through the palisaded refuge gate';
    case 'at_refuge':
      return 'Sheltering with their household during the frontier alert';
    case 'returning_from_refuge':
      return 'Returning from the civilian refuge';
    case 'work':
      if (workplace?.kind === 'watchtower') {
        return 'Keeping watch from the frontier gallery';
      }
      if (agent.mode === 'chop') return `Chopping timber near ${workplaceLabel}`;
      if (agent.mode === 'mine') return `Quarrying stone near ${workplaceLabel}`;
      if (agent.mode === 'plant') return `Planting saplings near ${workplaceLabel}`;
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
          case 'watermill': return `Tending the mill at ${workplaceLabel}`;
          case 'vineyard': return `Tending vines at ${workplaceLabel}`;
          default: return `Tending work at ${workplaceLabel}`;
        }
      }
      if (agent.mode === 'build') {
        return workplace?.kind === 'guardhouse'
          ? `Drilling with the guard at ${workplaceLabel}`
          : `Hammering on ${workplaceLabel}`;
      }
      if (workplace?.constructionComplete === false) {
        return agent.mode === 'walk'
          ? `Building ${workplaceLabel}`
          : `Working on ${workplaceLabel}`;
      }
      return agent.mode === 'walk'
        ? `Working around ${workplaceLabel}`
        : `Working at ${workplaceLabel}`;
    case 'home_outdoors':
      if (agent.role === 'founder') {
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
      return 'At home';
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
