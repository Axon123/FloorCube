import {
  BoxHelper,
  Color,
  DirectionalLight,
  Fog,
  GridHelper,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  PCFShadowMap,
  Plane,
  Points,
  PointsMaterial,
  Raycaster,
  Scene,
  Shape,
  ShapeGeometry,
  TorusGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
  BoxGeometry,
  BufferGeometry,
  Float32BufferAttribute,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { allPlanPoints, roomColor, wallLength } from '../core/schema';
import type { FloorPlan, FurnitureItem, Wall } from '../core/schema';
import { planBounds, polygonArea, polygonCentroid, snap } from '../core/geometry';
import type { Vec2 } from '../core/geometry';
import { validateFurniture } from '../core/placement';
import type { PlanStore } from '../core/store';
import { createFurnitureModel, getFurnitureDefinition } from '../models/catalog';
import type { FurnitureModelId } from '../models/catalog';
import { material } from '../models/primitives';

export interface SceneSettings {
  wallMode: 'solid' | 'ghost' | 'low';
  showGrid: boolean;
  showLabels: boolean;
  showDimensions: boolean;
  autoRotate: boolean;
  rotateSpeed: number;
  lightIntensity: number;
  quality: 'high' | 'balanced';
  snapEnabled: boolean;
}

export const DEFAULT_SCENE_SETTINGS: SceneSettings = {
  wallMode: 'low',
  showGrid: true,
  showLabels: true,
  showDimensions: false,
  autoRotate: true,
  rotateSpeed: 0.6,
  lightIntensity: 1,
  quality: 'high',
  snapEnabled: true,
};

export interface SceneCallbacks {
  onSelectFurniture: (id: string | null) => void;
  onSelectRoom: (id: string | null) => void;
  onFurnitureTransform: (id: string, position: Vec2, rotation: number) => void;
  onFurnitureDragStart: (id: string) => void;
  onFurnitureDragEnd: (id: string, valid: boolean) => void;
  onPlace: (model: FurnitureModelId, position: Vec2, roomId?: string) => void;
  onFeedback: (message: string, kind?: 'info' | 'success' | 'warning') => void;
  onOrbitHold?: (state: { phase: 'drag' | 'hold' | 'off'; seconds: number }) => void;
}

const ORBIT_HOLD_MS = 10_000;

interface DragState {
  id: string;
  offset: Vec2;
  start: Vec2;
  rotation: number;
  valid: boolean;
}

function disposeObject(object: Object3D) {
  object.traverse((child) => {
    if (child instanceof Mesh || child instanceof Points) {
      const geometry = child.geometry as BufferGeometry;
      if (!geometry.userData.shared) geometry.dispose();
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const item of materials) {
        if (!item.userData.shared) item.dispose();
      }
    }
    if (child instanceof CSS2DObject) child.element.remove();
  });
}

export class FloorScene {
  private scene = new Scene();
  private camera = new PerspectiveCamera(38, 1, 0.05, 120);
  private renderer: WebGLRenderer;
  private labelRenderer = new CSS2DRenderer();
  private controls: OrbitControls;
  private planGroup = new Group();
  private furnitureGroup = new Group();
  private labelGroup = new Group();
  private baseGroup = new Group();
  private grid: GridHelper | null = null;
  private particles: Points;
  private keyLight: DirectionalLight;
  private raycaster = new Raycaster();
  private groundPlane = new Plane(new Vector3(0, 1, 0), 0);
  private pointer = new Vector2();
  private center: Vec2 = [0, 0];
  private settings: SceneSettings = { ...DEFAULT_SCENE_SETTINGS };
  private placementModel: FurnitureModelId | null = null;
  private ghost: Group | null = null;
  private ghostRing: Mesh;
  private selectionRing: Mesh;
  private selectionBox: BoxHelper | null = null;
  private drag: DragState | null = null;
  private downPoint = new Vector2();
  private resizeObserver: ResizeObserver;
  private clock = performance.now();
  private disposed = false;
  private orbitHeld = false;
  private lastOrbitEnd = -Infinity;
  private rotateRamp = 0;
  private lastHoldKey = '';

