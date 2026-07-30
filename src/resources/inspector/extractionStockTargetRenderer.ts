import {
  EXTRACTION_OUTPUT_TARGET_PRESETS,
  extractionOutputHeadroom,
  extractionOutputTarget,
  isExtractionOutputTargetKind,
  normalizeProcessorOutputTargetPercent,
  type ExtractionOutputCommodity,
} from '../../economy/processorOutputPolicy.ts';
import type { BuildingState } from '../types.ts';

export function renderExtractionStockTargetPanel(
  building: BuildingState,
  commodity: ExtractionOutputCommodity,
): string | null {
  if (!isExtractionOutputTargetKind(building.kind)) return null;
  const percent = normalizeProcessorOutputTargetPercent(
    building.processorOutputTargetPercent,
  );
  const stock = Math.max(0, building[commodity] ?? 0);
  const target = extractionOutputTarget(building.kind, commodity, percent);
  const headroom = extractionOutputHeadroom(building, commodity) ?? 0;
  const pressure = headroom > 0.05
    ? `${headroom.toFixed(0)} extraction headroom`
    : stock > target + 0.05
      ? `${(stock - target).toFixed(0)} above target - still available`
      : 'Extraction paused at target';

  return `
    <div class="inspector-action-panel">
      <p class="resource-inspector-note">Extraction yard policy · ${commodity} ${stock.toFixed(0)} / ${target.toFixed(0)} · ${pressure}</p>
      <div class="resource-action-row">${EXTRACTION_OUTPUT_TARGET_PRESETS
        .map((preset) => `<button type="button" class="resource-action-button" data-processor-output-target="${preset.percent}" title="${preset.hint}" ${percent === preset.percent ? 'disabled' : ''}>${preset.label} · ${preset.percent}%</button>`)
        .join('')}</div>
      <p class="inspector-action-panel__hint">This is an on-site output ceiling, not a protected reserve. Consumer carts may draw below it and restart extraction. Lower targets preserve finite deposits and let production stewardship recall excess crews; paused deep workings also avoid timber-support and tool wear. Stock already above a newly lowered target remains physical and available, and a cart already moving may still change the yard.</p>
    </div>
  `;
}
