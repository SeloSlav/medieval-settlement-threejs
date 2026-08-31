import type { MilitaryCompanyKind } from './militaryProgression.ts';

/**
 * Canonical inspector-card art for selectable military companies. Resident
 * professionals use authored company still lifes; the two non-progressing
 * company types deliberately reuse their source-building identities.
 */
export const MILITARY_COMPANY_CARD_ART = {
  militia: '/assets/ui/build-menu/cards/town-hall.webp',
  spearmen: '/assets/ui/company-cards/spearmen.webp',
  'men-at-arms': '/assets/ui/company-cards/men-at-arms.webp',
  crossbows: '/assets/ui/company-cards/crossbows.webp',
  'mercenary-spears': '/assets/ui/build-menu/cards/guardhouse.webp',
  footmen: '/assets/ui/company-cards/footmen.webp',
  polearms: '/assets/ui/company-cards/polearms.webp',
  bowmen: '/assets/ui/company-cards/bowmen.webp',
  'uskok-border-infantry': '/assets/ui/company-cards/uskok-border-infantry.webp',
} as const satisfies Record<MilitaryCompanyKind, string>;
