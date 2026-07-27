import * as THREE from 'three';
import type { RoadNetwork } from '../roads/RoadNetwork.ts';
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
import { WorkerActivityAudio } from '../audio/WorkerActivityAudio.ts';
import {
  CROWD_SIM_DT,
  isWithinCrowdView,
  type CrowdViewState,
} from './crowdView.ts';
import {
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
  workplaceYardPosition,
  type WorkerActivityKind,
  type WorkerTarget,
} from './workerPaths.ts';
import type { WorkerToolKind } from './workerTools.ts';
import {
  villagerDisplayName,
  villagerOccupation,
} from './villagerIdentity.ts';
import {
  chapelGatheringPoint,
  isSundayMassTime,
} from './chapelMass.ts';
import type { GameSpeed } from '../world/gameSpeed.ts';
import { STARTING_POPULATION } from '../generated/gameBalance.ts';

type VillagerMode = VillagerRenderMode;
type VillagerRole = 'founder' | 'resident' | 'worker';
type VillagerRoutinePhase =
  | 'work'
  | 'commuting_to_work'
  | 'returning_home'
  | 'going_to_mass'
  | 'at_mass'
  | 'returning_from_mass'
  | HouseholdHomeState;
type VillagerPathPurpose =
  | 'home_wander'
  | 'worker_work_loop'
  | 'commute_to_work'
  | 'return_home'
  | 'chapel_mass'
  | 'return_from_mass'
  | null;

const WORKER_ACTIVITY_SECONDS = 9.5;

type VillagerAgent = {
  id: string;
  personIdentity: string;
  role: VillagerRole;
  residenceId: string | null;
  workplaceId: string | null;
  workplaceSlot: number;
  slotIndex: number;
  mode: VillagerMode;
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
  workplace: string;
  household: string;
  crew: string;
  pace: string;
  position: { x: number; y: number; z: number };
  visible: boolean;
};

export type VillagerRendererOptions = {
  parent: THREE.Group;
  getGameSpeed: () => GameSpeed;
  getHeightAt: (x: number, z: number) => number;
  getRoadDeckY?: (x: number, z: number) => number | null;
  routePathAroundObstacles?: (path: readonly PointXZ[]) => PointXZ[] | null;
};

export class VillagerRenderer {
  private readonly renderer: SettlementCrowdRenderer;
  private readonly activityAudio = new WorkerActivityAudio();
  private readonly getGameSpeed: () => GameSpeed;
  private readonly getHeightAt: (x: number, z: number) => number;
  private readonly getRoadDeckY: ((x: number, z: number) => number | null) | null;
  private readonly routePathAroundObstacles:
    ((path: readonly PointXZ[]) => PointXZ[] | null) | null;
  private readonly agents = new Map<string, VillagerAgent>();
  private residences = new Map<string, ResidenceState>();
  private buildings = new Map<string, BuildingState>();
  private workerTargets = new Map<string, WorkerTarget[]>();
  private foundingCamp: BuildingState | null = null;
  private roadNetwork: RoadNetwork | null = null;
  private clock: GameClock | null = null;
  private laborPaused = false;
  private lastView: CrowdViewState | undefined;

