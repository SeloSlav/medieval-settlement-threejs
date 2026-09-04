import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path: string): string => readFileSync(path, 'utf8');

const bandits = read('server/src/simulation/bandits.rs');
assert.match(bandits, /road_path_route_from_external_access/);
assert.match(bandits, /walk_bandit_theft_route/);
assert.match(bandits, /route_progress_for_position/);
assert.match(
  bandits,
  /agent\.state == FIGHTING[\s\S]{0,260}dist\(agent\.x, agent\.z, agent\.home_x, agent\.home_z\) <= 8\.0[\s\S]{0,120}RETURNING/,
);
assert.match(
  bandits,
  /HOLDING =>[\s\S]{0,320}dist\(agent\.x, agent\.z, agent\.home_x, agent\.home_z\) > 8\.0[\s\S]{0,420}agent\.state = RETURNING/,
);

const wildlife = read('server/src/simulation/wild_animals.rs');
assert.match(wildlife, /ROAD_PATROL_TARGET_TAG/);
assert.match(wildlife, /next_road_patrol_target/);
assert.match(wildlife, /move_dog_over_roads/);
assert.match(wildlife, /road_path_route\(dog\.home_x, dog\.home_z, x, z\)/);

const roads = read('server/src/roads/network.rs');
assert.match(roads, /patrol_stops: Vec<\(f64, f64\)>/);
assert.match(roads, /pub fn road_patrol_stop_count/);
assert.match(roads, /pub fn road_patrol_stop/);
assert.match(roads, /fn patrol_stops_pair_every_road_edge_in_stable_order/);

const simulation = read('server/src/reducers/simulation.rs');
assert.match(
  simulation,
  /step_bandit_world\([\s\S]{0,300}heartbeat_sim_seconds,[\s\S]{0,80}shared_road_networks\.as_ref\(\)/,
);
assert.match(
  simulation,
  /step_wild_animal_world\([\s\S]{0,340}heartbeat_sim_seconds,[\s\S]{0,80}shared_road_networks\.as_ref\(\)/,
);

console.log('bandit and guard-dog road patrol tests passed');
