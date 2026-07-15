import type { BuildingKind } from '../generated/gameBalance.ts';
import { BUILDING_KINDS } from '../generated/gameBalance.ts';
import { formatBuildingCost, getBuildingCost } from '../resources/buildingEconomy.ts';
import { getBuildingDefinition } from '../resources/buildings.ts';

export type ToolbarStats = {
  canBuild: boolean;
  hasDraft: boolean;
  mode: BuildingKind | 'road' | 'residences' | 'farm-fields' | 'pastures' | 'idle';
  statusDetail?: string | null;
};

export function isBuildingToolMode(mode: ToolbarStats['mode']): mode is BuildingKind {
  return (BUILDING_KINDS as readonly string[]).includes(mode);
}

export function isConstructionToolMode(mode: ToolbarStats['mode']): boolean {
  return isBuildingToolMode(mode) || mode === 'residences' || mode === 'farm-fields' || mode === 'pastures';
}

export function isBuilderHudMode(mode: ToolbarStats['mode']): boolean {
  return mode === 'road' || isConstructionToolMode(mode);
}

const PLACEMENT_STATUS_HINTS: Partial<Record<BuildingKind, string>> = {
  town_hall: ' — requires 24 people, a chapel, a marketplace, and road access',
  village_storehouse: ' — road-linked haulers collect producer overflow',
  well: ' — use the water map for best spots',
  hunters_hall: ' — click near a game trail',
  foragers_shed: ' — click near a berry patch',
  chapel: ' — place near a road',
  marketplace: ' — place near a road',
};

export function describeBuilderTitle(mode: ToolbarStats['mode']): string {
  switch (mode) {
    case 'road':
      return 'Roads';
    case 'residences':
      return 'Residences';
    case 'farm-fields':
      return 'Farm fields';
    case 'pastures':
      return 'Pastures and pannage';
    case 'idle':
      return 'Builder';
    default: {
      if (isBuildingToolMode(mode)) {
        return getBuildingDefinition(mode).label;
      }
      const unhandled: never = mode;
      return unhandled;
    }
  }
}

export function describeBuilderHelp(mode: ToolbarStats['mode']): string {
  switch (mode) {
    case 'road':
      return `
          <li><span>Toggle road tool</span><span class="road-controls-key">R</span></li>
          <li><span>Place point</span><span class="road-controls-key">L-click</span></li>
          <li><span>Undo last point</span><span class="road-controls-key">R-click</span></li>
          <li><span>Build road</span><span class="road-controls-key">Hammer or Enter</span></li>
          <li><span>Cancel / exit</span><span class="road-controls-key">Esc</span></li>
        `;
    case 'residences':
      return `
          <li><span>Frontage start</span><span class="road-controls-key">1st click on road</span></li>
          <li><span>Frontage end</span><span class="road-controls-key">2nd click on road</span></li>
          <li><span>Set backyard depth</span><span class="road-controls-key">3rd click behind road</span></li>
          <li><span>Adjust plot count</span><span class="road-controls-key">+ / − or on-zone controls</span></li>
          <li><span>Rotate frontage</span><span class="road-controls-key">F</span> <span class="road-controls-hint">(after frontage is set)</span></li>
          <li><span>Undo last step</span><span class="road-controls-key">R-click or Backspace</span></li>
          <li><span>Undo last placement</span><span class="road-controls-key">Ctrl + Z</span></li>
          <li><span>Redo placement</span><span class="road-controls-key">Ctrl + Y</span></li>
          <li><span>Place residences</span><span class="road-controls-key">Hammer or Enter</span></li>
          <li><span>Cancel / exit</span><span class="road-controls-key">Esc</span></li>
        `;
    case 'farm-fields':
      return `
          <li><span>Set baseline</span><span class="road-controls-key">1st + 2nd click</span></li>
          <li><span>Set field depth</span><span class="road-controls-key">3rd click</span></li>
          <li><span>Change crop</span><span class="road-controls-key">C</span></li>
          <li><span>Undo last point</span><span class="road-controls-key">R-click or Backspace</span></li>
          <li><span>Place field</span><span class="road-controls-key">Hammer or Enter</span></li>
          <li><span>Cancel / exit</span><span class="road-controls-key">Esc</span></li>
        `;
    case 'pastures':
      return `
          <li><span>Set baseline</span><span class="road-controls-key">1st + 2nd click</span></li>
          <li><span>Set pasture depth</span><span class="road-controls-key">3rd click</span></li>
          <li><span>Undo last point</span><span class="road-controls-key">R-click or Backspace</span></li>
          <li><span>Fence pasture</span><span class="road-controls-key">Hammer or Enter</span></li>
          <li><span>Cancel / exit</span><span class="road-controls-key">Esc</span></li>
        `;
    case 'idle':
      return '';
    default: {
      if (isBuildingToolMode(mode)) {
        return `
          <li><span>Place building</span><span class="road-controls-key">L-click</span></li>
          <li><span>Undo placement</span><span class="road-controls-key">Ctrl + Z</span></li>
          <li><span>Redo placement</span><span class="road-controls-key">Ctrl + Y</span></li>
          <li><span>Cancel tool</span><span class="road-controls-key">Esc</span></li>
        `;
      }
      const unhandled: never = mode;
      return unhandled;
    }
  }
}

export function describeToolbarStatus(stats: ToolbarStats): string {
  if (isBuildingToolMode(stats.mode)) {
    const hint = PLACEMENT_STATUS_HINTS[stats.mode] ?? '';
    const label = getBuildingDefinition(stats.mode).label;
    return `Click terrain to place a ${label.toLowerCase()} (${formatBuildingCost(getBuildingCost(stats.mode))})${hint}`;
  }
  if (stats.mode === 'residences') {
    return stats.statusDetail ?? 'Click along a road to start the frontage, then set depth behind it';
  }
  if (stats.mode === 'farm-fields') {
    return stats.statusDetail ?? "Draw a field inside a farmstead's work extent";
  }
  if (stats.mode === 'pastures') {
    return stats.statusDetail ?? "Draw a pasture inside a livestock building's work extent";
  }
  if (stats.mode !== 'road') return 'Road tool off';
  if (stats.canBuild) return 'Ready to build';
  if (stats.hasDraft) return 'Add more points';
  return 'Click terrain to start';
}