  constructor(options: VillagerRendererOptions) {
    this.getGameSpeed = options.getGameSpeed;
    this.getHeightAt = options.getHeightAt;
    this.getRoadDeckY = options.getRoadDeckY ?? null;
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
    if (changed) this.pushRenderState();
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
    roadNetwork: RoadNetwork | null;
    foragingMonth?: number;
  }): void {
    const previousResidences = this.residences;
    const previousBuildings = this.buildings;
    const residences = [...options.residences];
    const buildings = [...options.buildings];
    const quarries = [...options.quarries];
    const foragingNodes = [...options.foragingNodes];
    const farmFields = [...options.farmFields];
    const pastures = [...options.pastures];
    this.residences = new Map(residences.map((residence) => [residence.id, residence]));
    this.buildings = new Map(buildings.map((building) => [building.id, building]));
    this.foundingCamp = buildings.find(
      (building) =>
        building.kind === 'founders_camp'
        && building.constructionComplete !== false
        && building.foundingShelterActive !== false,
    ) ?? null;
    this.roadNetwork = options.roadNetwork;

    const roster = allocateProductionWorkers(residences, buildings);
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
    const workerBuildingIds = new Set(roster.assignments.map((assignment) => assignment.buildingId));
    this.workerTargets = new Map();
    for (const buildingId of workerBuildingIds) {
      const building = this.buildings.get(buildingId);
      if (!building) continue;
      this.workerTargets.set(buildingId, collectWorkerTargets(building, targetInputs));
    }

    for (const assignment of roster.assignments) {
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
        agent.idleDirty = true;
      }
    }

    for (const id of [...this.agents.keys()]) {
      if (nextIds.has(id)) continue;
      this.agents.delete(id);
    }

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

    this.pushRenderState();
  }

  tick(dt: number, view?: CrowdViewState): void {
    this.lastView = view;
    const realDt = Math.max(0, dt);
    const simulationDt = realDt * this.getGameSpeed();

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
        || agent.pathPurpose === 'return_from_mass';
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

      const feet = projectWorldPoint(agent.x, agent.y + 0.08, agent.z, camera, bounds);
      const head = projectWorldPoint(agent.x, agent.y + 1.72, agent.z, camera, bounds);
      if (!feet || !head) continue;

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
      if (distance > hitRadius || (nearest && distance >= nearest.distance)) continue;
      nearest = {
        distance,
        inspection: this.describeAgent(agent),
      };
    }
    return nearest?.inspection ?? null;
  }

  inspectVillager(personIdentity: string): VillagerInspection | null {
    for (const agent of this.agents.values()) {
      if (agent.personIdentity === personIdentity) return this.describeAgent(agent);
    }
    return null;
  }

  dispose(): void {
    this.agents.clear();
    this.activityAudio.dispose();
    this.renderer.dispose();
  }

  private describeAgent(agent: VillagerAgent): VillagerInspection {
    const workplace = agent.workplaceId
      ? this.buildings.get(agent.workplaceId) ?? null
      : null;
    const residence = agent.residenceId
      ? this.residences.get(agent.residenceId) ?? null
      : null;
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
      activity: describeVillagerActivity(agent, workplace),
      activityState: onDuty ? 'active' : 'ready',
      workplace: workplace ? getBuildingDefinition(workplace.kind).label : 'Unassigned',
      household: residence
        ? `Tier ${residence.tier} home · ${residence.population} ${
          residence.population === 1 ? 'resident' : 'residents'
        }`
        : agent.role === 'founder' || this.foundingCamp
          ? "Founders' camp · no fixed household"
          : 'No fixed household',
      crew: workplace
        ? `${workplace.assignedLabor} / ${getBuildingDefinition(workplace.kind).maxLabor} assigned`
        : 'Free labor pool',
      pace: `${agent.walkSpeed.toFixed(1)} m/s off-road · ${
        (agent.walkSpeed * PEDESTRIAN_ROAD_SPEED_MULTIPLIER).toFixed(1)
      } m/s on roads`,
      position: { x: agent.x, y: agent.y, z: agent.z },
      visible: this.isVisibleAgent(agent),
    };
  }

  private isVisibleAgent(agent: VillagerAgent): boolean {
    if (agent.routinePhase === 'indoors' || agent.routinePhase === 'asleep') {
      return false;
    }
    if (agent.role === 'worker') {
      const workplace = agent.workplaceId ? this.buildings.get(agent.workplaceId) : null;
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
    const activeView = view ?? this.lastView;
    this.renderer.syncAgents(renderAgents, activeView, animationDt);
    if (audioDt > 0) {
      this.activityAudio.tick(
        audioDt,
        renderAgents.flatMap((agent) => (
          agent.mode === 'chop' || agent.mode === 'mine' || agent.mode === 'build'
            ? [{
                id: agent.id,
                mode: agent.mode,
                x: agent.x,
                z: agent.z,
              }]
            : []
        )),
        activeView,
      );
    }
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

    if (agent.mode === 'idle') {
      agent.currentMoveSpeed = 0;
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
        case 'worker_work_loop':
          this.resetWorkerToIdle(agent);
          break;
        case 'home_wander': {
          const residence = agent.residenceId ? this.residences.get(agent.residenceId) : null;
          if (residence) this.resetToIdle(agent, residence);
          break;
        }
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
      if (agent.routinePhase === 'work' || agent.routinePhase === 'at_mass') {
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

  private reconcileRoutine(agent: VillagerAgent): boolean {
    if (!this.clock) return false;
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
    let nearest: BuildingState | null = null;
    let nearestDistance = Infinity;
    for (const building of this.buildings.values()) {
      if (
        building.kind !== 'chapel'
        || building.constructionComplete === false
        || building.assignedLabor <= 0
      ) {
        continue;
      }
      const distance = Math.hypot(building.x - agent.x, building.z - agent.z);
      if (distance >= nearestDistance) continue;
      nearest = building;
      nearestDistance = distance;
    }
    return nearest;
  }

  private beginMassJourney(agent: VillagerAgent, chapel: BuildingState): boolean {
    const destination = chapelGatheringPoint(chapel, agent.personIdentity);
    const distance = Math.hypot(destination.x - agent.x, destination.z - agent.z);
    agent.massChapelId = chapel.id;
    if (distance < 0.25) {
      this.completeMassArrival(agent);
      return true;
    }
    const path = pickWorkerCommutePath(
      { x: agent.x, z: agent.z },
      destination,
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
  }

  private beginMassReturn(agent: VillagerAgent): boolean {
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
    purpose: Exclude<VillagerPathPurpose, 'home_wander' | 'worker_work_loop' | null>,
  ): boolean {
    const routedPath = this.routePath(path);
    const pathDistance = routedPath ? polylineLengthXZ(routedPath) : 0;
    if (pathDistance < 0.25) return false;
    agent.mode = 'walk';
    agent.pathPurpose = purpose;
    agent.path = routedPath!;
    agent.pathDistance = pathDistance;
    agent.pathCursor = 0;
    agent.simPathCursor = 0;
    agent.displayPathCursor = 0;
    this.clearWorkerActivity(agent);
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
    if (purpose === 'chapel_mass') {
      this.completeMassArrival(agent);
      return;
    }
    if (purpose === 'return_from_mass') {
      this.completeMassReturn(agent);
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

  private resolveGroundY(x: number, z: number): number {
    return resolveRoadAwareGroundY(
      this.getHeightAt(x, z),
      this.getRoadDeckY?.(x, z) ?? null,
    );
  }

  private workerToolFor(agent: VillagerAgent): WorkerToolKind | null {
    if (agent.role !== 'worker' || !agent.workplaceId) return null;
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

function describeVillagerActivity(
  agent: VillagerAgent,
  workplace: BuildingState | null,
): string {
  const workplaceLabel = workplace
    ? getBuildingDefinition(workplace.kind).label
    : 'their workplace';

  switch (agent.routinePhase) {
    case 'commuting_to_work':
      return `Walking to ${workplaceLabel}`;
    case 'returning_home':
      return 'Walking home';
    case 'going_to_mass':
      return 'Walking to Sunday mass';
    case 'at_mass':
      return 'Attending Sunday mass';
    case 'returning_from_mass':
      return 'Walking home from Sunday mass';
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
      if (agent.role === 'founder') return "Waiting at the founders' camp";
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
