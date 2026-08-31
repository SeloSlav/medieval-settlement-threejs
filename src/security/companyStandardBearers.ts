import {
  isPlayerMilitaryFaction,
  type CombatAgentState,
} from './combatAgents.ts';

export type CompanyStandardSide = 'player' | 'ottoman';

export type CompanyStandardAssignment = {
  /** Faction-qualified identity; player company and raid ids can never collide. */
  companyKey: string;
  companyId: string;
  side: CompanyStandardSide;
  bearerId: string;
};

type StandardBearerCandidate = Pick<
  CombatAgentState,
  'id' | 'raidId' | 'faction' | 'companyId' | 'sourceSlot' | 'health' | 'status'
>;

const UNAVAILABLE_STATES = new Set<CombatAgentState['status']>([
  'downed',
  'wounded-returning',
  'recovering',
  'mustering',
]);

/**
 * Returns the stable company identity used by the standard system.
 *
 * Player military combatants already carry their authoritative military
 * company id. Ottoman combatants use the raid/warband id because raiders are
 * intentionally not exposed as player-commandable military companies.
 */
export function companyStandardIdentity(
  agent: StandardBearerCandidate,
): Pick<CompanyStandardAssignment, 'companyKey' | 'companyId' | 'side'> | null {
  if (isPlayerMilitaryFaction(agent.faction)) {
    const companyId = agent.companyId?.trim();
    return companyId
      ? { companyKey: `player:${companyId}`, companyId, side: 'player' }
      : null;
  }
  if (agent.faction !== 'raider') return null;
  const companyId = (agent.companyId ?? agent.raidId).trim();
  return companyId
    ? { companyKey: `ottoman:${companyId}`, companyId, side: 'ottoman' }
    : null;
}

export function isEligibleCompanyStandardBearer(
  agent: StandardBearerCandidate,
): boolean {
  return Number.isFinite(agent.health)
    && agent.health > 0
    && !UNAVAILABLE_STATES.has(agent.status)
    && companyStandardIdentity(agent) !== null;
}

/**
 * Maintains exactly one living standard-bearer per active company.
 *
 * Election is deterministic (source roster slot, then natural id order), but
 * the current bearer keeps the role while eligible. This prevents a recovered
 * lower-numbered soldier from making the standard jump between ranks. When a
 * bearer falls or otherwise becomes unavailable, the next deterministic
 * candidate takes over; assignments disappear when no eligible member remains.
 */
export class CompanyStandardBearerRegistry {
  private readonly bearerByCompany = new Map<string, string>();
  private readonly assignmentByCompany = new Map<string, CompanyStandardAssignment>();
  private readonly companyByBearer = new Map<string, string>();

  sync(
    agents: Iterable<StandardBearerCandidate>,
  ): ReadonlyMap<string, CompanyStandardAssignment> {
    const candidatesByCompany = new Map<string, {
      identity: Pick<CompanyStandardAssignment, 'companyKey' | 'companyId' | 'side'>;
      candidates: StandardBearerCandidate[];
    }>();

    for (const agent of agents) {
      if (!isEligibleCompanyStandardBearer(agent)) continue;
      const identity = companyStandardIdentity(agent)!;
      const company = candidatesByCompany.get(identity.companyKey);
      if (company) {
        company.candidates.push(agent);
      } else {
        candidatesByCompany.set(identity.companyKey, {
          identity,
          candidates: [agent],
        });
      }
    }

    this.assignmentByCompany.clear();
    this.companyByBearer.clear();
    for (const companyKey of [...candidatesByCompany.keys()].sort()) {
      const company = candidatesByCompany.get(companyKey)!;
      company.candidates.sort(compareStandardCandidates);
      const incumbentId = this.bearerByCompany.get(companyKey);
      const incumbent = incumbentId
        ? company.candidates.find((candidate) => candidate.id === incumbentId)
        : undefined;
      const bearer = incumbent ?? company.candidates[0]!;
      const assignment: CompanyStandardAssignment = {
        ...company.identity,
        bearerId: bearer.id,
      };
      this.bearerByCompany.set(companyKey, bearer.id);
      this.assignmentByCompany.set(companyKey, assignment);
      this.companyByBearer.set(bearer.id, companyKey);
    }

    for (const companyKey of [...this.bearerByCompany.keys()]) {
      if (!candidatesByCompany.has(companyKey)) {
        this.bearerByCompany.delete(companyKey);
      }
    }
    return this.assignmentByCompany;
  }

  isBearer(agentOrId: StandardBearerCandidate | string): boolean {
    const id = typeof agentOrId === 'string' ? agentOrId : agentOrId.id;
    return this.companyByBearer.has(id);
  }

  assignmentForAgent(
    agentOrId: StandardBearerCandidate | string,
  ): CompanyStandardAssignment | null {
    const id = typeof agentOrId === 'string' ? agentOrId : agentOrId.id;
    const companyKey = this.companyByBearer.get(id);
    return companyKey
      ? this.assignmentByCompany.get(companyKey) ?? null
      : null;
  }

  assignmentForCompany(companyKey: string): CompanyStandardAssignment | null {
    return this.assignmentByCompany.get(companyKey) ?? null;
  }

  clear(): void {
    this.bearerByCompany.clear();
    this.assignmentByCompany.clear();
    this.companyByBearer.clear();
  }
}

function compareStandardCandidates(
  left: StandardBearerCandidate,
  right: StandardBearerCandidate,
): number {
  const slotDifference = normalizedSourceSlot(left.sourceSlot)
    - normalizedSourceSlot(right.sourceSlot);
  return slotDifference || left.id.localeCompare(right.id, undefined, { numeric: true });
}

function normalizedSourceSlot(value: number): number {
  return Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : Number.MAX_SAFE_INTEGER;
}
