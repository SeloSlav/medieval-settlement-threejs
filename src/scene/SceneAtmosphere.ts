import * as THREE from 'three';
import { sceneTsl } from './sceneTsl.ts';
const { cameraPosition, distance, exp, fog, max, mix, positionWorld, reference, smoothstep, uniform } = sceneTsl;

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
    const rayLength = distance(cameraPosition, positionWorld);
    const fogDistance = max(rayLength.sub(this.clearDistance), 0);
    const cameraDensity = exp(max(cameraPosition.y, 0).mul(-0.006));
    const surfaceDensity = exp(max(positionWorld.y, 0).mul(-0.006));
    // Simpson integration of the height density is finite for horizontal rays.
    const middleDensity = exp(max(cameraPosition.y.add(positionWorld.y).mul(0.5), 0).mul(-0.006));
    const heightDensity = cameraDensity.add(middleDensity.mul(4)).add(surfaceDensity).div(6);
    const airDensity = mix(0.32, 1, heightDensity);
    const opticalDepth = fogDistance.mul(reference('density', 'float', source)).mul(airDensity).mul(this.densityScale);
    const factor = opticalDepth.mul(opticalDepth).negate().exp().oneMinus()
      .mul(smoothstep(0, 100, fogDistance)).mul(this.enabled);
    this.visibility = factor.oneMinus();
    this.node = fog(reference('color', 'color', source).mul(this.brightness), factor);
  }
}
