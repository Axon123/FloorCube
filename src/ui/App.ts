import { DEFAULT_BASE_URL, DEFAULT_MODEL, DEEPSEEK_BASE_URL, MODEL_PRESETS, RecognitionError, fileToDataUrl, recognizeFloorPlan, testConnection, validateImageFile } from '../ai/client';
import type { RecognitionStage } from '../ai/client';
import { polygonArea } from '../core/geometry';
import { smartLayout } from '../core/layout';
import { validateFurniture } from '../core/placement';
import { emptyPlan, normalizeFloorPlan, planArea, roomTypeName, scalePlan, uid, wallLength, ROOM_TYPES } from '../core/schema';
import type { ModelConfig, RoomType } from '../core/schema';
import { PlanStore } from '../core/store';
import { clearConfig, deleteProject, isOnboarded, loadAutosave, loadConfig, loadProjects, markOnboarded, saveAutosave, saveConfig, upsertProject } from '../core/storage';
import type { SavedProject } from '../core/storage';
import { DEMO_PLANS, getDemoPlan } from '../data/demos';
import { planToDataUrl } from '../data/planSvg';
import { PlanEditor } from '../editor/PlanEditor';
import type { EditorTool } from '../editor/PlanEditor';
import { FURNITURE_CATALOG, getFurnitureDefinition } from '../models/catalog';
import type { FurnitureModelId } from '../models/catalog';
import { FURNITURE_PALETTES } from '../models/palette';
import type { FurnitureColor } from '../models/types';
import { DEFAULT_SCENE_SETTINGS, FloorScene } from '../scene/FloorScene';
import type { SceneSettings } from '../scene/FloorScene';
import { generateThumbnails } from './thumbnails';

type ViewMode = '3d' | '2d' | 'split';
type SidebarTab = 'furniture' | 'rooms' | 'projects';

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!));
}

function download(filename: string, href: string) {
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = filename;
  anchor.click();
}

function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  download(filename, url);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

interface ModalHandle {
  close: () => void;
  element: HTMLElement;
}

