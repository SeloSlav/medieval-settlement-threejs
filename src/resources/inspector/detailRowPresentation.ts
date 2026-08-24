export type InspectorDetailState = 'warning' | 'positive' | null;

const POSITIVE_SAFETY_VALUE = /(?:structurally\s+fire-safe|\bfire-safe\b|\bfireproof\b|\bno (?:active |current )?fires?\b|\bno (?:spread )?exposure\b|\bisolated\b.*\bno other (?:occupied )?structures?\b)/;
const NEGATIVE_VALUE = /(?:\bunsafe\b|\bnot safe\b|\bburning\b|\bburned\b|\bdestroyed\b|\bdanger\b|\bcritical\b|\bblocked\b|\bshortage\b|\bstarv\w*\b|\bdamag(?:e|ed)\b|\bexposed\b|\bunserved\b|\buncovered\b|\bunready\b|\bnot ready\b|\bno ready\b|\bsevere\b)/;
const POSITIVE_VALUE = /(?:\bsafe\b|\bready\b|\bcomplete\b|\bhealthy\b|\bconnected\b|\bactive\b|\bstaffed\b|\bsupplied\b|\bsecure\b|\bisolated\b)/;
const WARNING_ROW = /(?:\bfire\b|\bburn\w*\b|\bdestroy\w*\b|\bdanger\b|\bcritical\b|\bblocked\b|\bshortage\b|\bstarv\w*\b|\bdamag\w*\b|\bexpos\w*\b|\bunserved\b)/;

/**
 * Derives presentation from the row's actual message, not just its subject.
 * This keeps labels such as "Fire risk" and "Spread exposure" from turning
 * an explicitly safe result into a warning.
 */
export function inspectorDetailState(
  label: string,
  value: string,
  authoredState?: string,
): InspectorDetailState {
  if (
    authoredState === 'warning'
    || authoredState === 'positive'
  ) {
    return authoredState;
  }

  const normalizedValue = value.toLowerCase();
  const normalizedRow = `${label} ${value}`.toLowerCase();

  if (POSITIVE_SAFETY_VALUE.test(normalizedValue)) return 'positive';
  if (NEGATIVE_VALUE.test(normalizedValue)) return 'warning';
  if (POSITIVE_VALUE.test(normalizedValue)) return 'positive';
  if (WARNING_ROW.test(normalizedRow)) return 'warning';
  return null;
}

export function inspectorDetailIcon(
  normalized: string,
  state: InspectorDetailState,
): string {
  if (state === 'positive') return '\u2713';
  if (state === 'warning') return '!';
  if (/(timber|firewood|wood|log)/.test(normalized)) return '\u2571';
  if (/(labor|worker|staff|builder|crew)/.test(normalized)) return '\u2692';
  if (/(stone|quarry|rock)/.test(normalized)) return '\u25C6';
  if (/(water|river|well)/.test(normalized)) return '\u224B';
  if (/(food|grain|flour|ale|honey|wine|crop|yield|field|fertility)/.test(normalized)) return '\u2767';
  if (/(house|resident|population|shelter|home|vacant)/.test(normalized)) return '\u2302';
  if (/(road|cart|route|delivery|haul)/.test(normalized)) return '\u21C4';
  if (/(gold|coin|tax|receipt|wealth|wage)/.test(normalized)) return '\u25C9';
  if (/(guard|watch|security|threat|arm|polearm)/.test(normalized)) return '\u2726';
  if (/(stored|storage|stock|capacity|warehouse)/.test(normalized)) return '\u25A3';
  return '\u25C7';
}
