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
      keys: hotkeyForGameSpeed(speed) ?? 'Click ⏸',
    })),
  },
  {
    title: 'Construction dock',
    entries: [
      { action: 'Road tool', keys: 'R' },
      { action: 'Build menu', keys: 'B' },
      { action: 'Military', keys: 'V' },
      { action: 'Map overlays (water, wind, fertility)', keys: 'O' },
      ...(import.meta.env.DEV
        ? [{ action: 'Debug menu', keys: 'M' }]
        : []),
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
      { action: 'Choose walk starting point', keys: '~' },
      { action: 'Cancel walk placement', keys: 'Right-click / Cancel' },
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
      { action: 'Settings', keys: 'Esc' },
      { action: 'World map', keys: 'Hold G' },
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
