import type { WorldGenerationSettings } from './worldGenerationSettings.ts';

export type WorldDifficultyPresetId = 'easy' | 'normal' | 'hardcore';

export type WorldDifficultyRuleSettings = Pick<
  WorldGenerationSettings,
  | 'conflictMode'
  | 'enemyPressure'
  | 'banditCampsEnabled'
  | 'severeWeatherEnabled'
  | 'wellAquiferNetworksEnabled'
  | 'approvalDeclineRate'
  | 'foodSpoilageRate'
  | 'initialGoodsMultiplier'
  | 'militaryDemands'
>;

export type WorldDifficultyPreset = {
  id: WorldDifficultyPresetId;
  badgeLabel: string;
  name: string;
  description: string;
  settings: WorldDifficultyRuleSettings;
};

export type WorldDifficultyPresentation = {
  id: WorldDifficultyPresetId | 'custom';
  badgeLabel: string;
  title: string;
  summary: string;
};

export const WORLD_DIFFICULTY_PRESETS: readonly WorldDifficultyPreset[] = [
  {
    id: 'easy',
    badgeLabel: 'Easy',
    name: 'Pampered Page (Easy)',
    description: 'No losses or raids; double supplies.',
    settings: {
      conflictMode: 'peaceful',
      enemyPressure: 0,
      banditCampsEnabled: false,
      severeWeatherEnabled: false,
      wellAquiferNetworksEnabled: false,
      approvalDeclineRate: 0,
      foodSpoilageRate: 0,
      initialGoodsMultiplier: 2,
      militaryDemands: 0,
    },
  },
  {
    id: 'normal',
    badgeLabel: 'Normal',
    name: 'Steadfast Castellan (Normal)',
    description: 'Standard losses and starting supplies.',
    settings: {
      conflictMode: 'peaceful',
      enemyPressure: 0,
      banditCampsEnabled: true,
      severeWeatherEnabled: false,
      wellAquiferNetworksEnabled: false,
      approvalDeclineRate: 100,
      foodSpoilageRate: 100,
      initialGoodsMultiplier: 1,
      militaryDemands: 1,
    },
  },
  {
    id: 'hardcore',
    badgeLabel: 'Hardcore',
    name: 'Marcher Lord (Hardcore)',
    description: 'Maximum losses, raids, and severe weather.',
    settings: {
      conflictMode: 'frontier',
      enemyPressure: 100,
      banditCampsEnabled: true,
      severeWeatherEnabled: true,
      wellAquiferNetworksEnabled: true,
      approvalDeclineRate: 150,
      foodSpoilageRate: 150,
      initialGoodsMultiplier: 1,
      militaryDemands: 3,
    },
  },
];

export const WORLD_DIFFICULTY_PRESET_ORDER = WORLD_DIFFICULTY_PRESETS.map(
  (preset) => preset.id,
);

export function difficultyPresetForSettings(
  settings: WorldGenerationSettings,
): WorldDifficultyPreset | undefined {
  return WORLD_DIFFICULTY_PRESETS.find((preset) => (
    preset.settings.conflictMode === settings.conflictMode
    && preset.settings.enemyPressure === settings.enemyPressure
    && preset.settings.banditCampsEnabled === settings.banditCampsEnabled
    && preset.settings.severeWeatherEnabled === settings.severeWeatherEnabled
    && preset.settings.wellAquiferNetworksEnabled === settings.wellAquiferNetworksEnabled
    && preset.settings.approvalDeclineRate === settings.approvalDeclineRate
    && preset.settings.foodSpoilageRate === settings.foodSpoilageRate
    && preset.settings.initialGoodsMultiplier === settings.initialGoodsMultiplier
    && preset.settings.militaryDemands === settings.militaryDemands
  ));
}

export function describeWorldDifficulty(
  settings: WorldGenerationSettings,
): WorldDifficultyPresentation {
  const preset = difficultyPresetForSettings(settings);
  const approval = {
    0: 'Disabled',
    50: 'Relaxed',
    100: 'Normal',
    150: 'Demanding',
  }[settings.approvalDeclineRate];
  const spoilage = {
    0: 'None',
    50: 'Reduced',
    100: 'Normal',
    150: 'Harsh',
  }[settings.foodSpoilageRate];
  const settlement = settings.conflictMode === 'frontier'
    ? `Frontier (${settings.enemyPressure}% pressure)`
    : 'Peaceful';
  const militaryDemands = {
    0: 'Muster only',
    1: 'Light rations',
    2: 'Full upkeep',
    3: 'Campaign burden',
  }[settings.militaryDemands];
  const summary = [
    `Settlement: ${settlement}`,
    `Bandit presence: ${settings.banditCampsEnabled ? 'Roaming camps' : 'None'}`,
    `Military demands: ${militaryDemands}`,
    `Approval decline: ${approval}`,
    `Food spoilage: ${spoilage}`,
    `Camp supplies: ${settings.initialGoodsMultiplier === 2 ? 'Double' : 'Normal'}`,
    `Weather: ${settings.severeWeatherEnabled ? 'Severe' : 'Normal'}`,
    `Groundwater: ${settings.wellAquiferNetworksEnabled ? 'Aquifers' : 'Even'}`,
  ].join(' · ');

  return {
    id: preset?.id ?? 'custom',
    badgeLabel: preset?.badgeLabel ?? 'Custom',
    title: preset?.name ?? 'Custom Difficulty',
    summary,
  };
}
