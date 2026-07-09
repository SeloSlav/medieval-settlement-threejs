import * as THREE from 'three';
import { disposeObject3D } from '../utils/dispose.ts';
import { RoadMeshBuilder } from './RoadMeshBuilder.ts';
import { RoadNetwork } from './RoadNetwork.ts';
import type { SceneManager } from '../scene/SceneManager.ts';

export class RoadSelection {
  private readonly options: {
    camera: THREE.Camera;
    domElement: HTMLElement;
    network: RoadNetwork;
    sceneManager: SceneManager;
    onChange: () => void;
  };
  private readonly raycaster = new THREE.Raycaster();
  private readonly mouse = new THREE.Vector2();
  private selectedEdgeId: string | null = null;
  private highlight: THREE.Mesh | null = null;

  constructor(options: {
    camera: THREE.Camera;
    domElement: HTMLElement;
    network: RoadNetwork;
    sceneManager: SceneManager;
    onChange: () => void;
  }) {
    this.options = options;
  }

  getSelectedEdgeId(): string | null {
    return this.selectedEdgeId;
  }

  pick(clientX: number, clientY: number): boolean {
    const rect = this.options.domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    this.mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.mouse, this.options.camera);
    const hits = this.raycaster.intersectObjects(this.options.sceneManager.getRoadPickMeshes(), false);
    const edgeId = hits.find((hit) => typeof hit.object.userData.edgeId === 'string')?.object.userData.edgeId as string | undefined;
    this.setSelected(edgeId ?? null);
    return Boolean(edgeId);
  }

  setSelected(edgeId: string | null): void {
    if (edgeId === this.selectedEdgeId) return;
    this.selectedEdgeId = edgeId;
    this.refresh();
    this.options.onChange();
  }

  refresh(): void {
    if (this.highlight) {
      this.options.sceneManager.selectionGroup.remove(this.highlight);
      disposeObject3D(this.highlight);
      this.highlight = null;
    }
    if (!this.selectedEdgeId) return;
    const edge = this.options.network.edges.get(this.selectedEdgeId);
    if (!edge) {
      this.selectedEdgeId = null;
      return;
    }
    const builder: RoadMeshBuilder = this.options.sceneManager.roadMeshBuilder;
    this.highlight = builder.buildSelection(edge);
    if (this.highlight) this.options.sceneManager.selectionGroup.add(this.highlight);
  }

  deleteSelected(): boolean {
    if (!this.selectedEdgeId) return false;
    const deleted = this.options.network.deleteEdge(this.selectedEdgeId);
    this.selectedEdgeId = null;
    this.refresh();
    this.options.onChange();
    return deleted;
  }

  dispose(): void {
    this.setSelected(null);
  }
}

