import {
  GAME_SPEEDS,
  gameSpeedLabel,
  hotkeyForGameSpeed,
} from '../world/gameSpeed.ts';

export type GameControlEntry = {
  action: string;
  keys: string;
};

export type GameControlSection = {
  title: string;
  entries: readonly GameControlEntry[];
};

export const GAME_CONTROL_SECTIONS: readonly GameControlSection[] = [
  {
    title: 'Simulation speed',
    entries: GAME_SPEEDS.map((speed) => ({
      action: speed === 0 ? gameSpeedLabel(speed) : `${gameSpeedLabel(speed)} (${speed}×)`,
      keys: hotkeyForGameSpeed(speed) ?? '',
    })),
  },
  {
    title: 'Construction dock',
    entries: [
      { action: 'Road tool', keys: 'R' },
      { action: 'Build menu', keys: 'B' },
      { action: 'Agriculture menu', keys: 'U' },
      { action: 'Industry menu', keys: 'V' },
      { action: 'Defenses menu (frontier only)', keys: 'X' },
      { action: 'Map overlays (water, wind, fertility)', keys: 'M' },
      { action: 'Select Town Hall administration', keys: 'I' },
      { action: 'Settings', keys: 'Esc' },
    ],
  },
  {
    title: 'Camera',
    entries: [
      { action: 'Pan map', keys: 'Right-drag / WASD' },
      { action: 'Rotate view', keys: 'Middle-drag / Q E' },
      { action: 'Zoom', keys: 'Scroll wheel' },
      { action: 'World map', keys: 'Hold G' },
      { action: 'Walk mode', keys: '~' },
    ],
  },
  {
    title: 'Road placement',
    entries: [
      { action: 'Place point', keys: 'Left-click' },
      { action: 'Undo last point', keys: 'Right-click' },
      { action: 'Curve segment', keys: 'Ctrl + scroll' },
      { action: 'Build road', keys: 'Hammer or Enter' },
      { action: 'Delete segment', keys: 'Alt + left-click' },
      { action: 'Undo change', keys: 'Ctrl + Z' },
      { action: 'Redo change', keys: 'Ctrl + Y' },
      { action: 'Cancel / exit tool', keys: 'Esc' },
    ],
  },
  {
    title: 'Walk mode',
    entries: [
      { action: 'Move', keys: 'WASD' },
      { action: 'Sprint', keys: 'Shift' },
      { action: 'Jump', keys: 'Space' },
      { action: 'Crouch', keys: 'C' },
      { action: 'Free look', keys: 'Alt' },
      { action: 'Toggle walk mode', keys: '~' },
      { action: 'World map', keys: 'Hold G' },
      { action: 'Exit walk mode', keys: 'Esc' },
    ],
  },
  {
    title: 'Basic build menu',
    entries: [
      { action: 'Residence plots', keys: 'H' },
      { action: 'Well', keys: 'E' },
      { action: 'Church', keys: 'C' },
      { action: 'Monastery', keys: 'O' },
      { action: 'Marketplace', keys: 'P' },
    ],
  },
  {
    title: 'Agriculture build menu',
    entries: [
      { action: 'Farmstead', keys: 'T' },
      { action: 'Grain watermill', keys: 'M' },
      { action: 'Grain windmill', keys: 'I' },
      { action: 'Village granary', keys: 'N' },
      { action: 'Village bakery', keys: 'B' },
      { action: 'Brewhouse', keys: 'B' },
      { action: 'Smokehouse', keys: 'Q' },
      { action: 'Forest apiary', keys: 'A' },
      { action: 'Vineyard terrace', keys: 'V' },
    ],
  },
  {
    title: 'Industry build menu',
    entries: [
      { action: "Hunter's hall", keys: 'K' },
      { action: "Forager's shed", keys: 'Y' },
      { action: "Woodcutter's lodge", keys: 'W' },
      { action: 'Lumber mill', keys: 'L' },
      { action: 'Reforester', keys: 'F' },
      { action: "Stonecutter's camp", keys: 'S' },
      { action: 'Large Quarry', keys: 'G' },
      { action: 'Carpenter & wheelwright', keys: 'R' },
    ],
  },
  {
    title: 'Inspection & world',
    entries: [
      { action: 'Inspect buildings and resources', keys: 'Left-click' },
      { action: 'Lay out farm field', keys: 'Farmstead inspector' },
      { action: 'Fence pasture / pannage', keys: 'Livestock inspector' },
      { action: 'Close inspector / panel', keys: 'Esc' },
      { action: 'Rotate residence frontage', keys: 'F (while placing)' },
      { action: 'Adjust residence plot count', keys: '+ / − on layout HUD' },
    ],
  },
];
