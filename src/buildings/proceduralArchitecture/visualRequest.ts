import type { BuildingKind } from '../../resources/types.ts';
import type { BackyardGardenKind } from '../../generated/gameBalance.ts';

export type MonasteryExtensionMask =
  | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7
  | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15;

export type ProceduralVisualRequest =
  | {
      readonly type: 'building';
      readonly kind: Exclude<BuildingKind, 'chapel' | 'monastery'>;
      readonly seed: number;
    }
  | {
      readonly type: 'church';
      readonly kind: 'chapel';
      readonly tier: 1 | 2 | 3;
      readonly seed: number;
    }
  | {
      readonly type: 'monastery';
      readonly kind: 'monastery';
      readonly extensions: MonasteryExtensionMask;
      readonly orchardMaturity: 0 | 1 | 2;
      readonly seed: number;
    }
  | {
      readonly type: 'residence';
      readonly tier: 1 | 2 | 3 | 4;
      readonly seed: number;
    }
  | {
      readonly type: 'backyard';
      readonly kind: BackyardGardenKind;
      readonly luxuryFlowers: boolean;
      readonly seed: number;
    }
  | {
      readonly type: 'linear';
      readonly kind: 'dry_stone_wall';
      readonly seed: number;
    };

export function proceduralVisualRequestKey(request: ProceduralVisualRequest): string {
  switch (request.type) {
    case 'building':
      return `building:${request.kind}:seed-${request.seed}`;
    case 'church':
      return `church:tier-${request.tier}:seed-${request.seed}`;
    case 'monastery':
      return `monastery:extensions-${request.extensions}:orchard-${request.orchardMaturity}:seed-${request.seed}`;
    case 'residence':
      return `residence:tier-${request.tier}:seed-${request.seed}`;
    case 'backyard':
      return `backyard:${request.kind}:luxury-${request.luxuryFlowers ? 1 : 0}:seed-${request.seed}`;
    case 'linear':
      return `linear:${request.kind}:seed-${request.seed}`;
  }
}
