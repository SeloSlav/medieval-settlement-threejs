import * as THREE from 'three';
import { sceneTsl } from './sceneTsl.ts';
import { gameMode } from '../multiplayer/gameMode.ts';
import { realmFogBuffer } from '../multiplayer/realmVisibility.ts';
import { REALM, REALM_FOG_CELLS_PER_SIDE } from '../multiplayer/realmPolicy.ts';
const { cameraPosition, distance, exp, fog, max, mix, positionWorld, reference, renderGroup, smoothstep, uniform } = sceneTsl;

/** Shared, world-space air visibility for materials and the ambient-light MRT.
 * Fog is evaluated before bloom/tone mapping, including on transparent surfaces.
 * The clear near interval preserves ground contrast; the height integral keeps
 * low woodland hazy while elevated crowns and ridges remain separated.
 */
export class SceneAtmosphere {
  readonly enabled = uniform(1);
  readonly clearDistance = uniform(100);
  readonly brightness = uniform(1);
  readonly densityScale = uniform(1);
  readonly visibility;
  readonly node;

  constructor(source: THREE.FogExp2) {
    for (const node of [this.enabled, this.clearDistance, this.brightness, this.densityScale]) {
      node.setGroup(renderGroup);
    }
    const rayLength = distance(cameraPosition, positionWorld);
    const fogDistance = max(rayLength.sub(this.clearDistance), 0);
    const cameraDensity = exp(max(cameraPosition.y, 0).mul(-0.006));
    const surfaceDensity = exp(max(positionWorld.y, 0).mul(-0.006));
    // Simpson integration of the height density is finite for horizontal rays.
    const middleDensity = exp(max(cameraPosition.y.add(positionWorld.y).mul(0.5), 0).mul(-0.006));
    const heightDensity = cameraDensity.add(middleDensity.mul(4)).add(surfaceDensity).div(6);
    const airDensity = mix(0.32, 1, heightDensity);
    const opticalDepth = fogDistance.mul(reference('density', 'float', source).setGroup(renderGroup)).mul(airDensity).mul(this.densityScale);
    const factor = opticalDepth.mul(opticalDepth).negate().exp().oneMinus()
      .mul(smoothstep(0, 100, fogDistance)).mul(this.enabled);
    const airColor = reference('color', 'color', source).setGroup(renderGroup).mul(this.brightness);
    if (gameMode() === 'multiplayer') {
      const uv = sceneTsl.vec2(positionWorld.x, positionWorld.z).add(REALM.size / 2).div(REALM.size);
      // Storage avoids adding a seventeenth sampled texture to the terrain and
      // foliage shaders on adapters with the standard 16-texture stage limit.
      const cell = sceneTsl.floor(uv.mul(REALM_FOG_CELLS_PER_SIDE)).clamp(0, REALM_FOG_CELLS_PER_SIDE - 1);
      const index = sceneTsl.uint(cell.y.mul(REALM_FOG_CELLS_PER_SIDE).add(cell.x));
      const sight = sceneTsl.float(sceneTsl.storage(realmFogBuffer, 'uint', REALM_FOG_CELLS_PER_SIDE ** 2).toReadOnly().element(index)).div(255);
      const veil = sight.oneMinus();
      this.visibility = factor.oneMinus().mul(sight);
      this.node = fog(mix(airColor, sceneTsl.vec3(0.018, 0.023, 0.029), veil), max(factor, veil));
    } else {
      this.visibility = factor.oneMinus();
      this.node = fog(airColor, factor);
    }
  }
}
