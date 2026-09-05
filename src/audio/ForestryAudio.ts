import * as THREE from 'three';
import type { ForestrySoundEvent } from '../forestry/forestry.ts';
import type { CrowdViewState } from '../settlement/crowdView.ts';
import { worldFoleyGain } from './WorldFoleyAudio.ts';

export const FORESTRY_CLIPS = {
  fall: '/sounds/world/tree_fall.mp3',
  impact: '/sounds/world/tree_impact.mp3',
} as const;

/** Events are emitted by the rendered hinge timeline, including exact contact. */
export class ForestryAudio {
  private readonly context = THREE.AudioContext.getContext() as unknown as globalThis.AudioContext;
  private readonly buffers = new Map<ForestrySoundEvent['kind'], AudioBuffer>();
  private readonly active = new Set<{ event: ForestrySoundEvent; source: AudioBufferSourceNode; gain: GainNode; pan: StereoPannerNode }>();
  private enabled = true;
  private volume = 1;
  private disposed = false;
  private readonly right = new THREE.Vector3();
  constructor() {
    for (const kind of ['fall', 'impact'] as const) {
      void fetch(FORESTRY_CLIPS[kind]).then(response => {
        if (!response.ok) throw new Error(`Forestry audio ${response.status}`);
        return response.arrayBuffer();
      }).then(bytes => this.context.decodeAudioData(bytes)).then(buffer => {
        if (!this.disposed) this.buffers.set(kind, buffer);
      }).catch(error => console.warn('[ForestryAudio]', error));
    }
  }
  tick(events: readonly ForestrySoundEvent[], view: CrowdViewState, camera: THREE.Camera): void {
    this.right.set(1,0,0).applyQuaternion(camera.quaternion);
    for (const event of events) {
      if (event.kind === 'impact') {
        for (const playing of this.active) {
          if (playing.event.layoutIndex === event.layoutIndex && playing.event.kind === 'fall') playing.source.stop();
        }
      }
      if (!this.enabled || worldFoleyGain(event.x, event.z, view) <= 0) continue;
      const buffer = this.buffers.get(event.kind);
      if (!buffer || this.context.state !== 'running' || this.active.size >= 8) continue;
      const source = this.context.createBufferSource();
      const gain = this.context.createGain();
      const pan = this.context.createStereoPanner();
      source.buffer = buffer;
      source.connect(gain).connect(pan).connect(this.context.destination);
      const playing = { event, source, gain, pan };
      this.active.add(playing);
      source.onended = () => { this.active.delete(playing); source.disconnect(); gain.disconnect(); pan.disconnect(); };
      source.start();
    }
    for (const playing of this.active) {
      const gain = this.enabled ? worldFoleyGain(playing.event.x, playing.event.z, view) * this.volume * 0.8 : 0;
      playing.gain.gain.setTargetAtTime(gain, this.context.currentTime, 0.035);
      const dx = playing.event.x - (view.listenerX ?? view.centerX);
      const dz = playing.event.z - (view.listenerZ ?? view.centerZ);
      const pan = (dx*this.right.x + dz*this.right.z) / Math.max(4, Math.hypot(dx,dz));
      playing.pan.pan.setTargetAtTime(Math.max(-1,Math.min(1,pan)), this.context.currentTime, 0.035);
    }
  }
  setEnabled(enabled: boolean): void { this.enabled = enabled; if (!enabled) this.stop(); }
  setVolume(volume: number): void { this.volume = Math.max(0, Math.min(1,volume)); }
  stop(): void { for (const playing of this.active) playing.source.stop(); this.active.clear(); }
  dispose(): void { this.disposed = true; this.stop(); this.buffers.clear(); }
}