function openModal(title: string, body: string, options: { wide?: boolean; onClose?: () => void } = {}): ModalHandle {
  const root = document.querySelector<HTMLElement>('#modal-root')!;
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal ${options.wide ? 'modal-wide' : ''}" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}">
      <header class="modal-header"><h2>${escapeHtml(title)}</h2><button class="icon-button modal-close" type="button" aria-label="关闭">×</button></header>
      <div class="modal-body">${body}</div>
    </div>
  `;
  root.appendChild(overlay);
  const close = () => {
    if (!overlay.isConnected) return;
    overlay.remove();
    options.onClose?.();
  };
  overlay.querySelector('.modal-close')!.addEventListener('click', close);
  overlay.addEventListener('pointerdown', (event) => {
    if (event.target === overlay) close();
  });
  requestAnimationFrame(() => overlay.classList.add('visible'));
  return { close, element: overlay };
}

export class App {
  private store: PlanStore;
  private scene!: FloorScene;
  private editor!: PlanEditor;
  private thumbnails: Record<string, string> = {};
  private settings: SceneSettings = { ...DEFAULT_SCENE_SETTINGS };
  private viewMode: ViewMode = '3d';
  private config: ModelConfig | null = loadConfig();
  private currentProjectId: string | null = null;
  private placementModel: FurnitureModelId | null = null;
  private defaultColor: FurnitureColor = 'walnut';
  private libraryCategory = 'all';
  private librarySearch = '';
  private librarySort = 'default';
  private autosaveTimer = 0;
  private activeModal: ModalHandle | null = null;
  private pendingUploadFile: File | null = null;

  constructor(private root: HTMLElement) {
    const autosave = loadAutosave();
    const initialPlan = autosave ?? getDemoPlan('two-bed');
    this.store = new PlanStore(initialPlan);
    this.renderShell();
    this.scene = new FloorScene(this.query('#scene-container'), this.store, {
      onSelectFurniture: (id) => this.store.select({ furnitureId: id ?? undefined }),
      onSelectRoom: (id) => this.store.select({ roomId: id ?? undefined }),
      onFurnitureTransform: (id, position, rotation) => this.store.patchFurniture(id, { position, rotation }),
      onFurnitureDragStart: () => this.store.beginTransaction(),
      onFurnitureDragEnd: () => this.store.endTransaction(),
      onPlace: (model, position, roomId) => this.placeFurniture(model, position, roomId),
      onFeedback: (message, kind) => this.toast(message, kind),
      onOrbitHold: (state) => this.updateOrbitHud(state),
    });
    this.editor = new PlanEditor(this.query('#editor-container'), this.store, {
      onSelectRoom: (id) => this.store.select({ roomId: id ?? undefined }),
      onSelectFurniture: (id) => this.store.select({ furnitureId: id ?? undefined }),
      onFeedback: (message, kind) => this.toast(message, kind),
    });
    this.bindStore();
    this.bindEvents();
    if (autosave) this.setPlanSourceLabel('上次自动保存');
    this.renderLibrary();
    this.renderRooms();
    this.renderProjects();
    this.renderStatus();
    this.updateHistoryButtons();
    this.setViewMode('3d');
    requestAnimationFrame(() => {
      this.thumbnails = generateThumbnails();
      this.renderLibrary();
    });
    if (!isOnboarded()) this.showOnboarding();
  }

  private query<T extends HTMLElement>(selector: string): T {
    return this.root.querySelector<T>(selector)!;
  }

  private renderShell() {
    this.root.innerHTML = `
      <div class="app-frame">
        <header class="topbar">
          <div class="brand">
            <div class="brand-cube" aria-hidden="true"><span></span><span></span><span></span></div>
            <div class="brand-copy"><strong>FloorCube</strong><small>户型魔方 · AI 3D 沙盘</small></div>
          </div>
          <div class="demo-controls">
            <label class="field-inline">示例户型
              <select id="demo-select">${DEMO_PLANS.map((demo) => `<option value="${demo.id}" ${demo.id === 'two-bed' ? 'selected' : ''}>${demo.title} · ${demo.subtitle}</option>`).join('')}</select>
            </label>
            <button id="replay-button" class="ghost-button" type="button">模拟识别演示</button>
          </div>
          <div class="top-actions">
            <button id="upload-button" class="primary-button" type="button">上传户型图</button>
            <button id="config-button" class="ghost-button" type="button">模型配置</button>
            <button id="calibrate-button" class="ghost-button" type="button">校准尺寸</button>
            <button id="save-button" class="ghost-button" type="button">保存</button>
            <button id="export-button" class="ghost-button" type="button">导出</button>
            <button id="about-button" class="icon-button" type="button" aria-label="关于与隐私">?</button>
          </div>
        </header>

        <main class="main-layout">
          <section class="viewport-panel">
            <div class="viewport-toolbar">
              <div class="segmented" role="group" aria-label="视图切换">
                <button data-view="3d" class="active" type="button">3D 沙盘</button>
                <button data-view="split" type="button">分屏校正</button>
                <button data-view="2d" type="button">2D 平面</button>
              </div>
              <div class="editor-tools" id="editor-tools">
                <button data-tool="select" class="active" type="button" title="选择 / 移动">选择</button>
                <button data-tool="wall" type="button" title="绘制墙体">画墙</button>
                <button data-tool="door" type="button" title="在墙上添加门">门</button>
                <button data-tool="window" type="button" title="在墙上添加窗">窗</button>
                <button data-tool="room" type="button" title="绘制房间">房间</button>
                <button data-tool="erase" type="button" title="删除元素">删除</button>
                <button id="fit-2d" type="button" title="适配视图">适配</button>
              </div>
              <div class="toolbar-right">
                <button id="undo-button" class="icon-button" type="button" aria-label="撤销" disabled>↶</button>
                <button id="redo-button" class="icon-button" type="button" aria-label="重做" disabled>↷</button>
                <button id="new-plan-button" class="ghost-button" type="button">空白户型</button>
              </div>
            </div>

            <div class="viewport-stack" id="viewport-stack" data-view="3d">
              <div id="scene-container" class="scene-container"></div>
              <div id="editor-container" class="editor-container"></div>
              <div class="viewport-hud">
                <span class="hud-chip" id="hud-mode">上帝斜俯视 · 拖拽旋转</span>
                <span class="hud-chip hud-placement hidden" id="hud-placement">点击地面放置家具 · Esc 退出</span>
                <span class="hud-chip hud-orbit hidden" id="hud-orbit"></span>
              </div>
              <div class="drop-overlay hidden" id="drop-overlay"><strong>松开以上传户型图</strong><span>JPG / PNG / WebP · ≤10MB</span></div>
              <div class="furniture-inspector hidden" id="furniture-inspector"></div>
            </div>

            <footer class="statusbar">
              <span id="status-name"></span>
              <span id="status-area"></span>
              <span id="status-scale"></span>
              <span id="status-furniture"></span>
              <span class="status-hint">不收集任何信息 · 配置仅存浏览器本地</span>
            </footer>
          </section>

          <aside class="sidebar" id="sidebar">
            <button id="drawer-toggle" class="drawer-handle" type="button" aria-expanded="false">家具库 · 房间 · 场景控制 <span>⌃</span></button>
            <div class="sidebar-tabs" role="tablist">
              <button data-tab="furniture" class="active" type="button">家具库</button>
              <button data-tab="rooms" type="button">房间</button>
              <button data-tab="projects" type="button">项目</button>
            </div>
            <div class="sidebar-scroll">
              <section class="tab-panel active" data-panel="furniture">
                <div class="library-controls">
                  <input id="library-search" type="search" placeholder="搜索家具…" aria-label="搜索家具" />
                  <select id="library-sort" aria-label="排序">
                    <option value="default">默认顺序</option>
                    <option value="name">按名称</option>
                    <option value="area">按占地</option>
                  </select>
                </div>
                <div class="category-chips" id="category-chips"></div>
                <div class="library-meta">
                  <span>放置配色</span>
                  <select id="default-color" aria-label="默认放置配色">
                    ${Object.values(FURNITURE_PALETTES).map((palette) => `<option value="${palette.id}">${palette.name}</option>`).join('')}
                  </select>
                </div>
                <div class="furniture-grid" id="furniture-grid"></div>
              </section>
              <section class="tab-panel" data-panel="rooms">
                <div id="room-list" class="room-list"></div>
                <div id="room-editor" class="room-editor"></div>
                <button id="room-calibrate" class="ghost-button full-width" type="button">校准整体尺寸</button>
              </section>
              <section class="tab-panel" data-panel="projects">
                <div class="project-actions">
                  <button id="project-save" class="primary-button full-width" type="button">保存当前方案</button>
                  <button id="project-import" class="ghost-button full-width" type="button">导入 JSON</button>
                </div>
                <div id="project-list" class="project-list"></div>
              </section>
            </div>

            <section class="scene-controls" aria-label="场景控制">
              <header><strong>场景控制</strong><button id="scene-reset" class="mini-button" type="button">重置</button></header>
              <div class="control-grid">
                <label>墙体模式
                  <select id="ctrl-wall-mode"><option value="low">降墙模式</option><option value="solid">实体墙</option><option value="ghost">半透明</option></select>
                </label>
                <label>机位
                  <select id="ctrl-camera"><option value="iso">45° 沙盘</option><option value="top">正俯视</option><option value="front">正面斜视</option></select>
                </label>
                <label>墙高 <output id="ctrl-wall-height-out">2.8m</output>
                  <input id="ctrl-wall-height" type="range" min="2.2" max="4" step="0.1" value="2.8" />
                </label>
                <label>灯光 <output id="ctrl-light-out">100%</output>
                  <input id="ctrl-light" type="range" min="0.4" max="1.8" step="0.05" value="1" />
                </label>
                <label>旋转速度 <output id="ctrl-speed-out">0.6</output>
                  <input id="ctrl-speed" type="range" min="0" max="2" step="0.1" value="0.6" />
                </label>
                <label>画质
                  <select id="ctrl-quality"><option value="high">高质量</option><option value="balanced">均衡</option></select>
                </label>
              </div>
              <div class="toggle-row">
                <label class="toggle"><input id="ctrl-rotate" type="checkbox" checked /><span>自动旋转</span></label>
                <label class="toggle"><input id="ctrl-grid" type="checkbox" checked /><span>网格</span></label>
                <label class="toggle"><input id="ctrl-labels" type="checkbox" checked /><span>标签</span></label>
                <label class="toggle"><input id="ctrl-dimensions" type="checkbox" /><span>尺寸</span></label>
                <label class="toggle"><input id="ctrl-snap" type="checkbox" checked /><span>吸附</span></label>
              </div>
              <div class="scene-actions">
                <button id="smart-layout" class="ghost-button" type="button">智能布置</button>
                <button id="random-layout" class="ghost-button" type="button">随机配色</button>
                <button id="screenshot-button" class="primary-button" type="button">导出截图</button>
              </div>
            </section>
          </aside>
        </main>
        <div id="toast-root" class="toast-root" aria-live="polite"></div>
        <div id="modal-root"></div>
        <input id="file-input" type="file" accept="image/jpeg,image/png,image/webp" hidden />
        <input id="json-input" type="file" accept="application/json,.json" hidden />
      </div>
    `;
  }

  private bindStore() {
    this.store.subscribe((event) => {
      if (event.type === 'plan') {
        this.scene.rebuild();
        this.renderStatus();
        this.renderRooms();
        this.renderFurnitureInspector();
        this.scheduleAutosave();
      } else if (event.type === 'furniture' && event.furnitureId) {
        this.scene.updateFurniture(event.furnitureId);
        this.renderStatus();
        this.renderFurnitureInspector();
        this.scheduleAutosave();
      } else if (event.type === 'selection') {
        this.scene.selectFurniture(this.store.selection.furnitureId ?? null);
        this.renderFurnitureInspector();
        this.renderRooms();
      } else if (event.type === 'history') {
        this.updateHistoryButtons();
      }
    });
  }

  private bindEvents() {
    this.query('#demo-select').addEventListener('change', (event) => {
      const id = (event.target as HTMLSelectElement).value;
      this.loadDemo(id);
    });
    this.query('#replay-button').addEventListener('click', () => this.showReplay());
    this.query('#upload-button').addEventListener('click', () => this.requestUpload());
    this.query('#config-button').addEventListener('click', () => this.showConfig());
    this.query('#calibrate-button').addEventListener('click', () => this.showCalibration());
    this.query('#room-calibrate').addEventListener('click', () => this.showCalibration());
    this.query('#save-button').addEventListener('click', () => this.showSave());
    this.query('#project-save').addEventListener('click', () => this.showSave());
    this.query('#export-button').addEventListener('click', () => this.showExport());
    this.query('#about-button').addEventListener('click', () => this.showAbout());
    this.query('#new-plan-button').addEventListener('click', () => {
      this.store.replace(emptyPlan('手动描绘户型'));
      this.currentProjectId = null;
      this.setPlanSourceLabel('空白户型');
      this.setViewMode('2d');
      this.setTool('wall');
      this.toast('已创建空白户型，使用“画墙 / 房间”开始描绘', 'info');
    });
    this.query('#undo-button').addEventListener('click', () => this.store.undo());
    this.query('#redo-button').addEventListener('click', () => this.store.redo());
    this.query('#fit-2d').addEventListener('click', () => this.editor.fit());

    this.root.querySelectorAll<HTMLButtonElement>('button[data-view]').forEach((button) => {
      button.addEventListener('click', () => this.setViewMode(button.dataset.view as ViewMode));
    });
    this.root.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach((button) => {
      button.addEventListener('click', () => this.setTool(button.dataset.tool as EditorTool));
    });
    this.root.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((button) => {
      button.addEventListener('click', () => this.setSidebarTab(button.dataset.tab as SidebarTab));
    });

    this.query('#library-search').addEventListener('input', (event) => {
      this.librarySearch = (event.target as HTMLInputElement).value;
      this.renderLibrary();
    });
    this.query('#library-sort').addEventListener('change', (event) => {
      this.librarySort = (event.target as HTMLSelectElement).value;
      this.renderLibrary();
    });
    this.query('#default-color').addEventListener('change', (event) => {
      this.defaultColor = (event.target as HTMLSelectElement).value as FurnitureColor;
    });

    this.bindSceneControls();
    this.bindUploadInputs();
    this.bindKeyboard();
    this.query('#drawer-toggle').addEventListener('click', () => {
      const sidebar = this.query('#sidebar');
      const open = sidebar.classList.toggle('drawer-open');
      this.query('#drawer-toggle').setAttribute('aria-expanded', String(open));
    });
    this.query('#project-import').addEventListener('click', () => this.query<HTMLInputElement>('#json-input').click());
    this.query<HTMLInputElement>('#json-input').addEventListener('change', async (event) => {
      const file = (event.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const plan = normalizeFloorPlan(JSON.parse(await file.text()), file.name.replace(/\.json$/i, ''));
        this.store.replace(plan);
        this.currentProjectId = null;
        this.setPlanSourceLabel(plan.name);
        this.toast('已导入户型 JSON', 'success');
      } catch (error) {
        this.toast(error instanceof Error ? error.message : 'JSON 导入失败', 'warning');
      }
      (event.target as HTMLInputElement).value = '';
    });
  }

  private bindSceneControls() {
    const wallMode = this.query<HTMLSelectElement>('#ctrl-wall-mode');
    wallMode.value = this.settings.wallMode;
    wallMode.addEventListener('change', () => this.updateSettings({ wallMode: wallMode.value as SceneSettings['wallMode'] }));
    const camera = this.query<HTMLSelectElement>('#ctrl-camera');
    camera.addEventListener('change', () => this.scene.cameraPreset(camera.value as 'iso' | 'top' | 'front'));
    const wallHeight = this.query<HTMLInputElement>('#ctrl-wall-height');
    const wallHeightOut = this.query('#ctrl-wall-height-out');
    wallHeight.value = String(this.store.plan.wallHeight);
    wallHeightOut.textContent = `${this.store.plan.wallHeight.toFixed(1)}m`;
    wallHeight.addEventListener('pointerdown', () => this.store.beginTransaction());
    wallHeight.addEventListener('input', () => {
      const value = Number(wallHeight.value);
      wallHeightOut.textContent = `${value.toFixed(1)}m`;
      this.store.mutate((plan) => { plan.wallHeight = value; }, false);
    });
    wallHeight.addEventListener('change', () => this.store.endTransaction());
    const light = this.query<HTMLInputElement>('#ctrl-light');
    light.addEventListener('input', () => {
      this.query('#ctrl-light-out').textContent = `${Math.round(Number(light.value) * 100)}%`;
      this.updateSettings({ lightIntensity: Number(light.value) });
    });
    const speed = this.query<HTMLInputElement>('#ctrl-speed');
    speed.addEventListener('input', () => {
      this.query('#ctrl-speed-out').textContent = Number(speed.value).toFixed(1);
      this.updateSettings({ rotateSpeed: Number(speed.value) });
    });
    const quality = this.query<HTMLSelectElement>('#ctrl-quality');
    quality.addEventListener('change', () => this.updateSettings({ quality: quality.value as SceneSettings['quality'] }));
    const toggles: Array<[string, keyof SceneSettings]> = [
      ['#ctrl-rotate', 'autoRotate'],
      ['#ctrl-grid', 'showGrid'],
      ['#ctrl-labels', 'showLabels'],
      ['#ctrl-dimensions', 'showDimensions'],
      ['#ctrl-snap', 'snapEnabled'],
    ];
    for (const [selector, key] of toggles) {
      const input = this.query<HTMLInputElement>(selector);
      input.checked = Boolean(this.settings[key]);
      input.addEventListener('change', () => this.updateSettings({ [key]: input.checked } as Partial<SceneSettings>));
    }
    this.query('#scene-reset').addEventListener('click', () => {
      this.settings = { ...DEFAULT_SCENE_SETTINGS };
      this.syncSceneControls();
      this.scene.updateSettings(this.settings);
      this.editor.setOptions({ snapEnabled: this.settings.snapEnabled, showDimensions: this.settings.showDimensions });
      this.scene.resetCamera();
      this.toast('场景控制已重置', 'info');
    });
    this.query('#smart-layout').addEventListener('click', () => {
      this.store.replace(smartLayout(this.store.plan, this.defaultColor));
      this.toast('已按房间类型智能布置家具', 'success');
    });
    this.query('#random-layout').addEventListener('click', () => {
      const colors = Object.keys(FURNITURE_PALETTES) as FurnitureColor[];
      this.store.mutate((plan) => {
        for (const item of plan.furniture) item.color = colors[Math.floor(Math.random() * colors.length)];
      });
      this.toast('已随机切换家具配色', 'success');
    });
    this.query('#screenshot-button').addEventListener('click', () => this.exportScreenshot());
  }

  private syncSceneControls() {
    this.query<HTMLSelectElement>('#ctrl-wall-mode').value = this.settings.wallMode;
    this.query<HTMLInputElement>('#ctrl-light').value = String(this.settings.lightIntensity);
    this.query('#ctrl-light-out').textContent = `${Math.round(this.settings.lightIntensity * 100)}%`;
    this.query<HTMLInputElement>('#ctrl-speed').value = String(this.settings.rotateSpeed);
    this.query('#ctrl-speed-out').textContent = this.settings.rotateSpeed.toFixed(1);
    this.query<HTMLSelectElement>('#ctrl-quality').value = this.settings.quality;
    this.query<HTMLInputElement>('#ctrl-rotate').checked = this.settings.autoRotate;
    this.query<HTMLInputElement>('#ctrl-grid').checked = this.settings.showGrid;
    this.query<HTMLInputElement>('#ctrl-labels').checked = this.settings.showLabels;
    this.query<HTMLInputElement>('#ctrl-dimensions').checked = this.settings.showDimensions;
    this.query<HTMLInputElement>('#ctrl-snap').checked = this.settings.snapEnabled;
  }

  private updateSettings(patch: Partial<SceneSettings>) {
    this.settings = { ...this.settings, ...patch };
    this.scene.updateSettings(this.settings);
    this.editor.setOptions({ snapEnabled: this.settings.snapEnabled, showDimensions: this.settings.showDimensions });
  }

  private bindUploadInputs() {
    const stack = this.query('#viewport-stack');
    const overlay = this.query('#drop-overlay');
    stack.addEventListener('dragover', (event) => {
      event.preventDefault();
      overlay.classList.remove('hidden');
    });
    stack.addEventListener('dragleave', () => overlay.classList.add('hidden'));
    stack.addEventListener('drop', (event) => {
      event.preventDefault();
      overlay.classList.add('hidden');
      const file = event.dataTransfer?.files?.[0];
      if (file) this.requestUpload(file);
    });
    stack.addEventListener('dragenter', (event) => event.preventDefault());
    window.addEventListener('paste', (event) => {
      const file = Array.from(event.clipboardData?.items ?? []).find((item) => item.type.startsWith('image/'))?.getAsFile();
      if (file) this.requestUpload(file);
    });
    const sceneContainer = this.query('#scene-container');
    sceneContainer.addEventListener('dragover', (event) => {
      if (event.dataTransfer?.types.includes('application/x-floorcube-model')) event.preventDefault();
    });
    sceneContainer.addEventListener('drop', (event) => {
      const model = event.dataTransfer?.getData('application/x-floorcube-model') as FurnitureModelId;
      if (!model) return;
      event.preventDefault();
      this.scene.placeAtScreen(model, event.clientX, event.clientY);
    });
  }

  private bindKeyboard() {
    window.addEventListener('keydown', (event) => {
      const target = event.target as HTMLElement;
      if (target.matches('input, textarea, select')) return;
      if (event.key === 'Escape') {
        if (this.activeModal?.element.isConnected) this.activeModal.close();
        else if (this.placementModel) this.cancelPlacement();
        else this.store.select({});
        this.activeModal = null;
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) this.store.redo();
        else this.store.undo();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        this.store.redo();
        return;
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        const id = this.store.selection.furnitureId;
        if (id) this.deleteFurniture(id);
        return;
      }
      if (event.key.toLowerCase() === 'r') {
        const id = this.store.selection.furnitureId;
        if (id) this.rotateFurniture(id, Math.PI / 2);
        return;
      }
      if (event.key === '1') this.setViewMode('3d');
      if (event.key === '2') this.setViewMode('split');
      if (event.key === '3') this.setViewMode('2d');
    });
  }

  private setViewMode(mode: ViewMode) {
    this.viewMode = mode;
    this.query('#viewport-stack').dataset.view = mode;
    this.root.querySelectorAll<HTMLButtonElement>('button[data-view]').forEach((button) => button.classList.toggle('active', button.dataset.view === mode));
    this.query('#editor-tools').classList.toggle('visible', mode !== '3d');
    this.query('#hud-mode').textContent = mode === '2d' ? '2D 校正 · 滚轮缩放 / 右键平移' : mode === 'split' ? '分屏校正 · 修改实时同步' : '上帝斜俯视 · 拖拽旋转';
    if (mode === '2d') this.query('#hud-orbit').classList.add('hidden');
    if (mode !== '3d') requestAnimationFrame(() => this.editor.fit());
    if (mode !== '2d') requestAnimationFrame(() => this.scene.resetCamera());
  }

  private updateOrbitHud(state: { phase: 'drag' | 'hold' | 'off'; seconds: number }) {
    const chip = this.query('#hud-orbit');
    if (state.phase === 'off' || this.viewMode === '2d') {
      chip.classList.add('hidden');
      return;
    }
    chip.classList.remove('hidden');
    chip.textContent = state.phase === 'drag'
      ? '手动视角 · 自动旋转已暂停'
      : `视角已固定 · ${state.seconds}s 后从当前机位恢复自动旋转`;
  }

  private setTool(tool: EditorTool) {
    this.editor.setTool(tool);
    this.root.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach((button) => button.classList.toggle('active', button.dataset.tool === tool));
    if (this.viewMode === '3d') this.setViewMode('split');
  }

  private setSidebarTab(tab: SidebarTab) {
    this.root.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((button) => button.classList.toggle('active', button.dataset.tab === tab));
    this.root.querySelectorAll<HTMLElement>('[data-panel]').forEach((panel) => panel.classList.toggle('active', panel.dataset.panel === tab));
    if (tab === 'projects') this.renderProjects();
    if (tab === 'rooms') this.renderRooms();
  }

  private renderStatus() {
    const plan = this.store.plan;
    this.query('#status-name').textContent = plan.name;
    this.query('#status-area').textContent = `约 ${planArea(plan).toFixed(1)}㎡`;
    const scaleText = plan.scaleSource === 'annotation' ? '标注尺寸' : plan.scaleSource === 'user-calibrated' ? '已校准' : '门宽估算';
    this.query('#status-scale').textContent = `比例：${scaleText}`;
    this.query('#status-furniture').textContent = `${plan.furniture.length} 件家具`;
  }

  private renderLibrary() {
    const chips = this.query('#category-chips');
    const categories = [{ id: 'all', name: '全部' }, ...FURNITURE_CATALOG.reduce<Array<{ id: string; name: string }>>((list, item) => {
      if (!list.some((entry) => entry.id === item.category)) {
        const names: Record<string, string> = { bedroom: '卧室', living: '客厅', kitchen: '餐厨', bathroom: '卫浴', general: '通用' };
        list.push({ id: item.category, name: names[item.category] });
      }
      return list;
    }, [])];
    chips.innerHTML = categories.map((category) => `<button data-category="${category.id}" class="${this.libraryCategory === category.id ? 'active' : ''}" type="button">${category.name}</button>`).join('');
    chips.querySelectorAll<HTMLButtonElement>('[data-category]').forEach((button) => {
      button.addEventListener('click', () => {
        this.libraryCategory = button.dataset.category!;
        this.renderLibrary();
      });
    });

    let items = FURNITURE_CATALOG.filter((item) => {
      const matchesCategory = this.libraryCategory === 'all' || item.category === this.libraryCategory;
      const matchesSearch = !this.librarySearch || item.name.includes(this.librarySearch) || item.id.includes(this.librarySearch.toLowerCase());
      return matchesCategory && matchesSearch;
    });
    if (this.librarySort === 'name') items = [...items].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
    if (this.librarySort === 'area') items = [...items].sort((a, b) => b.dimensions.width * b.dimensions.depth - a.dimensions.width * a.dimensions.depth);

    const grid = this.query('#furniture-grid');
    grid.innerHTML = items.map((item) => `
      <article class="furniture-card ${this.placementModel === item.id ? 'placing' : ''}" draggable="true" data-model="${item.id}" tabindex="0" role="button" aria-label="放置${item.name}">
        <div class="furniture-thumb">${this.thumbnails[item.id] ? `<img src="${this.thumbnails[item.id]}" alt="${item.name} 缩略图" />` : '<span class="thumb-placeholder"></span>'}</div>
        <strong>${item.name}</strong>
        <small>${item.dimensions.width} × ${item.dimensions.depth} m</small>
      </article>
    `).join('') || '<p class="empty-note">没有匹配的家具</p>';
    grid.querySelectorAll<HTMLElement>('[data-model]').forEach((card) => {
      const model = card.dataset.model as FurnitureModelId;
      card.addEventListener('click', () => this.startPlacement(model));
      card.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          this.startPlacement(model);
        }
      });
      card.addEventListener('dragstart', (event) => {
        event.dataTransfer?.setData('application/x-floorcube-model', model);
        if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copy';
      });
    });
  }

  private startPlacement(model: FurnitureModelId) {
    this.placementModel = model;
    this.scene.setPlacement(model);
    this.query('#hud-placement').classList.remove('hidden');
    this.renderLibrary();
    if (this.viewMode === '2d') this.setViewMode('split');
    this.toast(`点击 3D 地面放置「${getFurnitureDefinition(model).name}」，Esc 退出`, 'info');
  }

  private cancelPlacement() {
    this.placementModel = null;
    this.scene.setPlacement(null);
    this.query('#hud-placement').classList.add('hidden');
    this.renderLibrary();
  }

  private placeFurniture(model: FurnitureModelId, position: [number, number], roomId?: string) {
    const id = uid('f');
    this.store.mutate((plan) => {
      plan.furniture.push({ id, model, position, rotation: 0, color: this.defaultColor, roomId });
    });
    this.store.select({ furnitureId: id });
    this.toast(`已放置「${getFurnitureDefinition(model).name}」`, 'success');
  }

  private renderFurnitureInspector() {
    const panel = this.query('#furniture-inspector');
    const id = this.store.selection.furnitureId;
    const item = this.store.plan.furniture.find((candidate) => candidate.id === id);
    if (!item) {
      panel.classList.add('hidden');
      panel.innerHTML = '';
      panel.dataset.itemId = '';
      return;
    }
    if (panel.dataset.itemId === item.id && panel.innerHTML) {
      const x = panel.querySelector<HTMLInputElement>('#fi-x');
      const z = panel.querySelector<HTMLInputElement>('#fi-z');
      const rotation = panel.querySelector<HTMLInputElement>('#fi-rotation');
      const color = panel.querySelector<HTMLSelectElement>('#fi-color');
      if (x && document.activeElement !== x) x.value = item.position[0].toFixed(2);
      if (z && document.activeElement !== z) z.value = item.position[1].toFixed(2);
      if (rotation && document.activeElement !== rotation) rotation.value = String(Math.round((item.rotation * 180) / Math.PI));
      const rotationOut = panel.querySelector('#fi-rotation-out');
      if (rotationOut) rotationOut.textContent = `${Math.round((item.rotation * 180) / Math.PI)}°`;
      if (color) color.value = item.color;
      return;
    }
    const definition = getFurnitureDefinition(item.model);
    panel.dataset.itemId = item.id;
    panel.classList.remove('hidden');
    panel.innerHTML = `
      <header><strong>${definition.name}</strong><span>${item.id}</span></header>
      <div class="inspector-grid">
        <label>X / m<input id="fi-x" type="number" step="0.1" value="${item.position[0].toFixed(2)}" /></label>
        <label>Z / m<input id="fi-z" type="number" step="0.1" value="${item.position[1].toFixed(2)}" /></label>
        <label class="wide">旋转 <output id="fi-rotation-out">${Math.round((item.rotation * 180) / Math.PI)}°</output>
          <input id="fi-rotation" type="range" min="-180" max="180" step="1" value="${Math.round((item.rotation * 180) / Math.PI)}" />
        </label>
      </div>
      <div class="inspector-actions">
        <button id="fi-rot-left" type="button">-90°</button>
        <button id="fi-rot-right" type="button">+90°</button>
        <select id="fi-color" aria-label="家具配色">${Object.values(FURNITURE_PALETTES).map((palette) => `<option value="${palette.id}" ${palette.id === item.color ? 'selected' : ''}>${palette.name}</option>`).join('')}</select>
        <button id="fi-duplicate" type="button">复制</button>
        <button id="fi-delete" class="danger" type="button">删除</button>
      </div>
    `;
    const xInput = panel.querySelector<HTMLInputElement>('#fi-x')!;
    const zInput = panel.querySelector<HTMLInputElement>('#fi-z')!;
    const applyPosition = () => {
      const position: [number, number] = [Number(xInput.value), Number(zInput.value)];
      const result = validateFurniture(this.store.plan, item.model, position, item.rotation, item.id);
      if (!result.valid) {
        this.toast(result.reason ?? '位置无效', 'warning');
        xInput.value = item.position[0].toFixed(2);
        zInput.value = item.position[1].toFixed(2);
        return;
      }
      this.store.mutate((plan) => {
        const target = plan.furniture.find((candidate) => candidate.id === item.id);
        if (target) {
          target.position = position;
          target.roomId = result.roomId;
        }
      });
    };
    xInput.addEventListener('change', applyPosition);
    zInput.addEventListener('change', applyPosition);
    const rotation = panel.querySelector<HTMLInputElement>('#fi-rotation')!;
    rotation.addEventListener('pointerdown', () => this.store.beginTransaction());
    rotation.addEventListener('input', () => {
      const radians = (Number(rotation.value) * Math.PI) / 180;
      panel.querySelector('#fi-rotation-out')!.textContent = `${rotation.value}°`;
      this.store.patchFurniture(item.id, { rotation: radians });
    });
    rotation.addEventListener('change', () => this.store.endTransaction());
    panel.querySelector('#fi-rot-left')!.addEventListener('click', () => this.rotateFurniture(item.id, -Math.PI / 2));
    panel.querySelector('#fi-rot-right')!.addEventListener('click', () => this.rotateFurniture(item.id, Math.PI / 2));
    panel.querySelector<HTMLSelectElement>('#fi-color')!.addEventListener('change', (event) => {
      this.store.mutate((plan) => {
        const target = plan.furniture.find((candidate) => candidate.id === item.id);
        if (target) target.color = (event.target as HTMLSelectElement).value as FurnitureColor;
      });
    });
    panel.querySelector('#fi-duplicate')!.addEventListener('click', () => this.duplicateFurniture(item.id));
    panel.querySelector('#fi-delete')!.addEventListener('click', () => this.deleteFurniture(item.id));
  }

  private rotateFurniture(id: string, delta: number) {
    const item = this.store.plan.furniture.find((candidate) => candidate.id === id);
    if (!item) return;
    const rotation = item.rotation + delta;
    const result = validateFurniture(this.store.plan, item.model, item.position, rotation, id);
    if (!result.valid) {
      this.toast(result.reason ?? '旋转后位置无效', 'warning');
      return;
    }
    this.store.mutate((plan) => {
      const target = plan.furniture.find((candidate) => candidate.id === id);
      if (target) target.rotation = rotation;
    });
  }

  private duplicateFurniture(id: string) {
    const item = this.store.plan.furniture.find((candidate) => candidate.id === id);
    if (!item) return;
    const offsets: Array<[number, number]> = [[0.4, 0], [-0.4, 0], [0, 0.4], [0, -0.4], [0.6, 0.6]];
    for (const [dx, dy] of offsets) {
      const position: [number, number] = [item.position[0] + dx, item.position[1] + dy];
      const result = validateFurniture(this.store.plan, item.model, position, item.rotation, id);
      if (result.valid) {
        const newId = uid('f');
        this.store.mutate((plan) => {
          plan.furniture.push({ ...item, id: newId, position, roomId: result.roomId });
        });
        this.store.select({ furnitureId: newId });
        this.toast('已复制家具', 'success');
        return;
      }
    }
    this.toast('附近没有足够空间复制', 'warning');
  }

  private deleteFurniture(id: string) {
    this.store.mutate((plan) => { plan.furniture = plan.furniture.filter((item) => item.id !== id); });
    this.toast('已删除家具', 'info', { label: '撤销', action: () => this.store.undo() });
  }

  private renderRooms() {
    const plan = this.store.plan;
    const list = this.query('#room-list');
    list.innerHTML = plan.rooms.map((room) => `
      <button class="room-row ${this.store.selection.roomId === room.id ? 'active' : ''}" data-room="${room.id}" type="button">
        <span>${escapeHtml(room.name)}</span>
        <small>${roomTypeName(room.type)} · ${polygonArea(room.polygon).toFixed(1)}㎡${room.confidence < 0.8 ? ' · 建议检查' : ''}</small>
      </button>
    `).join('') || '<p class="empty-note">还没有房间，使用 2D“房间”工具绘制。</p>';
    list.querySelectorAll<HTMLButtonElement>('[data-room]').forEach((button) => {
      button.addEventListener('click', () => {
        const id = button.dataset.room!;
        this.store.select({ roomId: id });
        this.scene.focusRoom(id);
      });
    });

    const editor = this.query('#room-editor');
    const room = plan.rooms.find((candidate) => candidate.id === this.store.selection.roomId);
    if (!room) {
      editor.innerHTML = '<p class="empty-note">选择一个房间后可编辑名称与类型。</p>';
      return;
    }
    editor.innerHTML = `
      <label>房间名称<input id="room-name" type="text" value="${escapeHtml(room.name)}" maxlength="20" /></label>
      <label>房间类型<select id="room-type">${ROOM_TYPES.map((type) => `<option value="${type.id}" ${type.id === room.type ? 'selected' : ''}>${type.name}</option>`).join('')}</select></label>
      <div class="room-stats"><span>面积 ${polygonArea(room.polygon).toFixed(2)}㎡</span><span>置信度 ${Math.round(room.confidence * 100)}%</span></div>
      <button id="room-delete" class="ghost-button danger full-width" type="button">删除该房间</button>
    `;
    editor.querySelector<HTMLInputElement>('#room-name')!.addEventListener('change', (event) => {
      const value = (event.target as HTMLInputElement).value.trim() || '房间';
      this.store.mutate((draft) => {
        const target = draft.rooms.find((candidate) => candidate.id === room.id);
        if (target) target.name = value;
      });
    });
    editor.querySelector<HTMLSelectElement>('#room-type')!.addEventListener('change', (event) => {
      this.store.mutate((draft) => {
        const target = draft.rooms.find((candidate) => candidate.id === room.id);
        if (target) target.type = (event.target as HTMLSelectElement).value as RoomType;
      });
    });
    editor.querySelector('#room-delete')!.addEventListener('click', () => {
      this.store.mutate((draft) => {
        draft.rooms = draft.rooms.filter((candidate) => candidate.id !== room.id);
        draft.furniture = draft.furniture.filter((item) => item.roomId !== room.id);
      });
      this.toast('已删除房间', 'info', { label: '撤销', action: () => this.store.undo() });
    });
  }

  private renderProjects() {
    const projects = loadProjects();
    const list = this.query('#project-list');
    list.innerHTML = projects.map((project) => `
      <article class="project-card ${project.id === this.currentProjectId ? 'active' : ''}" data-project="${project.id}">
        <div><strong>${escapeHtml(project.name)}</strong><small>${new Date(project.updatedAt).toLocaleString('zh-CN')} · ${project.plan.furniture.length} 件家具</small></div>
        <div class="project-card-actions">
          <button data-action="load" type="button">载入</button>
          <button data-action="rename" type="button">重命名</button>
          <button data-action="delete" class="danger" type="button">删除</button>
        </div>
      </article>
    `).join('') || '<p class="empty-note">还没有保存的方案。点击“保存当前方案”建立第一个项目。</p>';
    list.querySelectorAll<HTMLElement>('[data-project]').forEach((card) => {
      const id = card.dataset.project!;
      card.querySelector('[data-action="load"]')!.addEventListener('click', () => this.loadProject(id));
      card.querySelector('[data-action="rename"]')!.addEventListener('click', () => this.renameProject(id));
      card.querySelector('[data-action="delete"]')!.addEventListener('click', () => this.removeProject(id));
    });
  }

  private loadDemo(id: string) {
    this.store.replace(getDemoPlan(id));
    this.currentProjectId = null;
    this.setPlanSourceLabel(null);
    this.cancelPlacement();
    this.scene.resetCamera();
    this.toast(`已载入示例「${DEMO_PLANS.find((demo) => demo.id === id)?.title}」`, 'success');
  }

  private setPlanSourceLabel(label: string | null) {
    const select = this.query<HTMLSelectElement>('#demo-select');
    const existing = select.querySelector<HTMLOptionElement>('option[value=""]');
    if (!label) {
      existing?.remove();
      return;
    }
    const option = existing ?? document.createElement('option');
    option.value = '';
    option.textContent = `当前：${label}`;
    if (!existing) select.prepend(option);
    select.value = '';
  }

  private loadProject(id: string) {
    const project = loadProjects().find((item) => item.id === id);
    if (!project) return;
    this.store.replace(project.plan);
    this.currentProjectId = id;
    this.setPlanSourceLabel(project.name);
    this.renderProjects();
    this.toast(`已载入「${project.name}」`, 'success');
  }

  private renameProject(id: string) {
    const project = loadProjects().find((item) => item.id === id);
    if (!project) return;
    const modal = openModal('重命名方案', `
      <label class="modal-field">方案名称<input id="rename-input" type="text" value="${escapeHtml(project.name)}" maxlength="40" /></label>
      <div class="modal-actions"><button id="rename-cancel" class="ghost-button" type="button">取消</button><button id="rename-confirm" class="primary-button" type="button">保存</button></div>
    `);
    this.activeModal = modal;
    const input = modal.element.querySelector<HTMLInputElement>('#rename-input')!;
    input.focus();
    modal.element.querySelector('#rename-cancel')!.addEventListener('click', modal.close);
    modal.element.querySelector('#rename-confirm')!.addEventListener('click', () => {
      const name = input.value.trim() || project.name;
      upsertProject({ ...project, name, updatedAt: Date.now() });
      modal.close();
      this.renderProjects();
      this.toast('已重命名', 'success');
    });
  }

  private removeProject(id: string) {
    const project = loadProjects().find((item) => item.id === id);
    if (!project) return;
    deleteProject(id);
    if (this.currentProjectId === id) this.currentProjectId = null;
    this.renderProjects();
    this.toast(`已删除「${project.name}」`, 'info', {
      label: '撤销',
      action: () => {
        upsertProject(project);
        this.renderProjects();
      },
    });
  }

  private showSave() {
    const suggested = this.store.plan.name || '我的户型方案';
    const modal = openModal('保存当前方案', `
      <p class="modal-note">方案仅保存在此浏览器本地，不会上传到任何服务器。</p>
      <label class="modal-field">方案名称<input id="save-name" type="text" value="${escapeHtml(suggested)}" maxlength="40" /></label>
      <div class="modal-actions"><button id="save-cancel" class="ghost-button" type="button">取消</button><button id="save-confirm" class="primary-button" type="button">保存</button></div>
    `);
    this.activeModal = modal;
    const input = modal.element.querySelector<HTMLInputElement>('#save-name')!;
    input.focus();
    modal.element.querySelector('#save-cancel')!.addEventListener('click', modal.close);
    modal.element.querySelector('#save-confirm')!.addEventListener('click', () => {
      const name = input.value.trim() || suggested;
      const id = this.currentProjectId ?? uid('p');
      const project: SavedProject = { id, name, updatedAt: Date.now(), plan: { ...this.store.plan, name } };
      upsertProject(project);
      this.currentProjectId = id;
      this.store.mutate((plan) => { plan.name = name; }, false);
      modal.close();
      this.renderProjects();
      this.toast('方案已保存到浏览器本地', 'success');
    });
  }

  private showExport() {
    const modal = openModal('导出作品', `
      <p class="modal-note">截图带 FloorCube 水印，适合分享；JSON 可再次导入编辑。</p>
      <div class="export-options">
        <button id="export-png" class="export-card" type="button"><strong>高清截图 PNG</strong><span>导出当前 3D 视角</span></button>
        <button id="export-json" class="export-card" type="button"><strong>户型 JSON</strong><span>结构 + 家具 + 校准信息</span></button>
      </div>
    `);
    this.activeModal = modal;
    modal.element.querySelector('#export-png')!.addEventListener('click', () => {
      this.exportScreenshot();
      modal.close();
    });
    modal.element.querySelector('#export-json')!.addEventListener('click', () => {
      downloadJson(`${this.store.plan.name || 'floorcube'}.json`, this.store.plan);
      modal.close();
      this.toast('已导出户型 JSON', 'success');
    });
  }

  private exportScreenshot() {
    const href = this.scene.exportPng();
    download(`${this.store.plan.name || 'floorcube'}-截图.png`, href);
    this.toast('已导出带水印截图', 'success');
  }

  private showCalibration() {
    const plan = this.store.plan;
    const walls = plan.walls.map((wall, index) => `<option value="${wall.id}">墙 ${index + 1} · 当前 ${wallLength(wall).toFixed(2)}m</option>`).join('');
    const modal = openModal('校准整体尺寸', `
      <p class="modal-note">图纸比例不准时，用已知面积或墙长校准。家具保持真实物理尺寸，只缩放户型结构。</p>
      <div class="calibration-tabs">
        <label><input type="radio" name="calibration-mode" value="area" checked /> 按总面积</label>
        <label><input type="radio" name="calibration-mode" value="wall" /> 按墙长</label>
      </div>
      <div id="calibration-area">
        <label class="modal-field">实际总面积（㎡）<input id="cal-area" type="number" min="5" max="1000" step="0.5" value="${planArea(plan).toFixed(1)}" /></label>
      </div>
      <div id="calibration-wall" class="hidden">
        <label class="modal-field">选择墙体<select id="cal-wall">${walls}</select></label>
        <label class="modal-field">该墙实际长度（m）<input id="cal-length" type="number" min="0.3" max="100" step="0.05" value="3.0" /></label>
      </div>
      <div class="modal-actions"><button id="cal-cancel" class="ghost-button" type="button">取消</button><button id="cal-apply" class="primary-button" type="button">应用校准</button></div>
    `);
    this.activeModal = modal;
    const areaBlock = modal.element.querySelector('#calibration-area')!;
    const wallBlock = modal.element.querySelector('#calibration-wall')!;
    modal.element.querySelectorAll<HTMLInputElement>('input[name="calibration-mode"]').forEach((radio) => {
      radio.addEventListener('change', () => {
        areaBlock.classList.toggle('hidden', radio.value !== 'area' || !radio.checked);
        wallBlock.classList.toggle('hidden', radio.value !== 'wall' || !radio.checked);
      });
    });
    modal.element.querySelector('#cal-cancel')!.addEventListener('click', modal.close);
    modal.element.querySelector('#cal-apply')!.addEventListener('click', () => {
      const mode = modal.element.querySelector<HTMLInputElement>('input[name="calibration-mode"]:checked')!.value;
      if (mode === 'area') {
        const target = Number(modal.element.querySelector<HTMLInputElement>('#cal-area')!.value);
        const current = planArea(plan);
        if (!target || target <= 0 || current <= 0) {
          this.toast('请输入有效的面积', 'warning');
          return;
        }
        this.store.replace(scalePlan(plan, Math.sqrt(target / current), 'user-calibrated', target));
      } else {
        const wallId = modal.element.querySelector<HTMLSelectElement>('#cal-wall')!.value;
        const wall = plan.walls.find((candidate) => candidate.id === wallId);
        const target = Number(modal.element.querySelector<HTMLInputElement>('#cal-length')!.value);
        if (!wall || !target || target <= 0) {
          this.toast('请选择墙体并输入有效长度', 'warning');
          return;
        }
        this.store.replace(scalePlan(plan, target / wallLength(wall), 'user-calibrated'));
      }
      modal.close();
      this.scene.resetCamera();
      this.toast('尺寸已校准，家具尺寸保持不变', 'success');
    });
  }

  private showConfig(afterSave?: () => void) {
    const config = this.config;
    const modal = openModal('模型接口配置', `
      <p class="modal-note">FloorCube 不收集任何信息。接口地址、API Key 与模型名仅保存在你的浏览器本地，只用于调用你自己配置的模型接口。模型必须支持图像输入。</p>
      <label class="modal-field">接口地址 Base URL<input id="cfg-url" type="url" value="${escapeHtml(config?.baseUrl ?? DEFAULT_BASE_URL)}" placeholder="https://dashscope.aliyuncs.com/compatible-mode/v1" /></label>
      <label class="modal-field">API Key<input id="cfg-key" type="password" value="${escapeHtml(config?.apiKey ?? '')}" placeholder="sk-…" autocomplete="off" /></label>
      <label class="modal-field">模型名称<input id="cfg-model" type="text" list="model-presets" value="${escapeHtml(config?.model ?? DEFAULT_MODEL)}" placeholder="qwen-vl-max" /></label>
      <datalist id="model-presets">${MODEL_PRESETS.map((preset) => `<option value="${preset.model}">${preset.label}</option>`).join('')}</datalist>
      <p class="modal-hint">推荐路径：阿里云百炼 qwen-vl-max，或 DeepSeek 开放平台 deepseek-flash（选模型后地址自动匹配）。也可填写 OpenAI、Moonshot、Ollama 等任意 OpenAI 兼容接口，模型需支持图像输入。</p>
      <div id="cfg-result" class="config-result hidden"></div>
      <div class="modal-actions spread">
        <button id="cfg-clear" class="ghost-button danger" type="button">清除配置</button>
        <div><button id="cfg-test" class="ghost-button" type="button">测试连接</button><button id="cfg-save" class="primary-button" type="button">保存配置</button></div>
      </div>
    `, { wide: true });
    this.activeModal = modal;
    const url = modal.element.querySelector<HTMLInputElement>('#cfg-url')!;
    const key = modal.element.querySelector<HTMLInputElement>('#cfg-key')!;
    const model = modal.element.querySelector<HTMLInputElement>('#cfg-model')!;
    const result = modal.element.querySelector('#cfg-result')!;
    const readConfig = (): ModelConfig => ({ baseUrl: url.value.trim(), apiKey: key.value.trim(), model: model.value.trim() });
    const syncBaseUrl = () => {
      const name = model.value.trim().toLowerCase();
      const current = url.value.trim();
      if (name.includes('deepseek') && (current === DEFAULT_BASE_URL || current === '')) url.value = DEEPSEEK_BASE_URL;
      else if (name.includes('qwen') && current === DEEPSEEK_BASE_URL) url.value = DEFAULT_BASE_URL;
    };
    model.addEventListener('input', syncBaseUrl);
    model.addEventListener('change', syncBaseUrl);
    const showResult = (ok: boolean, message: string) => {
      result.classList.remove('hidden', 'ok', 'error');
      result.classList.add(ok ? 'ok' : 'error');
      result.textContent = message;
    };
    modal.element.querySelector('#cfg-test')!.addEventListener('click', async () => {
      const candidate = readConfig();
      if (!candidate.baseUrl || !candidate.apiKey || !candidate.model) {
        showResult(false, '请先填写完整配置。');
        return;
      }
      showResult(true, '正在测试连接与图像能力…');
      const response = await testConnection(candidate);
      showResult(response.ok, response.message);
    });
    modal.element.querySelector('#cfg-save')!.addEventListener('click', () => {
      const candidate = readConfig();
      try {
        const parsed = new URL(candidate.baseUrl);
        if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error();
      } catch {
        showResult(false, '接口地址必须是有效的 http(s) URL。');
        return;
      }
      if (!candidate.apiKey || !candidate.model) {
        showResult(false, 'API Key 与模型名不能为空。');
        return;
      }
      saveConfig(candidate);
      this.config = candidate;
      modal.close();
      this.toast('模型配置已保存到浏览器本地', 'success');
      afterSave?.();
    });
    modal.element.querySelector('#cfg-clear')!.addEventListener('click', () => {
      clearConfig();
      this.config = null;
      url.value = DEFAULT_BASE_URL;
      key.value = '';
      model.value = DEFAULT_MODEL;
      showResult(true, '已清除本地配置。');
    });
  }

  private requestUpload(file?: File) {
    if (file) {
      const error = validateImageFile(file);
      if (error) {
        this.toast(error, 'warning');
        return;
      }
    }
    if (!this.config) {
      this.pendingUploadFile = file ?? null;
      this.toast('首次识别需要配置你自己的模型接口', 'info');
      this.showConfig(() => {
        const pending = this.pendingUploadFile;
        this.pendingUploadFile = null;
        this.openUploadModal(pending ?? undefined);
      });
      return;
    }
    this.openUploadModal(file);
  }

  private openUploadModal(file?: File) {
    let imageDataUrl: string | null = null;
    const modal = openModal('上传户型图', `
      <div class="upload-zone" id="upload-zone" tabindex="0" role="button">
        <img id="upload-preview" class="hidden" alt="户型图预览" />
        <div id="upload-placeholder"><strong>点击选择 / 拖拽 / 粘贴图片</strong><span>JPG / PNG / WebP · ≤10MB · 仅发送至你配置的模型接口</span></div>
        <div class="scan-overlay hidden" id="scan-overlay" aria-hidden="true">
          <div class="scan-grid"></div>
          <div class="scan-beam"></div>
          <span class="scan-corner tl"></span><span class="scan-corner tr"></span><span class="scan-corner bl"></span><span class="scan-corner br"></span>
          <span class="scan-badge"><i></i>AI SCANNING</span>
        </div>
      </div>
      <div class="recognition-progress hidden" id="recognition-progress" role="status" aria-live="polite">
        <div class="scan-status">
          <svg class="cube-loader" viewBox="0 0 64 64" aria-hidden="true">
            <path class="face-top" d="M32 4 58 18 32 32 6 18Z" />
            <path class="face-left" d="M32 32v28L6 46V18Z" />
            <path class="face-right" d="M32 32v28l26-14V18Z" />
          </svg>
          <div class="scan-copy">
            <strong>AI 正在后台分析，页面没有卡住</strong>
            <span id="scan-hint">正在定位墙体轮廓…</span>
          </div>
          <span class="scan-timer" id="scan-timer">00:00</span>
        </div>
        <div class="progress-track"><div class="progress-bar" id="progress-bar"></div></div>
        <ol><li data-stage="upload">读取图片</li><li data-stage="recognize">AI 识别墙体门窗</li><li data-stage="generate">生成结构化户型</li><li data-stage="done">完成</li></ol>
        <p class="scan-note">推理型模型（如 DeepSeek）通常需要 1–3 分钟，期间请保持窗口打开；图片仅发送至你配置的模型接口。</p>
      </div>
      <div id="upload-error" class="config-result error hidden"></div>
      <div class="modal-actions spread">
        <button id="upload-manual" class="ghost-button" type="button">手动描绘兜底</button>
        <div><button id="upload-demo" class="ghost-button" type="button">先用示例</button><button id="upload-recognize" class="primary-button" type="button" disabled>开始 AI 识别</button></div>
      </div>
    `, { wide: true, onClose: () => { fileInput.removeEventListener('change', onFileChange); stopLoading(); } });
    this.activeModal = modal;
    const zone = modal.element.querySelector<HTMLElement>('#upload-zone')!;
    const preview = modal.element.querySelector<HTMLImageElement>('#upload-preview')!;
    const placeholder = modal.element.querySelector('#upload-placeholder')!;
    const recognizeButton = modal.element.querySelector<HTMLButtonElement>('#upload-recognize')!;
    const errorBox = modal.element.querySelector('#upload-error')!;
    const progress = modal.element.querySelector('#recognition-progress')!;
    const progressBar = modal.element.querySelector<HTMLElement>('#progress-bar')!;
    const scanOverlay = modal.element.querySelector('#scan-overlay')!;
    const scanHint = modal.element.querySelector('#scan-hint')!;
    const scanTimer = modal.element.querySelector('#scan-timer')!;
    const demoButton = modal.element.querySelector<HTMLButtonElement>('#upload-demo')!;
    const manualButton = modal.element.querySelector<HTMLButtonElement>('#upload-manual')!;

    const loadingHints = [
      '正在定位墙体轮廓…',
      '正在区分门、窗与开口…',
      '正在估算房间尺寸与面积…',
      '推理型模型会先思考再作答，耗时更长属正常现象',
      '识别完成后将自动生成 3D 沙盘…',
    ];
    let loadingTimers: number[] = [];
    const stopLoading = () => {
      loadingTimers.forEach((timer) => clearInterval(timer));
      loadingTimers = [];
      zone.classList.remove('scanning');
      scanOverlay.classList.add('hidden');
    };
    const startLoading = () => {
      const startedAt = Date.now();
      let hintIndex = 0;
      scanHint.textContent = loadingHints[0];
      scanTimer.textContent = '00:00';
      zone.classList.add('scanning');
      scanOverlay.classList.remove('hidden');
      loadingTimers.push(window.setInterval(() => {
        const seconds = Math.floor((Date.now() - startedAt) / 1000);
        scanTimer.textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
      }, 1000));
      loadingTimers.push(window.setInterval(() => {
        hintIndex = (hintIndex + 1) % loadingHints.length;
        scanHint.textContent = loadingHints[hintIndex];
        scanHint.animate([{ opacity: 0.2 }, { opacity: 1 }], { duration: 350 });
      }, 4500));
    };

    const setFile = async (nextFile: File) => {
      if (zone.classList.contains('scanning')) return;
      const error = validateImageFile(nextFile);
      if (error) {
        errorBox.classList.remove('hidden');
        errorBox.textContent = error;
        return;
      }
      imageDataUrl = await fileToDataUrl(nextFile);
      preview.src = imageDataUrl;
      preview.classList.remove('hidden');
      placeholder.classList.add('hidden');
      recognizeButton.disabled = false;
      errorBox.classList.add('hidden');
    };
    if (file) void setFile(file);

    zone.addEventListener('click', () => {
      if (!zone.classList.contains('scanning')) this.query<HTMLInputElement>('#file-input').click();
    });
    zone.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !zone.classList.contains('scanning')) this.query<HTMLInputElement>('#file-input').click();
    });
    zone.addEventListener('dragover', (event) => event.preventDefault());
    zone.addEventListener('drop', (event) => {
      event.preventDefault();
      const dropped = event.dataTransfer?.files?.[0];
      if (dropped) void setFile(dropped);
    });
    const fileInput = this.query<HTMLInputElement>('#file-input');
    const onFileChange = () => {
      const selected = fileInput.files?.[0];
      fileInput.value = '';
      if (selected) void setFile(selected);
    };
    fileInput.addEventListener('change', onFileChange);

    const stageOrder: RecognitionStage[] = ['upload', 'recognize', 'generate', 'done'];
    const setStage = (stage: RecognitionStage) => {
      const index = stageOrder.indexOf(stage);
      progressBar.style.width = `${((index + 1) / stageOrder.length) * 100}%`;
      progress.querySelectorAll('li').forEach((item, itemIndex) => item.classList.toggle('active', itemIndex <= index));
    };

    recognizeButton.addEventListener('click', async () => {
      if (!imageDataUrl || !this.config) return;
      recognizeButton.disabled = true;
      recognizeButton.classList.add('busy');
      recognizeButton.textContent = 'AI 识别中…';
      demoButton.disabled = true;
      manualButton.disabled = true;
      errorBox.classList.add('hidden');
      progress.classList.remove('hidden');
      setStage('upload');
      startLoading();
      try {
        const plan = await recognizeFloorPlan(this.config, imageDataUrl, setStage);
        stopLoading();
        this.store.replace(plan);
        this.currentProjectId = null;
        this.setPlanSourceLabel('AI 识别方案');
        modal.close();
        this.setViewMode('split');
        this.scene.resetCamera();
        this.toast('识别完成，可在 2D 视图校正低置信度区域', 'success');
      } catch (error) {
        stopLoading();
        progress.classList.add('hidden');
        errorBox.classList.remove('hidden');
        errorBox.innerHTML = '';
        const message = document.createElement('div');
        message.textContent = error instanceof Error ? error.message : '识别失败，请重试。';
        errorBox.appendChild(message);
        if (error instanceof RecognitionError && error.raw) {
          const details = document.createElement('details');
          details.className = 'raw-output';
          const summary = document.createElement('summary');
          summary.textContent = '查看模型原始输出（仅保存在本页，用于排查）';
          const pre = document.createElement('pre');
          pre.textContent = error.raw.slice(0, 6000);
          details.append(summary, pre);
          errorBox.appendChild(details);
        }
        recognizeButton.classList.remove('busy');
        recognizeButton.disabled = false;
        recognizeButton.textContent = '重试识别';
        demoButton.disabled = false;
        manualButton.disabled = false;
      }
    });
    modal.element.querySelector('#upload-manual')!.addEventListener('click', () => {
      modal.close();
      this.setViewMode('2d');
      this.setTool('wall');
      this.toast('已切换到 2D 手动描绘，无需 API Key', 'info');
    });
    modal.element.querySelector('#upload-demo')!.addEventListener('click', () => {
      modal.close();
      this.loadDemo('two-bed');
    });
  }

  private showReplay() {
    const demoId = this.query<HTMLSelectElement>('#demo-select').value;
    const entry = DEMO_PLANS.find((demo) => demo.id === demoId) ?? DEMO_PLANS[1];
    const modal = openModal('模拟识别演示', `
      <p class="modal-note">这是内置示例回放，用于展示“图纸 → 识别 → 3D”的流程，不是真实 AI 识别。真实识别请上传你自己的户型图。</p>
      <div class="replay-layout">
        <img class="replay-plan" src="${planToDataUrl(entry.plan, 560)}" alt="${escapeHtml(entry.title)}示例图纸" />
        <ol class="replay-steps">
          <li data-step="0">上传示例图纸</li>
          <li data-step="1">识别墙体 / 门窗 / 房间</li>
          <li data-step="2">估算尺寸与置信度</li>
          <li data-step="3">生成 3D 沙盘与家具</li>
        </ol>
      </div>
      <div class="modal-actions"><button id="replay-skip" class="ghost-button" type="button">跳过动画</button><button id="replay-run" class="primary-button" type="button">开始演示</button></div>
    `, { wide: true, onClose: () => timers.forEach((timer) => clearTimeout(timer)) });
    this.activeModal = modal;
    const steps = modal.element.querySelectorAll<HTMLElement>('.replay-steps li');
    const timers: number[] = [];
    const finish = () => {
      timers.forEach((timer) => clearTimeout(timer));
      this.store.replace(getDemoPlan(entry.id));
      this.currentProjectId = null;
      this.setPlanSourceLabel(null);
      this.query<HTMLSelectElement>('#demo-select').value = entry.id;
      modal.close();
      this.setViewMode('3d');
      this.scene.resetCamera();
      this.toast('示例演示完成，可自由旋转与摆放家具', 'success');
    };
    modal.element.querySelector('#replay-skip')!.addEventListener('click', finish);
    modal.element.querySelector('#replay-run')!.addEventListener('click', () => {
      steps.forEach((step) => step.classList.remove('active', 'done'));
      steps.forEach((step, index) => {
        timers.push(window.setTimeout(() => {
          step.classList.add('active');
          if (index > 0) steps[index - 1].classList.add('done');
          if (index === steps.length - 1) timers.push(window.setTimeout(finish, 700));
        }, index * 800));
      });
    });
  }

  private showAbout() {
    const modal = openModal('关于 FloorCube', `
      <div class="about-body">
        <p><strong>户型魔方 FloorCube</strong> 把抽象的户型图纸照片变成可旋转、可试摆家具的 3D 房间小模型。</p>
        <ul>
          <li>参赛：2026 Qoder 高校创造力大赛 · LifeHack 生活娱乐赛道</li>
          <li>开发：全程使用 Qoder 完成需求、建模、交互与部署</li>
          <li>视角：上帝第三人称斜俯视沙盘，不做第一人称漫游</li>
          <li>隐私：零注册、零埋点、零数据收集；配置与方案仅存浏览器本地；图纸只发送到你自己配置的模型接口</li>
          <li>模型：22 件原创程序化家具，无外部 GLTF 素材</li>
        </ul>
        <p class="built-with">Built with Qoder</p>
      </div>
    `);
    this.activeModal = modal;
  }

  private showOnboarding() {
    const modal = openModal('欢迎使用户型魔方', `
      <div class="onboarding-steps">
        <article><span>1</span><strong>看示例</strong><p>打开即有带家具的 3D 户型，拖拽旋转、滚轮缩放，无需任何配置。</p></article>
        <article><span>2</span><strong>试摆放</strong><p>从右侧家具库点击或拖拽家具到地面，移动、旋转、换色，实时检查尺寸。</p></article>
        <article><span>3</span><strong>识别你的图纸</strong><p>上传户型图前配置你自己的模型接口；也可以直接用 2D 工具手动描绘。</p></article>
      </div>
      <div class="modal-actions"><button id="onboard-skip" class="ghost-button" type="button">跳过</button><button id="onboard-start" class="primary-button" type="button">开始体验</button></div>
    `, { wide: true });
    this.activeModal = modal;
    const done = () => {
      markOnboarded();
      modal.close();
    };
    modal.element.querySelector('#onboard-skip')!.addEventListener('click', done);
    modal.element.querySelector('#onboard-start')!.addEventListener('click', done);
  }

  private toast(message: string, kind: 'info' | 'success' | 'warning' = 'info', action?: { label: string; action: () => void }) {
    const root = this.query('#toast-root');
    const toast = document.createElement('div');
    toast.className = `toast ${kind}`;
    toast.innerHTML = `<span>${escapeHtml(message)}</span>${action ? `<button type="button">${escapeHtml(action.label)}</button>` : ''}`;
    root.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('visible'));
    const remove = () => {
      toast.classList.remove('visible');
      setTimeout(() => toast.remove(), 220);
    };
    if (action) {
      toast.querySelector('button')!.addEventListener('click', () => {
        action.action();
        remove();
      });
    }
    setTimeout(remove, action ? 6000 : 3200);
  }

  private scheduleAutosave() {
    clearTimeout(this.autosaveTimer);
    this.autosaveTimer = window.setTimeout(() => saveAutosave(this.store.plan), 600);
  }

  private updateHistoryButtons() {
    this.query<HTMLButtonElement>('#undo-button').disabled = !this.store.canUndo;
    this.query<HTMLButtonElement>('#redo-button').disabled = !this.store.canRedo;
  }
}
