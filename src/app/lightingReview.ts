import type { SceneManager } from '../scene/SceneManager.ts';
import type { CameraController } from '../camera/CameraController.ts';
import { gameClock } from '../world/gameCalendar.ts';
import { computeDayNightState } from '../world/dayNightPresentation.ts';
import { getConnection } from '../network/spacetimedbClient.ts';
import { trailerClock } from './trailerClock.ts';

/** Development-only controls operate the real game renderer in the saved city. */
export function installLightingReview(scene: SceneManager, camera: CameraController, host: HTMLElement): () => void {
  const controls = document.createElement('details');
  controls.open = true;
  controls.innerHTML = `<summary>Lighting review</summary>
    <label><input type="checkbox" aria-label="Hold lighting preview"> Hold frame for fixed-view inspection</label>
    <button type="button" data-redraw>Redraw frame</button>
    <label>View<select aria-label="Lighting review camera">
      <option value="wide">Reference overview</option><option value="near">House detail</option>
      <option value="far">Distant woodland</option><option value="street">Street level</option>
    </select></label>
    <div data-pose style="display:grid;grid-template-columns:1fr 1fr;gap:4px"></div>
    <button type="button" data-apply-pose>Apply view</button>
    <label>Conditions<select aria-label="Lighting review conditions"><option value="live">World season and weather</option>
      <option value="summer">Summer · fair</option><option value="rain">Summer · rain</option>
    </select></label>
    <label>Sun<select aria-label="Lighting review time"><option value="live">World clock</option>
      <option value="10">10:00</option><option value="14">14:00</option><option value="18">18:00</option><option value="0">Midnight</option>
    </select></label>
    <label>Pass<select aria-label="Lighting review pass"><option value="final">Final</option>
      <option value="lighting">Lighting only</option><option value="no-ao">No ambient occlusion</option>
      <option value="ao">Ambient occlusion</option><option value="normal">Normals</option>
      <option value="depth">Linear depth</option><option value="indirect">Ambient light</option>
    </select></label>
    <label><input type="checkbox" aria-label="Lighting review fog" checked> Atmospheric haze</label>
    <div data-tone style="display:grid;grid-template-columns:1fr 1fr;gap:4px"></div>
    <button type="button" data-apply-tone>Apply lighting</button>
    <button type="button" data-clean>Clean view (F8 restores controls)</button>
    <pre data-lighting-metrics style="white-space:pre-wrap;font-size:10px;max-height:130px;overflow:auto"></pre>`;
  controls.querySelectorAll('select').forEach(el => { el.style.cssText = 'width:100%;margin:4px 0'; });
  host.append(controls);
  let held = false;
  const requestFrame = () => { if (held) trailerClock.pending = true; };
  const hold = controls.querySelector<HTMLInputElement>('[aria-label="Hold lighting preview"]')!;
  const setHeld = (value: boolean) => {
    held = value;
    trailerClock.active = held;
    trailerClock.timeMs = performance.now();
    trailerClock.speed = 1;
    trailerClock.pending = held;
    camera.setInputEnabled(!held);
  };
  hold.onchange = () => setHeld(hold.checked);
  controls.querySelector<HTMLButtonElement>('[data-redraw]')!.onclick = requestFrame;
  window.addEventListener('resize', requestFrame);
  const view = controls.querySelector<HTMLSelectElement>('[aria-label="Lighting review camera"]')!;
  const poses: Record<string, [number, number, number, number, number]> = {
    wide: [-70, -220, -0.78, 0.65, 310], near: [-40, -185, -0.78, 0.5, 68],
    far: [-90, -160, -0.78, 0.65, 640], street: [-60, -198, -1.55, 0.18, 19],
  };
  const poseFields = ['Target X', 'Target Z', 'Yaw', 'Pitch', 'Distance'].map((name, index) => {
    const label = document.createElement('label');
    label.textContent = name;
    const input = document.createElement('input');
    input.type = 'number'; input.step = index === 2 || index === 3 ? '0.01' : '5';
    input.setAttribute('aria-label', `Lighting view ${name}`);
    input.style.width = '100%';
    input.value = String(poses.wide[index]);
    label.append(input); controls.querySelector('[data-pose]')!.append(label);
    return input;
  });
  const applyPose = () => {
    const pose = poseFields.map(input => Number(input.value));
    if (pose.every(Number.isFinite)) camera.applyShowcaseView(pose[0], pose[1], pose[2], pose[3], pose[4]);
    requestFrame();
  };
  poseFields.forEach(input => { input.onchange = applyPose; });
  controls.querySelector<HTMLButtonElement>('[data-apply-pose]')!.onclick = applyPose;
  view.onchange = () => {
    poseFields.forEach((input, index) => { input.value = String(poses[view.value][index]); });
    applyPose();
  };
  controls.querySelector<HTMLSelectElement>('[aria-label="Lighting review conditions"]')!.onchange = event => {
    scene.setLightingReviewEnvironment((event.target as HTMLSelectElement).value as 'live' | 'summer' | 'rain');
    requestFrame();
  };
  const tuningDefaults = [1, 100, 1, 1];
  const tuningFields = ['Exposure scale', 'Clear distance', 'Haze brightness', 'Haze density'].map((name, index) => {
    const label = document.createElement('label'); label.textContent = name;
    const input = document.createElement('input'); input.type = 'number';
    input.step = index === 1 ? '10' : '0.05'; input.value = String(tuningDefaults[index]);
    input.setAttribute('aria-label', `Lighting ${name}`); input.style.width = '100%';
    label.append(input); controls.querySelector('[data-tone]')!.append(label);
    return input;
  });
  const applyTuning = () => {
    const values = tuningFields.map(input => Number(input.value));
    scene.setLightingReviewTuning(values[0], values[1], values[2], values[3]);
    requestFrame();
  };
  tuningFields.forEach(input => { input.onchange = applyTuning; });
  controls.querySelector<HTMLButtonElement>('[data-apply-tone]')!.onclick = applyTuning;
  const time = controls.querySelector<HTMLSelectElement>('[aria-label="Lighting review time"]')!;
  const applyTime = () => {
    if (time.value === 'live') { scene.setLightingReviewState(null); requestFrame(); return; }
    const connection = getConnection();
    const tick = Number(connection ? [...connection.db.world_config.iter()][0]?.simTick ?? 0 : 0);
    const clock = gameClock(tick);
    clock.hour = Number(time.value); clock.minute = 0; clock.preciseHour = clock.hour;
    clock.preciseCalendarDay = Math.floor(clock.preciseCalendarDay ?? 0) + clock.hour / 24;
    scene.setLightingReviewState(computeDayNightState(clock, false));
    requestFrame();
  };
  time.onchange = applyTime;
  controls.querySelector<HTMLSelectElement>('[aria-label="Lighting review pass"]')!.onchange = (event) => {
    scene.setLightingDiagnostic((event.target as HTMLSelectElement).value);
    requestFrame();
  };
  controls.querySelector<HTMLInputElement>('[aria-label="Lighting review fog"]')!.onchange = (event) => {
    scene.setAtmosphereEnabled((event.target as HTMLInputElement).checked);
    requestFrame();
  };
  const style = document.createElement('style');
  style.textContent = 'body.lighting-clean > :not(#app):not(canvas):not(style):not(script) { visibility:hidden !important } body.lighting-clean [data-ui-root] { visibility:hidden !important } body.lighting-clean canvas { visibility:visible !important }';
  document.head.append(style);
  const toggleClean = () => document.body.classList.toggle('lighting-clean');
  controls.querySelector<HTMLButtonElement>('[data-clean]')!.onclick = toggleClean;
  const onKey = (event: KeyboardEvent) => { if (event.code === 'F8') { event.preventDefault(); toggleClean(); } };
  window.addEventListener('keydown', onKey);
  const timer = setInterval(() => {
    controls.querySelector('[data-lighting-metrics]')!.textContent = JSON.stringify(scene.getLightingDiagnostics(), null, 1);
  }, 1500);
  if (new URLSearchParams(location.search).get('lightingReview') === '1') {
    hold.checked = true; setHeld(true);
    controls.querySelector<HTMLSelectElement>('[aria-label="Lighting review conditions"]')!.value = 'summer';
    scene.setLightingReviewEnvironment('summer');
    time.value = '14'; applyTime(); applyPose();
  }
  return () => {
    clearInterval(timer); window.removeEventListener('keydown', onKey);
    window.removeEventListener('resize', requestFrame);
    if (held) setHeld(false);
    controls.remove(); style.remove(); document.body.classList.remove('lighting-clean');
  };
}