  constructor(private container: HTMLElement, private store: PlanStore, private callbacks: SceneCallbacks) {
    this.renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.outputColorSpace = 'srgb';
    this.renderer.domElement.className = 'scene-canvas';
    this.container.appendChild(this.renderer.domElement);

    this.labelRenderer.domElement.className = 'label-layer';
    this.container.appendChild(this.labelRenderer.domElement);

    this.scene.background = new Color(0x202723);
    this.scene.fog = new Fog(0x202723, 24, 52);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.075;
    this.controls.minDistance = 2;
    this.controls.maxDistance = 42;
    this.controls.minPolarAngle = 0.08;
    this.controls.maxPolarAngle = 1.34;
    this.controls.autoRotateSpeed = this.settings.rotateSpeed;
    this.controls.addEventListener('start', this.onOrbitStart);
    this.controls.addEventListener('end', this.onOrbitEnd);

    this.scene.add(new HemisphereLight(0xfff1d8, 0x536058, 1.35));
    this.keyLight = new DirectionalLight(0xffd8a2, 2.6);
    this.keyLight.position.set(7, 10, 5);
    this.keyLight.castShadow = true;
    this.keyLight.shadow.mapSize.set(2048, 2048);
    this.keyLight.shadow.camera.left = -12;
    this.keyLight.shadow.camera.right = 12;
    this.keyLight.shadow.camera.top = 12;
    this.keyLight.shadow.camera.bottom = -12;
    this.keyLight.shadow.camera.far = 40;
    this.keyLight.shadow.normalBias = 0.03;
    this.scene.add(this.keyLight);
    const rim = new DirectionalLight(0x9ec5ff, 1.05);
    rim.position.set(-7, 5, -6);
    this.scene.add(rim);
    const fill = new DirectionalLight(0xffe7cf, 0.5);
    fill.position.set(0, 4, -7);
    this.scene.add(fill);

    const particleGeometry = new BufferGeometry();
    const positions: number[] = [];
    for (let index = 0; index < 140; index += 1) {
      positions.push((Math.random() - 0.5) * 24, Math.random() * 7 + 0.4, (Math.random() - 0.5) * 24);
    }
    particleGeometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    this.particles = new Points(particleGeometry, new PointsMaterial({ color: 0xffe6ad, size: 0.035, transparent: true, opacity: 0.42, depthWrite: false }));
    this.scene.add(this.particles);

    this.scene.add(this.baseGroup, this.planGroup, this.furnitureGroup, this.labelGroup);

    const ringGeometry = new TorusGeometry(1, 0.022, 8, 48);
    this.selectionRing = new Mesh(ringGeometry, new MeshBasicMaterial({ color: 0xe8a33d, transparent: true, opacity: 0.95 }));
    this.selectionRing.rotation.x = -Math.PI / 2;
    this.selectionRing.visible = false;
    this.scene.add(this.selectionRing);
    this.ghostRing = new Mesh(ringGeometry, new MeshBasicMaterial({ color: 0x79b473, transparent: true, opacity: 0.9 }));
    this.ghostRing.rotation.x = -Math.PI / 2;
    this.ghostRing.visible = false;
    this.scene.add(this.ghostRing);

    this.renderer.domElement.addEventListener('pointerdown', this.onPointerDown);
    this.renderer.domElement.addEventListener('pointermove', this.onPointerMove);
    this.renderer.domElement.addEventListener('pointerup', this.onPointerUp);
    this.renderer.domElement.addEventListener('pointerleave', this.onPointerLeave);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.container);
    this.resize();
    this.rebuild();
    this.resetCamera();
    this.renderer.setAnimationLoop(this.animate);
  }

  private resize() {
    const { width, height } = this.container.getBoundingClientRect();
    if (width === 0 || height === 0) return;
    const previousAspect = this.camera.aspect;
    this.renderer.setSize(width, height);
    this.labelRenderer.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    if (previousAspect > 0 && Math.abs(previousAspect - this.camera.aspect) > 0.02) {
      const previousFactor = Math.max(1, 1 / Math.max(previousAspect, 0.35));
      const nextFactor = Math.max(1, 1 / Math.max(this.camera.aspect, 0.35));
      const ratio = nextFactor / previousFactor;
      if (Math.abs(ratio - 1) > 0.01) {
        const offset = this.camera.position.clone().sub(this.controls.target).multiplyScalar(ratio);
        this.camera.position.copy(this.controls.target).add(offset);
        this.controls.update();
      }
    }
  }

  private animate = () => {
    if (this.disposed) return;
    const now = performance.now();
    const rawDelta = (now - this.clock) / 1000;
    const delta = Math.min(rawDelta, 0.05);
    this.clock = now;
    const idleMs = now - this.lastOrbitEnd;
    const ambient = this.settings.autoRotate && !this.drag && !this.placementModel && !this.orbitHeld && idleMs > ORBIT_HOLD_MS;
    this.rotateRamp = ambient ? Math.min(1, this.rotateRamp + delta / 2) : 0;
    this.controls.autoRotate = this.rotateRamp > 0;
    this.controls.autoRotateSpeed = this.settings.rotateSpeed * this.rotateRamp;
    // 阻尼按帧衰减会导致低帧率设备惯性拖尾数倍变长，换算成按时间衰减保持手感一致
    this.controls.dampingFactor = Math.min(0.9, Math.max(0.02, 1 - Math.pow(1 - 0.075, rawDelta * 60)));
    this.controls.update(delta);
    this.particles.rotation.y += delta * 0.018;
    this.renderer.render(this.scene, this.camera);
    this.labelRenderer.render(this.scene, this.camera);
    const phase = !this.settings.autoRotate ? 'off' : this.orbitHeld ? 'drag' : idleMs <= ORBIT_HOLD_MS ? 'hold' : 'off';
    const seconds = phase === 'hold' ? Math.max(1, Math.ceil((ORBIT_HOLD_MS - idleMs) / 1000)) : 0;
    const holdKey = `${phase}:${seconds}`;
    if (holdKey !== this.lastHoldKey) {
      this.lastHoldKey = holdKey;
      this.callbacks.onOrbitHold?.({ phase, seconds });
    }
  };

  private onOrbitStart = () => {
    this.orbitHeld = true;
  };

  private onOrbitEnd = () => {
    this.orbitHeld = false;
    this.lastOrbitEnd = performance.now();
  };

  private world(point: Vec2, y = 0) {
    return new Vector3(point[0] - this.center[0], y, point[1] - this.center[1]);
  }

  private toPlan(vector: Vector3): Vec2 {
    return [vector.x + this.center[0], vector.z + this.center[1]];
  }

  private groundPoint(event: PointerEvent): Vec2 | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = new Vector3();
    return this.raycaster.ray.intersectPlane(this.groundPlane, hit) ? this.toPlan(hit) : null;
  }

  private maybeSnap(point: Vec2): Vec2 {
    return this.settings.snapEnabled ? [snap(point[0]), snap(point[1])] : point;
  }

  rebuild() {
    const plan = this.store.plan;
    disposeObject(this.planGroup);
    disposeObject(this.furnitureGroup);
    disposeObject(this.labelGroup);
    disposeObject(this.baseGroup);
    this.planGroup.clear();
    this.furnitureGroup.clear();
    this.labelGroup.clear();
    this.baseGroup.clear();
    this.clearSelectionBox();

    const bounds = planBounds(allPlanPoints(plan));
    this.center = [bounds.minX + bounds.width / 2, bounds.minY + bounds.depth / 2];
    const maxDim = Math.max(bounds.width, bounds.depth, 4);

    const base = new Mesh(new RoundedBoxGeometry(bounds.width + 1.5, 0.22, bounds.depth + 1.5, 3, 0.12), material(0xd9cbb2, { roughness: 0.92 }));
    base.position.y = -0.13;
    base.receiveShadow = true;
    this.baseGroup.add(base);
    const baseEdge = new Mesh(new RoundedBoxGeometry(bounds.width + 1.7, 0.1, bounds.depth + 1.7, 3, 0.08), material(0x8d7c62, { roughness: 0.9 }));
    baseEdge.position.y = -0.27;
    this.baseGroup.add(baseEdge);

    this.grid = new GridHelper(Math.ceil(maxDim + 2), Math.ceil(maxDim + 2) * 2, 0xa99a7e, 0xc8bba1);
    this.grid.position.y = 0.006;
    this.grid.visible = this.settings.showGrid;
    this.baseGroup.add(this.grid);

    for (const room of plan.rooms) {
      const shape = new Shape();
      room.polygon.forEach(([x, y], index) => {
        const px = x - this.center[0];
        const py = -(y - this.center[1]);
        if (index === 0) shape.moveTo(px, py);
        else shape.lineTo(px, py);
      });
      shape.closePath();
      const floor = new Mesh(new ShapeGeometry(shape), material(roomColor(room.type), { roughness: 0.94 }));
      floor.rotation.x = -Math.PI / 2;
      floor.position.y = 0.012;
      floor.receiveShadow = true;
      floor.userData.roomId = room.id;
      this.planGroup.add(floor);

      if (this.settings.showLabels) {
        const element = document.createElement('div');
        element.className = 'room-label';
        const area = polygonArea(room.polygon).toFixed(1);
        element.innerHTML = `<strong>${room.name}</strong>${this.settings.showDimensions ? `<span>${area}㎡</span>` : ''}`;
        const label = new CSS2DObject(element);
        const centroid = polygonCentroid(room.polygon);
        label.position.copy(this.world(centroid, 0.05));
        this.labelGroup.add(label);
      }
    }

    for (const wall of plan.walls) this.buildWall(wall, plan);
    for (const item of plan.furniture) this.addFurniture(item);
    this.updateSelectionVisual();
    this.renderer.shadowMap.needsUpdate = true;
  }

  private buildWall(wall: Wall, plan: FloorPlan) {
    const length = wallLength(wall);
    if (length < 0.01) return;
    const dx = (wall.end[0] - wall.start[0]) / length;
    const dy = (wall.end[1] - wall.start[1]) / length;
    const angle = -Math.atan2(dy, dx);
    const height = this.settings.wallMode === 'low' ? Math.min(0.95, plan.wallHeight) : plan.wallHeight;
    const wallMaterial = this.settings.wallMode === 'ghost'
      ? material(0xf3ecdc, { transparent: true, opacity: 0.24, roughness: 0.85 })
      : material(0xf3ecdc, { roughness: 0.88 });

    const addSegment = (from: number, to: number, segmentHeight: number, baseY: number, mat = wallMaterial) => {
      if (to - from < 0.01 || segmentHeight < 0.01) return;
      const mid = (from + to) / 2;
      const mesh = new Mesh(new BoxGeometry(to - from, segmentHeight, wall.thickness), mat);
      mesh.position.copy(this.world([wall.start[0] + dx * mid, wall.start[1] + dy * mid], baseY + segmentHeight / 2));
      mesh.rotation.y = angle;
      mesh.castShadow = this.settings.wallMode !== 'ghost';
      mesh.receiveShadow = true;
      mesh.userData.wallId = wall.id;
      this.planGroup.add(mesh);
    };

    const openings = plan.openings
      .filter((item) => item.wallId === wall.id)
      .sort((a, b) => a.offset - b.offset);
    let cursor = 0;
    for (const item of openings) {
      const start = Math.max(cursor, item.offset);
      const end = Math.min(length, item.offset + item.width);
      addSegment(cursor, start, height, 0);
      if (item.type === 'window') {
        const sill = Math.min(item.sillHeight, height);
        const windowHeight = Math.min(item.height, height - sill);
        addSegment(start, end, sill, 0);
        addSegment(start, end, height - sill - windowHeight, sill + windowHeight);
        if (windowHeight > 0.05) {
          const mid = (start + end) / 2;
          const glass = new Mesh(new BoxGeometry(end - start, windowHeight, wall.thickness * 0.28), material(0xaed7dc, { transparent: true, opacity: 0.42, roughness: 0.15, metalness: 0.1 }));
          glass.position.copy(this.world([wall.start[0] + dx * mid, wall.start[1] + dy * mid], sill + windowHeight / 2));
          glass.rotation.y = angle;
          this.planGroup.add(glass);
          addSegment(start, end, 0.05, sill, material(0x8b8f88));
          addSegment(start, end, 0.05, sill + windowHeight - 0.05, material(0x8b8f88));
        }
      } else {
        const doorHeight = Math.min(item.height, height);
        addSegment(start, end, height - doorHeight, doorHeight);
        if (this.settings.wallMode !== 'ghost') {
          const hinge = this.world([wall.start[0] + dx * start, wall.start[1] + dy * start]);
          const doorGroup = new Group();
          doorGroup.position.copy(hinge);
          doorGroup.rotation.y = angle - 0.55;
          const leaf = new Mesh(new BoxGeometry(end - start, doorHeight - 0.04, 0.045), material(0xb48a5f, { roughness: 0.7 }));
          leaf.position.set((end - start) / 2, (doorHeight - 0.04) / 2, 0);
          leaf.castShadow = true;
          doorGroup.add(leaf);
          this.planGroup.add(doorGroup);
        }
      }
      cursor = end;
    }
    addSegment(cursor, length, height, 0);

    if (this.settings.showDimensions) {
      const element = document.createElement('div');
      element.className = 'dim-label';
      element.textContent = `${length.toFixed(2)} m`;
      const label = new CSS2DObject(element);
      label.position.copy(this.world([(wall.start[0] + wall.end[0]) / 2, (wall.start[1] + wall.end[1]) / 2], height + 0.18));
      this.labelGroup.add(label);
    }
  }

  private addFurniture(item: FurnitureItem) {
    const model = createFurnitureModel(item.model, item.color);
    model.position.copy(this.world(item.position));
    model.rotation.y = item.rotation;
    model.userData.furnitureId = item.id;
    model.traverse((child) => {
      child.userData.furnitureId = item.id;
    });
    this.furnitureGroup.add(model);
  }

  updateFurniture(id: string) {
    const item = this.store.plan.furniture.find((candidate) => candidate.id === id);
    const existing = this.furnitureGroup.children.find((child) => child.userData.furnitureId === id);
    if (!item) {
      if (existing) {
        disposeObject(existing);
        this.furnitureGroup.remove(existing);
      }
      this.updateSelectionVisual();
      return;
    }
    if (existing) {
      existing.position.copy(this.world(item.position));
      existing.rotation.y = item.rotation;
      const currentColor = existing.userData.color;
      if (currentColor !== item.color) {
        disposeObject(existing);
        this.furnitureGroup.remove(existing);
        this.addFurniture(item);
      }
    } else {
      this.addFurniture(item);
    }
    this.updateSelectionVisual();
    this.renderer.shadowMap.needsUpdate = true;
  }

  updateSettings(settings: SceneSettings) {
    const structural = settings.wallMode !== this.settings.wallMode || settings.showLabels !== this.settings.showLabels || settings.showDimensions !== this.settings.showDimensions;
    if (settings.autoRotate && !this.settings.autoRotate) this.lastOrbitEnd = -Infinity;
    this.settings = { ...settings };
    this.controls.autoRotateSpeed = settings.rotateSpeed;
    this.keyLight.intensity = 2.6 * settings.lightIntensity;
    this.keyLight.shadow.mapSize.set(settings.quality === 'high' ? 2048 : 1024, settings.quality === 'high' ? 2048 : 1024);
    if (this.grid) this.grid.visible = settings.showGrid;
    if (structural) this.rebuild();
    this.renderer.shadowMap.needsUpdate = true;
  }

  setPlacement(model: FurnitureModelId | null) {
    this.placementModel = model;
    this.clearGhost();
    this.controls.enableRotate = !model;
    if (model) {
      this.ghost = createFurnitureModel(model, 'oak');
      this.ghost.traverse((child) => {
        if (child instanceof Mesh) {
          const source = child.material as MeshStandardMaterial;
          const cloned = source.clone();
          cloned.transparent = true;
          cloned.opacity = 0.55;
          cloned.depthWrite = false;
          child.material = cloned;
          child.castShadow = false;
        }
      });
      this.ghost.visible = false;
      this.scene.add(this.ghost);
      this.container.classList.add('placing');
    } else {
      this.container.classList.remove('placing');
      this.ghostRing.visible = false;
    }
  }

  private clearGhost() {
    if (this.ghost) {
      disposeObject(this.ghost);
      this.scene.remove(this.ghost);
      this.ghost = null;
    }
  }

  placeAtScreen(model: FurnitureModelId, clientX: number, clientY: number) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = new Vector3();
    if (!this.raycaster.ray.intersectPlane(this.groundPlane, hit)) return;
    const position = this.maybeSnap(this.toPlan(hit));
    const result = validateFurniture(this.store.plan, model, position, 0);
    if (!result.valid) {
      this.callbacks.onFeedback(result.reason ?? '此处无法放置', 'warning');
      return;
    }
    this.callbacks.onPlace(model, position, result.roomId);
  }

  selectFurniture(id: string | null) {
    this.updateSelectionVisual(id);
  }

  private clearSelectionBox() {
    if (this.selectionBox) {
      this.selectionBox.geometry.dispose();
      this.selectionBox.material.dispose();
      this.scene.remove(this.selectionBox);
      this.selectionBox = null;
    }
  }

  private updateSelectionVisual(forcedId?: string | null) {
    const id = forcedId !== undefined ? forcedId : this.store.selection.furnitureId;
    this.clearSelectionBox();
    if (!id) {
      this.selectionRing.visible = false;
      return;
    }
    const object = this.furnitureGroup.children.find((child) => child.userData.furnitureId === id);
    const item = this.store.plan.furniture.find((candidate) => candidate.id === id);
    if (!object || !item) {
      this.selectionRing.visible = false;
      return;
    }
    this.selectionBox = new BoxHelper(object, 0xe8a33d);
    this.scene.add(this.selectionBox);
    const definition = getFurnitureDefinition(item.model);
    const radius = Math.max(definition.dimensions.width, definition.dimensions.depth) / 2 + 0.16;
    this.selectionRing.scale.setScalar(radius);
    this.selectionRing.position.copy(this.world(item.position, 0.025));
    this.selectionRing.visible = true;
    (this.selectionRing.material as MeshBasicMaterial).color.set(0xe8a33d);
  }

  focusRoom(id: string) {
    const room = this.store.plan.rooms.find((candidate) => candidate.id === id);
    if (!room) return;
    this.lastOrbitEnd = performance.now();
    const centroid = polygonCentroid(room.polygon);
    const target = this.world(centroid, 0.5);
    this.controls.target.copy(target);
    const bounds = planBounds(room.polygon);
    const distance = Math.max(bounds.width, bounds.depth) * 1.6 + 2;
    this.camera.position.copy(target).add(new Vector3(distance * 0.7, distance * 0.75, distance * 0.8));
    this.controls.update();
  }

  cameraPreset(preset: 'iso' | 'top' | 'front') {
    this.orbitHeld = false;
    this.lastOrbitEnd = -Infinity;
    const bounds = planBounds(allPlanPoints(this.store.plan));
    const maxDim = Math.max(bounds.width, bounds.depth, 4);
    const aspectFactor = Math.max(1, 1 / Math.max(this.camera.aspect, 0.35));
    const distance = Math.min(maxDim * 1.25 * aspectFactor + 2, this.controls.maxDistance * 0.92);
    this.controls.target.set(0, 0.5, 0);
    if (preset === 'top') this.camera.position.set(0.01, distance * 1.35, 0.01);
    else if (preset === 'front') this.camera.position.set(0, distance * 0.55, distance * 1.15);
    else this.camera.position.set(distance * 0.82, distance * 0.72, distance * 0.95);
    this.controls.update();
  }

  resetCamera() {
    this.cameraPreset('iso');
  }

  exportPng(): string {
    this.renderer.render(this.scene, this.camera);
    const source = this.renderer.domElement;
    const canvas = document.createElement('canvas');
    canvas.width = source.width;
    canvas.height = source.height;
    const context = canvas.getContext('2d')!;
    context.drawImage(source, 0, 0);
    const gradient = context.createLinearGradient(0, canvas.height - 110, 0, canvas.height);
    gradient.addColorStop(0, 'rgba(20,26,22,0)');
    gradient.addColorStop(1, 'rgba(20,26,22,0.72)');
    context.fillStyle = gradient;
    context.fillRect(0, canvas.height - 110, canvas.width, 110);
    context.fillStyle = '#f5efe2';
    context.font = `600 ${Math.max(18, canvas.width / 48)}px PingFang SC, sans-serif`;
    context.textAlign = 'right';
    context.fillText('FloorCube · 户型魔方', canvas.width - 28, canvas.height - 30);
    context.font = `${Math.max(11, canvas.width / 80)}px PingFang SC, sans-serif`;
    context.fillStyle = 'rgba(245,239,226,0.72)';
    context.fillText('AI 户型图 → 3D 房间小模型', canvas.width - 28, canvas.height - 10);
    return canvas.toDataURL('image/png');
  }

  private furnitureHit(event: PointerEvent): string | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.furnitureGroup.children, true);
    return hits[0]?.object.userData.furnitureId ?? null;
  }

  private roomHit(event: PointerEvent): string | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.planGroup.children, false);
    return hits.find((hit) => hit.object.userData.roomId)?.object.userData.roomId ?? null;
  }

  private onPointerDown = (event: PointerEvent) => {
    this.downPoint.set(event.clientX, event.clientY);
    if (this.placementModel || event.button !== 0) return;
    const furnitureId = this.furnitureHit(event);
    if (furnitureId) {
      const item = this.store.plan.furniture.find((candidate) => candidate.id === furnitureId)!;
      const ground = this.groundPoint(event);
      if (!ground) return;
      this.drag = {
        id: furnitureId,
        offset: [item.position[0] - ground[0], item.position[1] - ground[1]],
        start: [...item.position],
        rotation: item.rotation,
        valid: true,
      };
      this.controls.enabled = false;
      this.callbacks.onSelectFurniture(furnitureId);
      this.callbacks.onFurnitureDragStart(furnitureId);
      this.renderer.domElement.setPointerCapture(event.pointerId);
      return;
    }
    const roomId = this.roomHit(event);
    this.callbacks.onSelectRoom(roomId);
    if (!roomId) this.callbacks.onSelectFurniture(null);
  };

  private onPointerMove = (event: PointerEvent) => {
    if (this.placementModel && this.ghost) {
      const ground = this.groundPoint(event);
      if (!ground) return;
      const position = this.maybeSnap(ground);
      const result = validateFurniture(this.store.plan, this.placementModel, position, 0);
      this.ghost.visible = true;
      this.ghost.position.copy(this.world(position));
      const definition = getFurnitureDefinition(this.placementModel);
      const radius = Math.max(definition.dimensions.width, definition.dimensions.depth) / 2 + 0.16;
      this.ghostRing.visible = true;
      this.ghostRing.scale.setScalar(radius);
      this.ghostRing.position.copy(this.world(position, 0.025));
      (this.ghostRing.material as MeshBasicMaterial).color.set(result.valid ? 0x79b473 : 0xd9534f);
      return;
    }
    if (!this.drag) return;
    const ground = this.groundPoint(event);
    if (!ground) return;
    const position = this.maybeSnap([ground[0] + this.drag.offset[0], ground[1] + this.drag.offset[1]]);
    const draggedItem = this.store.plan.furniture.find((candidate) => candidate.id === this.drag!.id);
    if (!draggedItem) return;
    const result = validateFurniture(this.store.plan, draggedItem.model, position, this.drag.rotation, this.drag.id);
    this.drag.valid = result.valid;
    const object = this.furnitureGroup.children.find((child) => child.userData.furnitureId === this.drag!.id);
    if (object) object.position.copy(this.world(position));
    this.selectionRing.position.copy(this.world(position, 0.025));
    (this.selectionRing.material as MeshBasicMaterial).color.set(result.valid ? 0xe8a33d : 0xd9534f);
    if (this.selectionBox) this.selectionBox.update();
    this.callbacks.onFurnitureTransform(this.drag.id, position, this.drag.rotation);
    this.renderer.shadowMap.needsUpdate = true;
  };

  private onPointerUp = (event: PointerEvent) => {
    if (this.placementModel) {
      const moved = this.downPoint.distanceTo(new Vector2(event.clientX, event.clientY));
      if (moved < 6 && this.ghost?.visible) {
        const position = this.toPlan(this.ghost.position);
        const result = validateFurniture(this.store.plan, this.placementModel, position, 0);
        if (result.valid) {
          this.callbacks.onPlace(this.placementModel, position, result.roomId);
        } else {
          this.callbacks.onFeedback(result.reason ?? '此处无法放置', 'warning');
        }
      }
      return;
    }
    if (!this.drag) return;
    const drag = this.drag;
    this.drag = null;
    this.controls.enabled = true;
    if (!drag.valid) {
      const object = this.furnitureGroup.children.find((child) => child.userData.furnitureId === drag.id);
      if (object) object.position.copy(this.world(drag.start));
      this.callbacks.onFurnitureTransform(drag.id, drag.start, drag.rotation);
      this.callbacks.onFeedback('家具位置无效，已回到原位', 'warning');
    }
    this.callbacks.onFurnitureDragEnd(drag.id, drag.valid);
    this.updateSelectionVisual();
    this.renderer.shadowMap.needsUpdate = true;
  };

  private onPointerLeave = () => {
    if (this.ghost) this.ghost.visible = false;
    this.ghostRing.visible = false;
  };

  dispose() {
    this.disposed = true;
    this.renderer.setAnimationLoop(null);
    this.resizeObserver.disconnect();
    this.renderer.domElement.removeEventListener('pointerdown', this.onPointerDown);
    this.renderer.domElement.removeEventListener('pointermove', this.onPointerMove);
    this.renderer.domElement.removeEventListener('pointerup', this.onPointerUp);
    this.renderer.domElement.removeEventListener('pointerleave', this.onPointerLeave);
    this.controls.removeEventListener('start', this.onOrbitStart);
    this.controls.removeEventListener('end', this.onOrbitEnd);
    this.controls.dispose();
    disposeObject(this.scene);
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.labelRenderer.domElement.remove();
  }
}
