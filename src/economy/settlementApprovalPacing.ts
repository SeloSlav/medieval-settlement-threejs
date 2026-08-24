import {
  APPROVAL_BASE_SCORE,
  APPROVAL_DECLINE_POINTS_PER_REAL_HOUR,
} from '../generated/gameBalance.ts';
import {
  approvalTier,
  approvalTierLabel,
  type SettlementApproval,
} from './settlementApproval.ts';

const HOUR_MS = 60 * 60 * 1_000;
const MAX_PACING_STEP_MS = 5 * 60 * 1_000;
const STORAGE_PREFIX = 'medieval-road-system.approval-pacing.v1';

export type SettlementApprovalPacingState = {
  score: number;
  lastUpdatedAtMs: number;
  active: boolean;
};

export type SettlementApprovalPacingContext = {
  identityHex: string | null;
  worldSeed: number;
  simTick: number;
  active: boolean;
};

type ApprovalPacingStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

type StoredApprovalPacing = {
  score: number;
  simTick: number;
};

export function paceSettlementApproval(
  target: SettlementApproval,
  previous: SettlementApprovalPacingState | null,
  nowMs: number,
  active: boolean,
): { approval: SettlementApproval; state: SettlementApprovalPacingState } {
  const normalizedNow = Number.isFinite(nowMs)
    ? nowMs
    : previous?.lastUpdatedAtMs ?? 0;
  const targetScore = clampScore(target.score);
  let score = previous === null
    ? Math.max(APPROVAL_BASE_SCORE, targetScore)
    : clampScore(previous.score);

  if (targetScore >= score) {
    // Recovery is intentionally immediate; only losses consume wall-clock time.
    score = targetScore;
  } else if (previous !== null && previous.active) {
    const elapsedMs = Math.min(
      MAX_PACING_STEP_MS,
      Math.max(0, normalizedNow - previous.lastUpdatedAtMs),
    );
    const decline = APPROVAL_DECLINE_POINTS_PER_REAL_HOUR * elapsedMs / HOUR_MS;
    score = Math.max(targetScore, score - decline);
  }

  const displayedScore = Math.round(score);
  const tier = approvalTier(displayedScore);
  return {
    approval: {
      ...target,
      score: displayedScore,
      tier,
      label: approvalTierLabel(tier),
    },
    state: {
      score,
      lastUpdatedAtMs: normalizedNow,
      active,
    },
  };
}

export class SettlementApprovalPacer {
  private contextKey: string | null = null;
  private state: SettlementApprovalPacingState | null = null;
  private lastSimTick = 0;
  private persistedDisplayedScore: number | null = null;
  private readonly now: () => number;
  private readonly storage: ApprovalPacingStorage | null;

  constructor(
    now: () => number = () => Date.now(),
    storage: ApprovalPacingStorage | null = browserStorage(),
  ) {
    this.now = now;
    this.storage = storage;
  }

  update(
    target: SettlementApproval,
    context: SettlementApprovalPacingContext,
  ): SettlementApproval {
    const nowMs = this.now();
    const contextKey = approvalPacingStorageKey(context);
    if (contextKey !== this.contextKey) {
      this.contextKey = contextKey;
      this.state = this.restore(contextKey, context.simTick, nowMs);
      this.lastSimTick = context.simTick;
    } else if (context.simTick < this.lastSimTick) {
      // A backwards simulation clock means this identity started a new world.
      this.storage?.removeItem(contextKey);
      this.state = null;
      this.persistedDisplayedScore = null;
    }

    const paced = paceSettlementApproval(target, this.state, nowMs, context.active);
    this.state = paced.state;
    this.lastSimTick = context.simTick;
    if (paced.approval.score !== this.persistedDisplayedScore) {
      this.persist(contextKey, context.simTick, paced.state.score);
      this.persistedDisplayedScore = paced.approval.score;
    }
    return paced.approval;
  }

  private restore(
    contextKey: string,
    currentSimTick: number,
    nowMs: number,
  ): SettlementApprovalPacingState | null {
    this.persistedDisplayedScore = null;
    const raw = this.storage?.getItem(contextKey);
    if (!raw) return null;
    try {
      const stored = JSON.parse(raw) as Partial<StoredApprovalPacing>;
      if (
        !Number.isFinite(stored.score)
        || !Number.isFinite(stored.simTick)
        || Number(stored.simTick) > currentSimTick
      ) {
        this.storage?.removeItem(contextKey);
        return null;
      }
      const score = clampScore(Number(stored.score));
      this.persistedDisplayedScore = Math.round(score);
      return { score, lastUpdatedAtMs: nowMs, active: false };
    } catch {
      this.storage?.removeItem(contextKey);
      return null;
    }
  }

  private persist(contextKey: string, simTick: number, score: number): void {
    try {
      this.storage?.setItem(contextKey, JSON.stringify({ score, simTick }));
    } catch {
      // Presentation pacing remains valid in memory when storage is unavailable.
    }
  }
}

function approvalPacingStorageKey(context: SettlementApprovalPacingContext): string {
  const identity = context.identityHex || 'anonymous';
  const seed = Number.isFinite(context.worldSeed) ? Math.round(context.worldSeed) : 0;
  return `${STORAGE_PREFIX}:${identity}:${seed}`;
}

function browserStorage(): ApprovalPacingStorage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function clampScore(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : APPROVAL_BASE_SCORE;
}
