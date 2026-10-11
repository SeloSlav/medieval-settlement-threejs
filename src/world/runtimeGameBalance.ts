export * from '../generated/gameBalance.ts';
import { SIM_REALTIME_RATE as SINGLE_PLAYER_RATE } from '../generated/gameBalance.ts';
import { isMultiplayer } from '../multiplayer/gameMode.ts';
import { REALM } from '../multiplayer/realmPolicy.ts';
/** One shared five-minute realm day; generated economic costs stay unchanged. */
export const SIM_REALTIME_RATE = isMultiplayer() ? REALM.simulationRealtimeRate : SINGLE_PLAYER_RATE;
