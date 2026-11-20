import { BASE_URL_PRESETS, DEFAULT_BASE_URL, DEFAULT_MODEL, MODEL_PRESETS, RecognitionError, fileToDataUrl, getRecognitionSettings, getRequestModel, recognizeFloorPlan, testConnection, validateImageFile } from '../ai/client';
import type { RecognitionMode, RecognitionProgress } from '../ai/client';
import { polygonArea } from '../core/geometry';
import { constrainFurnitureLayout, smartLayout } from '../core/layout';
import { validateFurniture } from '../core/placement';
import { emptyPlan, normalizeFloorPlan, planArea, roomTypeName, scalePlan, uid, wallLength, ROOM_TYPES } from '../core/schema';
import type { FloorPlan, ModelConfig, RoomType } from '../core/schema';
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
type SidebarTab = 'furniture' | 'rooms' | 'projects' | 'scene';

const ICONS = {
  upload: '<path d="M12 16V4m0 0L7 9m5-5 5 5M5 14v5h14v-5"/>',
  save: '<path d="M5 4h12l2 2v14H5V4Z"/><path d="M8 4v6h8V4M8 20v-6h8v6"/>',
  export: '<path d="M12 15V3m0 0L8 7m4-4 4 4M5 12v8h14v-8"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19 13.5v-3l-2-.7-.6-1.4.9-1.9-2.1-2.1-1.9.9-1.4-.6-.7-2h-3l-.7 2-1.4.6-1.9-.9-2.1 2.1.9 1.9-.6 1.4-2 .7v3l2 .7.6 1.4-.9 1.9 2.1 2.1 1.9-.9 1.4.6.7 2h3l.7-2 1.4-.6 1.9.9 2.1-2.1-.9-1.9.6-1.4 2-.7Z"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
  play: '<path d="m9 6 9 6-9 6V6Z"/>',
  undo: '<path d="m9 7-5 5 5 5M5 12h8a6 6 0 0 1 6 6"/>',
  redo: '<path d="m15 7 5 5-5 5m4-5h-8a6 6 0 0 0-6 6"/>',
  reset: '<path d="M4 10a8 8 0 1 1 2 7M4 10V4m0 6h6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
};

function icon(name: keyof typeof ICONS) {
  return `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
}

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

function openModal(title: string, body: string, options: { wide?: boolean; closeOnBackdrop?: boolean; onClose?: () => void } = {}): ModalHandle {
  const root = document.querySelector<HTMLElement>('#modal-root')!;
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal ${options.wide ? 'modal-wide' : ''}" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}">
      <header class="modal-header"><h2>${escapeHtml(title)}</h2><button class="icon-button modal-close" type="button" aria-label="关闭">${icon('close')}</button></header>
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
    if (event.target === overlay && options.closeOnBackdrop !== false) close();
  });
  requestAnimationFrame(() => overlay.classList.add('visible'));
  return { close, element: overlay };
}

export class App {
  private store: PlanStore;
  private scene!: FloorScene;
  private editor!: PlanEditor;
  private thumbnails: Record<string, string> = {};
  private thumbnailCache: Partial<Record<FurnitureColor, Record<string, string>>> = {};
  private settings: SceneSettings = { ...DEFAULT_SCENE_SETTINGS };
  private viewMode: ViewMode = '3d';
  private config: ModelConfig | null = loadConfig();
  private currentProjectId: string | null = null;
  private placementModel: FurnitureModelId | null = null;
  private defaultColor: FurnitureColor = 'walnut';
  private libraryCategory = 'all';
  private librarySearch = '';
  private autosaveTimer = 0;
  private activeModal: ModalHandle | null = null;
  private configModal: (ModalHandle & { afterSave?: () => void }) | null = null;
  private uploadModal: (ModalHandle & { setFile: (file: File) => Promise<void> }) | null = null;
  private pendingUploadFile: File | null = null;
  private recognitionMode: RecognitionMode = 'fast';

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
      this.ensureThumbnails(this.defaultColor);
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
            <svg class="brand-mark" viewBox="0 0 40 40" fill="none" aria-hidden="true">
              <path d="M5 11 20 3l15 8v18l-15 8-15-8V11Z" stroke="currentColor" stroke-width="1.8"/>
              <path d="m5 11 15 8 15-8M20 19v18M12 15v10l8 4 8-4V15" stroke="currentColor" stroke-width="1.8"/>
              <path d="m12 7 8 4 8-4" stroke="var(--accent)" stroke-width="2.4"/>
            </svg>
            <div class="brand-copy"><strong>FloorCube</strong><small>户型魔方 · 把家摆成立体</small></div>
          </div>
          <div class="demo-controls">
            <span class="demo-label">示例方案</span>
            <select id="demo-select" aria-label="切换示例方案">${DEMO_PLANS.map((demo) => `<option value="${demo.id}" ${demo.id === 'two-bed' ? 'selected' : ''}>${demo.title} · ${demo.subtitle}</option>`).join('')}</select>
            <button id="replay-button" class="icon-button" type="button" aria-label="播放模拟识别演示" title="模拟识别演示">${icon('play')}</button>
          </div>
          <div class="top-actions">
            <button id="upload-button" class="primary-button" type="button" aria-label="上传户型图">${icon('upload')}<span class="button-label">上传户型图</span></button>
            <button id="save-button" class="ghost-button" type="button" aria-label="保存方案" title="保存方案">${icon('save')}<span class="button-label">保存</span></button>
            <button id="export-button" class="ghost-button" type="button" aria-label="导出作品" title="导出作品">${icon('export')}<span class="button-label">导出</span></button>
            <button id="config-button" class="ghost-button" type="button" aria-label="模型接口设置" title="模型接口设置">${icon('settings')}<span class="button-label">接口</span></button>
            <button id="about-button" class="icon-button" type="button" aria-label="关于与隐私" title="关于与隐私">${icon('info')}</button>
          </div>
        </header>

        <main class="main-layout">
          <section class="viewport-panel">
            <div class="viewport-toolbar">
              <div class="segmented" role="group" aria-label="视图切换">
                <button data-view="3d" class="active" type="button">3D 沙盘</button>
                <button data-view="split" type="button">分屏</button>
                <button data-view="2d" type="button">2D 平面</button>
              </div>
              <div class="editor-tools" id="editor-tools">
                <button data-tool="select" class="active" type="button" title="选择 / 移动">选择</button>
                <button data-tool="wall" type="button" title="拖拽绘制墙体">画墙</button>
                <button data-tool="door" type="button" title="点击墙体添加门">门</button>
                <button data-tool="window" type="button" title="点击墙体添加窗">窗</button>
                <button data-tool="room" type="button" title="拖拽绘制房间">房间</button>
                <button data-tool="erase" type="button" title="点击删除元素">删除</button>
                <button id="fit-2d" type="button" title="适配视图">适配</button>
              </div>
              <div class="toolbar-right">
                <div class="viewport-options">
                  <label class="compact-field"><span>墙体</span><select id="ctrl-wall-mode" aria-label="墙体显示模式"><option value="low">降墙</option><option value="solid">实体</option><option value="ghost">半透明</option></select></label>
                  <label class="compact-field"><span>机位</span><select id="ctrl-camera" aria-label="相机机位"><option value="iso">45° 沙盘</option><option value="top">正俯视</option><option value="front">正面斜视</option></select></label>
                  <button id="camera-reset" class="icon-button" type="button" aria-label="恢复默认机位" title="恢复默认机位">${icon('reset')}</button>
                </div>
                <div class="history-controls">
                  <button id="undo-button" class="icon-button" type="button" aria-label="撤销" title="撤销 ⌘Z" disabled>${icon('undo')}</button>
                  <button id="redo-button" class="icon-button" type="button" aria-label="重做" title="重做 ⇧⌘Z" disabled>${icon('redo')}</button>
                </div>
              </div>
            </div>

            <div class="viewport-stack" id="viewport-stack" data-view="3d">
              <div id="scene-container" class="scene-container"></div>
              <div id="editor-container" class="editor-container"></div>
              <div class="viewport-hud">
                <span class="hud-chip" id="hud-mode">拖拽旋转 · 滚轮缩放</span>
                <div class="hud-chip hud-placement hidden" id="hud-placement"><span id="placement-name">点击地面放置家具</span><button id="cancel-placement" type="button">完成</button></div>
                <span class="hud-chip hud-orbit hidden" id="hud-orbit"></span>
              </div>
              <div class="drop-overlay hidden" id="drop-overlay"><strong>松开以上传户型图</strong><span>JPG / PNG / WebP · ≤10MB</span></div>
              <div class="furniture-inspector hidden" id="furniture-inspector"></div>
            </div>

            <footer class="statusbar">
              <strong id="status-name"></strong>
              <span id="status-area"></span>
              <button id="status-scale" type="button" title="校准户型尺寸"></button>
              <span id="status-furniture"></span>
              <span class="status-hint"><i></i>本地工作区 · 不收集任何信息</span>
            </footer>
          </section>

          <aside class="sidebar" id="sidebar">
            <button id="drawer-toggle" class="drawer-handle" type="button" aria-expanded="false"><span>打开工作台</span><i></i></button>
            <div class="sidebar-tabs" role="tablist" aria-label="工作台面板">
              <button data-tab="furniture" class="active" type="button" role="tab">家具</button>
              <button data-tab="rooms" type="button" role="tab">房间</button>
              <button data-tab="projects" type="button" role="tab">方案</button>
              <button data-tab="scene" type="button" role="tab">场景</button>
            </div>
            <div class="sidebar-scroll">
              <section class="tab-panel active" data-panel="furniture">
                <header class="panel-heading"><div><h2>家具库</h2><p>选一件家具，在户型中点击放置</p></div><span>${FURNITURE_CATALOG.length} 件</span></header>
                <div class="library-controls">
                  <input id="library-search" type="search" placeholder="搜索名称或型号" aria-label="搜索家具" />
                </div>
                <div class="category-chips" id="category-chips"></div>
                <div class="library-meta">
                  <label for="default-color">新家具配色</label>
                  <div class="library-meta-actions">
                    <select id="default-color" aria-label="新家具默认配色">
                      ${Object.values(FURNITURE_PALETTES).map((palette) => `<option value="${palette.id}">${palette.name}</option>`).join('')}
                    </select>
                    <button id="apply-color" class="mini-button" type="button" title="把当前配色应用到全部已放置家具">应用全部</button>
                  </div>
                </div>
                <div class="furniture-grid" id="furniture-grid"></div>
                <button id="smart-layout" class="ghost-button full-width library-layout" type="button">重新自动布置全部家具</button>
              </section>
              <section class="tab-panel" data-panel="rooms">
                <header class="panel-heading"><div><h2>房间</h2><p>选择房间，编辑名称与用途</p></div></header>
                <div id="room-list" class="room-list"></div>
                <div id="room-editor" class="room-editor"></div>
                <button id="room-calibrate" class="ghost-button full-width" type="button">校准整体尺寸</button>
              </section>
              <section class="tab-panel" data-panel="projects">
                <header class="panel-heading"><div><h2>我的方案</h2><p>自动保存当前进度，也可建立命名方案</p></div></header>
                <div class="project-actions">
                  <button id="new-plan-button" class="primary-button" type="button">${icon('plus')}新建空白户型</button>
                  <button id="project-import" class="ghost-button" type="button">导入 JSON</button>
                </div>
                <div id="project-list" class="project-list"></div>
              </section>
              <section class="tab-panel" data-panel="scene">
                <header class="panel-heading"><div><h2>场景设置</h2><p>调整观察方式，不影响户型数据</p></div><button id="scene-reset" class="mini-button" type="button">重置</button></header>
                <div class="settings-group">
                  <h3>空间</h3>
                  <div class="control-grid">
                    <label><span>墙高 <output id="ctrl-wall-height-out">2.8m</output></span>
                      <input id="ctrl-wall-height" type="range" min="2.2" max="4" step="0.1" value="2.8" />
                    </label>
                    <label><span>灯光 <output id="ctrl-light-out">100%</output></span>
                      <input id="ctrl-light" type="range" min="0.4" max="1.8" step="0.05" value="1" />
                    </label>
                    <label><span>旋转速度 <output id="ctrl-speed-out">0.6</output></span>
                      <input id="ctrl-speed" type="range" min="0" max="2" step="0.1" value="0.6" />
                    </label>
                    <label>渲染画质
                      <select id="ctrl-quality"><option value="high">高质量</option><option value="balanced">均衡</option></select>
                    </label>
                  </div>
                </div>
                <div class="settings-group">
                  <h3>显示与编辑</h3>
                  <div class="toggle-row">
                    <label class="toggle"><input id="ctrl-rotate" type="checkbox" checked /><span>自动旋转</span></label>
                    <label class="toggle"><input id="ctrl-grid" type="checkbox" checked /><span>地面网格</span></label>
                    <label class="toggle"><input id="ctrl-labels" type="checkbox" checked /><span>房间标签</span></label>
                    <label class="toggle"><input id="ctrl-dimensions" type="checkbox" /><span>尺寸标注</span></label>
                    <label class="toggle"><input id="ctrl-snap" type="checkbox" checked /><span>网格吸附</span></label>
                  </div>
                </div>
                <p class="settings-note">墙体模式与机位可直接在视图上方切换。拖拽视角后会暂停自动旋转，10 秒后继续。</p>
              </section>
            </div>
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
    this.query('#room-calibrate').addEventListener('click', () => this.showCalibration());
    this.query('#status-scale').addEventListener('click', () => this.showCalibration());
    this.query('#save-button').addEventListener('click', () => this.showSave());
    this.query('#export-button').addEventListener('click', () => this.showExport());
    this.query('#about-button').addEventListener('click', () => this.showAbout());
    this.query('#camera-reset').addEventListener('click', () => this.scene.resetCamera());
    this.query('#cancel-placement').addEventListener('click', () => this.cancelPlacement());
    this.query('#new-plan-button').addEventListener('click', () => {
      this.store.replace(emptyPlan('未命名户型'));
      this.currentProjectId = null;
      this.setPlanSourceLabel('空白户型');
      this.setViewMode('2d');
      this.setTool('wall');
      this.renderProjects();
      this.toast('已创建空白户型，拖拽即可画墙', 'info', { label: '撤销', action: () => this.restorePreviousPlan() });
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
    this.query('#default-color').addEventListener('change', (event) => {
      this.defaultColor = (event.target as HTMLSelectElement).value as FurnitureColor;
      this.ensureThumbnails(this.defaultColor);
      this.renderLibrary();
      if (this.placementModel) this.scene.setPlacement(this.placementModel, this.defaultColor);
    });
    this.query('#apply-color').addEventListener('click', () => {
      const color = this.defaultColor;
      const pending = this.store.plan.furniture.filter((item) => item.color !== color).length;
      if (pending === 0) {
        this.toast('全部家具已经是这个配色', 'success');
        return;
      }
      this.store.mutate((plan) => {
        for (const item of plan.furniture) item.color = color;
      });
      this.toast(`已把 ${pending} 件家具换成「${FURNITURE_PALETTES[color].name}」配色`, 'success');
    });

    this.bindSceneControls();
    this.bindUploadInputs();
    this.bindKeyboard();
    this.query('#drawer-toggle').addEventListener('click', () => {
      const sidebar = this.query('#sidebar');
      const open = sidebar.classList.toggle('drawer-open');
      this.query('#drawer-toggle').setAttribute('aria-expanded', String(open));
      this.query('#drawer-toggle span').textContent = open ? '收起工作台' : '打开工作台';
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
        this.renderProjects();
        this.toast('已导入户型 JSON', 'success', { label: '撤销', action: () => this.restorePreviousPlan() });
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
      this.toast('已按房间用途重新布置，原有家具已替换', 'success', { label: '撤销', action: () => this.store.undo() });
    });
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
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        this.showSave();
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
        if (id) {
          event.preventDefault();
          this.deleteFurniture(id);
        }
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
    const previous = this.viewMode;
    this.viewMode = mode;
    this.query('#viewport-stack').dataset.view = mode;
    this.root.querySelectorAll<HTMLButtonElement>('button[data-view]').forEach((button) => {
      const active = button.dataset.view === mode;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    this.query('#editor-tools').classList.toggle('visible', mode !== '3d');
    this.query('#hud-mode').textContent = mode === '2d' ? '滚轮缩放 · 右键平移 · Shift 正交' : mode === 'split' ? '左侧观察 · 右侧校正' : '拖拽旋转 · 滚轮缩放';
    if (mode === '2d') this.query('#hud-orbit').classList.add('hidden');
    if (mode !== '3d' && previous === '3d') requestAnimationFrame(() => this.editor.fit());
  }

  private updateOrbitHud(state: { phase: 'drag' | 'hold' | 'off'; seconds: number }) {
    const chip = this.query('#hud-orbit');
    if (state.phase === 'off' || this.viewMode === '2d') {
      chip.classList.add('hidden');
      return;
    }
    chip.classList.remove('hidden');
    chip.textContent = state.phase === 'drag'
      ? '手动视角'
      : `自动旋转已暂停 · ${state.seconds}s 后继续`;
  }

  private setTool(tool: EditorTool) {
    this.editor.setTool(tool);
    this.root.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach((button) => {
      const active = button.dataset.tool === tool;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    if (this.viewMode === '3d') this.setViewMode('split');
  }

  private setSidebarTab(tab: SidebarTab) {
    this.root.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((button) => {
      const active = button.dataset.tab === tab;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
    });
    this.root.querySelectorAll<HTMLElement>('[data-panel]').forEach((panel) => panel.classList.toggle('active', panel.dataset.panel === tab));
    if (tab === 'projects') this.renderProjects();
    if (tab === 'rooms') this.renderRooms();
  }

  private renderStatus() {
    const plan = this.store.plan;
    this.query('#status-name').textContent = plan.name;
    this.query('#status-area').textContent = `${planArea(plan).toFixed(1)} ㎡`;
    const scaleText = plan.scaleSource === 'annotation' ? '标注尺寸' : plan.scaleSource === 'user-calibrated' ? '尺寸已校准' : '门宽估算 · 点击校准';
    this.query('#status-scale').textContent = scaleText;
    this.query('#status-furniture').textContent = `${plan.furniture.length} 件家具`;
    const wallHeight = this.query<HTMLInputElement>('#ctrl-wall-height');
    if (document.activeElement !== wallHeight) wallHeight.value = String(plan.wallHeight);
    this.query('#ctrl-wall-height-out').textContent = `${plan.wallHeight.toFixed(1)}m`;
  }

  private ensureThumbnails(color: FurnitureColor) {
    const cached = this.thumbnailCache[color];
    this.thumbnails = cached ?? (this.thumbnailCache[color] = generateThumbnails(color));
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
    chips.innerHTML = categories.map((category) => `<button data-category="${category.id}" class="${this.libraryCategory === category.id ? 'active' : ''}" type="button" aria-pressed="${this.libraryCategory === category.id}">${category.name}</button>`).join('');
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
    const grid = this.query('#furniture-grid');
    grid.innerHTML = items.map((item) => `
      <button class="furniture-card ${this.placementModel === item.id ? 'placing' : ''}" draggable="true" data-model="${item.id}" type="button" aria-label="放置${item.name}" title="${item.description}" aria-pressed="${this.placementModel === item.id}">
        <span class="furniture-thumb">${this.thumbnails[item.id] ? `<img src="${this.thumbnails[item.id]}" alt="" />` : '<span class="thumb-placeholder"></span>'}</span>
        <strong>${item.name}</strong>
        <small>${item.dimensions.width} × ${item.dimensions.depth} m</small>
      </button>
    `).join('') || '<p class="empty-note">没有找到匹配的家具，试试其他关键词。</p>';
    grid.querySelectorAll<HTMLElement>('[data-model]').forEach((card) => {
      const model = card.dataset.model as FurnitureModelId;
      card.addEventListener('click', () => this.startPlacement(model));
      card.addEventListener('dragstart', (event) => {
        event.dataTransfer?.setData('application/x-floorcube-model', model);
        if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copy';
      });
    });
  }

  private startPlacement(model: FurnitureModelId) {
    if (this.placementModel === model) {
      this.cancelPlacement();
      return;
    }
    this.placementModel = model;
    this.scene.setPlacement(model, this.defaultColor);
    this.query('#placement-name').textContent = `正在放置「${getFurnitureDefinition(model).name}」`;
    this.query('#hud-placement').classList.remove('hidden');
    this.renderLibrary();
    this.query('#sidebar').classList.remove('drawer-open');
    this.query('#drawer-toggle').setAttribute('aria-expanded', 'false');
    this.query('#drawer-toggle span').textContent = '打开工作台';
    if (this.viewMode === '2d') this.setViewMode('split');
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
      <header><div><strong>${definition.name}</strong><span>${definition.dimensions.width} × ${definition.dimensions.depth} m</span></div><button id="fi-close" class="icon-button" type="button" aria-label="取消选择">${icon('close')}</button></header>
      <label class="rotation-control"><span>旋转角度 <output id="fi-rotation-out">${Math.round((item.rotation * 180) / Math.PI)}°</output></span>
        <input id="fi-rotation" type="range" min="-180" max="180" step="1" value="${Math.round((item.rotation * 180) / Math.PI)}" />
      </label>
      <div class="inspector-actions">
        <button id="fi-rot-left" type="button">−90°</button>
        <button id="fi-rot-right" type="button">+90°</button>
        <select id="fi-color" aria-label="家具配色">${Object.values(FURNITURE_PALETTES).map((palette) => `<option value="${palette.id}" ${palette.id === item.color ? 'selected' : ''}>${palette.name}</option>`).join('')}</select>
        <button id="fi-duplicate" type="button">复制</button>
        <button id="fi-delete" class="danger" type="button" aria-label="删除家具">${icon('close')}</button>
      </div>
      <details class="position-details"><summary>精确坐标</summary><div class="inspector-grid">
        <label>X / m<input id="fi-x" type="number" step="0.1" value="${item.position[0].toFixed(2)}" /></label>
        <label>Z / m<input id="fi-z" type="number" step="0.1" value="${item.position[1].toFixed(2)}" /></label>
      </div></details>
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
    panel.querySelector('#fi-close')!.addEventListener('click', () => this.store.select({}));
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
      <div class="room-stats"><span>面积 ${polygonArea(room.polygon).toFixed(2)}㎡</span><span>识别置信度 ${Math.round(room.confidence * 100)}%</span></div>
      <button id="room-delete" class="ghost-button danger full-width" type="button">删除房间及其中家具</button>
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
      const furnitureCount = plan.furniture.filter((item) => item.roomId === room.id).length;
      this.store.mutate((draft) => {
        draft.rooms = draft.rooms.filter((candidate) => candidate.id !== room.id);
        draft.furniture = draft.furniture.filter((item) => item.roomId !== room.id);
      });
      this.toast(`已删除房间${furnitureCount ? `及 ${furnitureCount} 件家具` : ''}`, 'info', { label: '撤销', action: () => this.store.undo() });
    });
  }

  private renderProjects() {
    const projects = loadProjects();
    const list = this.query('#project-list');
    list.innerHTML = projects.map((project) => `
      <article class="project-card ${project.id === this.currentProjectId ? 'active' : ''}" data-project="${project.id}">
        <button class="project-open" data-action="load" type="button"><span><strong>${escapeHtml(project.name)}</strong><small>${new Date(project.updatedAt).toLocaleDateString('zh-CN')} · ${project.plan.furniture.length} 件家具</small></span><em>${project.id === this.currentProjectId ? '当前方案' : '载入 →'}</em></button>
        <div class="project-card-actions">
          <button data-action="rename" type="button">重命名</button>
          <button data-action="delete" class="danger" type="button">删除</button>
        </div>
      </article>
    `).join('') || '<div class="project-empty"><strong>还没有命名方案</strong><p>当前进度会自动保留。点击顶部“保存”，即可建立一个可反复载入的方案。</p></div>';
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
    this.renderProjects();
    this.toast(`已载入示例「${DEMO_PLANS.find((demo) => demo.id === id)?.title}」`, 'success', { label: '撤销', action: () => this.restorePreviousPlan() });
  }

  private restorePreviousPlan() {
    this.store.undo();
    this.currentProjectId = null;
    this.setPlanSourceLabel(this.store.plan.name);
    this.scene.resetCamera();
    this.renderProjects();
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
    this.cancelPlacement();
    this.scene.resetCamera();
    this.renderProjects();
    this.toast(`已载入「${project.name}」`, 'success', { label: '撤销', action: () => this.restorePreviousPlan() });
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
    const existing = loadProjects().find((project) => project.id === this.currentProjectId);
    if (existing) {
      upsertProject({ ...existing, updatedAt: Date.now(), plan: { ...this.store.plan, name: existing.name } });
      this.renderProjects();
      this.toast(`已更新「${existing.name}」`, 'success');
      return;
    }
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
    if (this.configModal) {
      if (afterSave) this.configModal.afterSave = afterSave;
      return;
    }
    const config = this.config;
    const initialBaseUrl = config?.baseUrl ?? DEFAULT_BASE_URL;
    const initialModel = config?.model ?? DEFAULT_MODEL;
    const customUrl = !BASE_URL_PRESETS.some((preset) => preset.baseUrl === initialBaseUrl);
    const customModel = !MODEL_PRESETS.some((preset) => preset.model === initialModel);
    const modal = openModal('模型接口配置', `
      <p class="modal-note">使用你自己的 OpenAI 兼容视觉接口。配置只保存在当前浏览器，FloorCube 不收集任何信息。</p>
      <label class="modal-field">模型<select id="cfg-model-preset">
        ${MODEL_PRESETS.map((preset) => `<option value="${preset.model}">${preset.label}</option>`).join('')}
        <option value="custom">用户自定义</option>
      </select></label>
      <label class="modal-field hidden" id="cfg-model-custom">自定义模型名称<input id="cfg-model" type="text" value="${escapeHtml(customModel ? initialModel : '')}" placeholder="填写服务商提供的模型名称" /></label>
      <label class="modal-field">接口服务商<select id="cfg-provider" aria-describedby="cfg-url-preset">
        ${BASE_URL_PRESETS.map((preset) => `<option value="${preset.baseUrl}">${preset.label}</option>`).join('')}
        <option value="custom">用户自定义</option>
      </select></label>
      <p class="scan-note" id="cfg-url-preset"></p>
      <label class="modal-field hidden" id="cfg-url-custom">自定义接口地址 Base URL<input id="cfg-url" type="url" value="${escapeHtml(customUrl ? initialBaseUrl : '')}" placeholder="填写 OpenAI 兼容接口的 Base URL" /></label>
      <p class="scan-note" id="cfg-model-request" role="status"></p>
      <label class="modal-field">API Key<input id="cfg-key" type="password" value="${escapeHtml(config?.apiKey ?? '')}" placeholder="sk-…" autocomplete="off" /></label>
      <details class="config-help"><summary>接口怎么填？</summary><p>默认使用 DeepSeek Flash 与 DeepSeek 官方接口。API Key 必须来自所选服务商，模型须支持图像输入。DeepSeek Flash 预设在百炼接口下请求 deepseek-v4.1-flash，支持快速关闭思考、精细开启思考。地域可用性以百炼控制台为准；业务空间专属地址或其他模型可通过“用户自定义”填写。</p></details>
      <div id="cfg-result" class="config-result hidden"></div>
      <div class="modal-actions spread">
        <button id="cfg-clear" class="ghost-button danger" type="button">清除配置</button>
        <div><button id="cfg-test" class="ghost-button" type="button">测试连接</button><button id="cfg-save" class="primary-button" type="button">保存配置</button></div>
      </div>
    `, {
      wide: true,
      onClose: () => {
        this.configModal = null;
        if (this.activeModal === modal) this.activeModal = null;
      },
    });
    this.activeModal = modal;
    this.configModal = { ...modal, afterSave };
    const url = modal.element.querySelector<HTMLInputElement>('#cfg-url')!;
    const key = modal.element.querySelector<HTMLInputElement>('#cfg-key')!;
    const model = modal.element.querySelector<HTMLInputElement>('#cfg-model')!;
    const provider = modal.element.querySelector<HTMLSelectElement>('#cfg-provider')!;
    const modelPreset = modal.element.querySelector<HTMLSelectElement>('#cfg-model-preset')!;
    const result = modal.element.querySelector('#cfg-result')!;
    provider.value = customUrl ? 'custom' : initialBaseUrl;
    modelPreset.value = customModel ? 'custom' : initialModel;
    const syncPresetFields = () => {
      const isCustomUrl = provider.value === 'custom';
      const isCustomModel = modelPreset.value === 'custom';
      modal.element.querySelector('#cfg-url-custom')!.classList.toggle('hidden', !isCustomUrl);
      modal.element.querySelector('#cfg-model-custom')!.classList.toggle('hidden', !isCustomModel);
      url.disabled = !isCustomUrl;
      model.disabled = !isCustomModel;
      const urlPreview = modal.element.querySelector('#cfg-url-preset')!;
      urlPreview.classList.toggle('hidden', isCustomUrl);
      urlPreview.textContent = isCustomUrl ? '' : `Base URL：${provider.value}`;
      const modelPreview = modal.element.querySelector('#cfg-model-request')!;
      try {
        const requestModel = getRequestModel({
          baseUrl: isCustomUrl ? url.value.trim() : provider.value,
          model: isCustomModel ? model.value.trim() : modelPreset.value,
        });
        modelPreview.textContent = requestModel ? `请求模型：${requestModel}` : '请填写模型名称。';
      } catch {
        modelPreview.textContent = '填写有效的接口地址后显示实际请求模型。';
      }
      result.classList.add('hidden');
    };
    provider.addEventListener('change', syncPresetFields);
    modelPreset.addEventListener('change', syncPresetFields);
    url.addEventListener('input', syncPresetFields);
    model.addEventListener('input', syncPresetFields);
    syncPresetFields();
    const showResult = (ok: boolean, message: string) => {
      result.classList.remove('hidden', 'ok', 'error');
      result.classList.add(ok ? 'ok' : 'error');
      result.textContent = message;
    };
    const readConfig = (): ModelConfig | null => {
      const candidate = {
        baseUrl: provider.value === 'custom' ? url.value.trim() : provider.value,
        apiKey: key.value.trim(),
        model: modelPreset.value === 'custom' ? model.value.trim() : modelPreset.value,
      };
      try {
        const parsed = new URL(candidate.baseUrl);
        if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error();
      } catch {
        showResult(false, '接口地址必须是有效的 http(s) URL。');
        return null;
      }
      if (!candidate.apiKey || !candidate.model) {
        showResult(false, 'API Key 与模型名不能为空。');
        return null;
      }
      return candidate;
    };
    modal.element.querySelector('#cfg-test')!.addEventListener('click', async () => {
      const candidate = readConfig();
      if (!candidate) return;
      showResult(true, '正在测试连接与图像能力…');
      const response = await testConnection(candidate);
      showResult(response.ok, response.message);
    });
    modal.element.querySelector('#cfg-save')!.addEventListener('click', () => {
      const candidate = readConfig();
      if (!candidate) return;
      saveConfig(candidate);
      this.config = candidate;
      const onSave = this.configModal?.afterSave;
      modal.close();
      this.toast('模型配置已保存到浏览器本地', 'success');
      onSave?.();
    });
    modal.element.querySelector('#cfg-clear')!.addEventListener('click', () => {
      clearConfig();
      this.config = null;
      provider.value = DEFAULT_BASE_URL;
      modelPreset.value = DEFAULT_MODEL;
      url.value = '';
      key.value = '';
      model.value = '';
      syncPresetFields();
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
    if (this.uploadModal) {
      if (file) void this.uploadModal.setFile(file);
      return;
    }
    let imageDataUrl: string | null = null;
    let closed = false;
    let fileVersion = 0;
    let controller: AbortController | null = null;
    let partialPlan: FloorPlan | null = null;
    let completedPlan: FloorPlan | null = null;
    let previewScene: FloorScene | null = null;
    let previewStore: PlanStore | null = null;
    let previewMode: '2d' | '3d' = '3d';
    let previewSignature = '';
    let previewTimer = 0;
    let timer = 0;
    let startedAt = 0;
    let lastContentAt = 0;
    let receivedChars = 0;
    let requestMode = this.recognitionMode;
    let lastProgress: RecognitionProgress | null = null;
    const milestones = new Set<string>();
    const modal = openModal('上传户型图', `
      <p class="modal-note">边识别，边查看户型。此窗口会一直保留，完成后点击「应用到工作区」才会替换当前方案。</p>
      <fieldset class="recognition-mode-options" id="recognition-mode-options" aria-describedby="recognition-mode-hint">
        <legend>识别模式 <span>切换仅对下次识别生效</span></legend>
        <label><input type="radio" name="recognition-mode" value="fast" ${this.recognitionMode === 'fast' ? 'checked' : ''} /><span><strong>快速</strong><small>优先速度 · 适合清晰图纸</small></span></label>
        <label><input type="radio" name="recognition-mode" value="detailed" ${this.recognitionMode === 'detailed' ? 'checked' : ''} /><span><strong>精细</strong><small>仔细核对 · 适合复杂户型</small></span></label>
      </fieldset>
      <p class="scan-note" id="recognition-mode-hint" role="status"></p>
      <div class="recognition-workspace" id="recognition-workspace">
        <div class="upload-zone" id="upload-zone" tabindex="0" role="button" aria-label="选择户型图">
          <img id="upload-preview" class="hidden" alt="待识别户型图" />
          <div id="upload-placeholder"><strong>点击选择，或将图片拖到这里</strong><span>也支持直接粘贴 · JPG / PNG / WebP · 不超过 10MB</span><small>大图会先缩放以减少传输量</small></div>
        </div>
        <section class="recognition-preview hidden" id="recognition-preview" aria-label="逐步识别预览">
          <header><strong id="recognition-preview-title">实时预览 · 未校验</strong><div class="recognition-view-switch" aria-label="预览视图"><button id="recognition-fit" type="button" aria-label="适配预览全景">全景</button><button type="button" data-preview-view="2d" aria-pressed="false">2D</button><button type="button" data-preview-view="3d" aria-pressed="true">3D</button></div></header>
          <div class="recognition-preview-body">
            <p id="recognition-empty">收到第一面完整墙体后，会在这里逐步搭建户型。</p>
            <img id="recognition-plan-image" class="hidden" alt="已识别的墙体、房间、门窗和家具" />
            <div id="recognition-scene" class="scene-container hidden" aria-label="实时三维户型预览"></div>
          </div>
          <p class="scan-note" id="recognition-preview-note">仅显示已完整返回的对象，缺失部分会随输出补充。</p>
        </section>
      </div>
      <p class="modal-hint" id="upload-image-info" role="status"></p>
      <div class="recognition-progress hidden" id="recognition-progress">
        <div class="scan-status">
          <span class="loading-spinner" id="recognition-spinner" aria-hidden="true"></span>
          <div class="scan-copy" role="status" aria-live="polite"><strong id="scan-title">正在连接模型</strong><span id="scan-hint">等待接口返回首段识别结果</span></div>
          <span class="scan-timer" id="scan-timer" aria-label="已用时间">00:00</span>
        </div>
        <div class="progress-track recognition-activity" aria-hidden="true"><div class="progress-bar"></div></div>
        <ol id="recognition-stages"><li>图片就绪</li><li>等待返回</li><li>实时搭建</li><li>校验应用</li></ol>
        <div class="recognition-counts" id="recognition-counts"><span><b data-count="walls">0</b> 面墙</span><span><b data-count="rooms">0</b> 个房间</span><span><b data-count="openings">0</b> 处门窗</span><span><b data-count="furniture">0</b> 件家具</span></div>
        <p class="scan-note" id="recognition-transfer">已接收 0 字符 · 不估算完成百分比</p>
        <details class="recognition-log"><summary>识别记录</summary><ul id="recognition-events"></ul></details>
      </div>
      <div id="upload-error" class="config-result error hidden" role="alert"></div>
      <div class="modal-actions spread" id="upload-actions">
        <button id="upload-manual" class="ghost-button" type="button">不使用 AI，手动绘制</button>
        <div><button id="upload-apply" class="primary-button hidden" type="button">应用到工作区</button><button id="upload-partial" class="ghost-button hidden" type="button">使用已识别部分</button><button id="upload-cancel" class="ghost-button hidden" type="button">停止识别</button><button id="upload-recognize" class="primary-button" type="button" disabled>开始识别</button></div>
      </div>
    `, { wide: true, closeOnBackdrop: false, onClose: () => {
      closed = true;
      this.uploadModal = null;
      if (this.activeModal === modal) this.activeModal = null;
      fileVersion += 1;
      controller?.abort();
      clearInterval(timer);
      clearTimeout(previewTimer);
      previewScene?.dispose();
      fileInput.removeEventListener('change', onFileChange);
    } });
    this.activeModal = modal;
    const query = <T extends Element = HTMLElement>(selector: string) => modal.element.querySelector<T>(selector)!;
    const modeOptions = query<HTMLFieldSetElement>('#recognition-mode-options');
    const updateModeHint = () => {
      if (this.config) query('#recognition-mode-hint').textContent = getRecognitionSettings(this.config, this.recognitionMode).note;
    };
    modeOptions.addEventListener('change', () => {
      if (controller) return;
      this.recognitionMode = query<HTMLInputElement>('input[name="recognition-mode"]:checked').value as RecognitionMode;
      updateModeHint();
    });
    updateModeHint();
    const zone = query('#upload-zone');
    const preview = query<HTMLImageElement>('#upload-preview');
    const placeholder = query('#upload-placeholder');
    const recognizeButton = query<HTMLButtonElement>('#upload-recognize');
    const manualButton = query<HTMLButtonElement>('#upload-manual');
    const cancelButton = query<HTMLButtonElement>('#upload-cancel');
    const partialButton = query<HTMLButtonElement>('#upload-partial');
    const applyButton = query<HTMLButtonElement>('#upload-apply');
    const errorBox = query('#upload-error');
    const progress = query('#recognition-progress');
    const scanTitle = query('#scan-title');
    const scanHint = query('#scan-hint');
    const scanTimer = query('#scan-timer');
    const imageInfo = query('#upload-image-info');
    const previewPanel = query('#recognition-preview');
    const sceneContainer = query('#recognition-scene');
    const planImage = query<HTMLImageElement>('#recognition-plan-image');
    const previewEmpty = query('#recognition-empty');
    const events = query('#recognition-events');
    const elapsed = () => Math.floor((Date.now() - startedAt) / 1000);
    const log = (key: string, message: string) => {
      if (milestones.has(key)) return;
      milestones.add(key);
      const entry = document.createElement('li');
      entry.textContent = `${elapsed()}s · ${message}`;
      events.appendChild(entry);
    };
    const setStage = (stage: number) => {
      query('#recognition-stages').querySelectorAll('li').forEach((item, index) => {
        item.classList.toggle('active', index <= stage);
        if (index === stage) item.setAttribute('aria-current', 'step');
        else item.removeAttribute('aria-current');
      });
    };
    const resetPreview = () => {
      clearTimeout(previewTimer);
      previewTimer = 0;
      partialPlan = null;
      completedPlan = null;
      previewSignature = '';
      applyButton.classList.add('hidden');
      recognizeButton.classList.replace('ghost-button', 'primary-button');
      query('#recognition-preview-title').textContent = '实时预览 · 未校验';
      previewScene?.dispose();
      previewScene = null;
      previewStore = null;
      sceneContainer.classList.add('hidden');
      planImage.classList.add('hidden');
      planImage.removeAttribute('src');
      previewEmpty.classList.remove('hidden');
      partialButton.classList.add('hidden');
      query('#recognition-preview-note').textContent = '仅显示已完整返回的对象，缺失部分会随输出补充。';
      progress.querySelectorAll('[data-count]').forEach((element) => { element.textContent = '0'; });
    };
    const renderPreview = () => {
      if (!partialPlan || closed) return;
      previewEmpty.classList.add('hidden');
      planImage.classList.toggle('hidden', previewMode !== '2d');
      sceneContainer.classList.toggle('hidden', previewMode !== '3d');
      if (previewMode !== '3d') return;
      if (!previewScene) {
        previewStore = new PlanStore(partialPlan);
        try {
          previewScene = new FloorScene(sceneContainer, previewStore, {
            onSelectFurniture: () => {}, onSelectRoom: () => {}, onFurnitureTransform: () => {},
            onFurnitureDragStart: () => {}, onFurnitureDragEnd: () => {}, onPlace: () => {}, onFeedback: () => {},
          }, true);
          previewScene.updateSettings({ ...DEFAULT_SCENE_SETTINGS, autoRotate: false, showLabels: false, showGrid: false, quality: 'balanced' });
        } catch {
          sceneContainer.replaceChildren();
          previewMode = '2d';
          query<HTMLButtonElement>('[data-preview-view="3d"]').disabled = true;
          query('#recognition-preview-note').textContent = '当前设备无法创建额外 3D 预览，已切换到实时 2D 预览。';
          updatePreviewMode();
          return;
        }
      } else {
        previewStore!.replace(partialPlan, false);
        previewScene.rebuild(true);
      }
    };
    const updatePreviewMode = () => {
      modal.element.querySelectorAll<HTMLButtonElement>('[data-preview-view]').forEach((button) => {
        button.setAttribute('aria-pressed', String(button.dataset.previewView === previewMode));
      });
      renderPreview();
    };
    modal.element.querySelectorAll<HTMLButtonElement>('[data-preview-view]').forEach((button) => {
      button.addEventListener('click', () => {
        previewMode = button.dataset.previewView as '2d' | '3d';
        updatePreviewMode();
      });
    });
    query('#recognition-fit').addEventListener('click', () => { previewScene?.resetCamera(); });
    const updateHint = () => {
      if (!lastProgress) return;
      const idle = Math.floor((Date.now() - lastContentAt) / 1000);
      if (lastProgress.phase === 'validating') {
        scanTitle.textContent = '输出已接收，正在校验户型';
        scanHint.textContent = '检查结构、门窗引用与家具摆放位置';
      } else if (lastProgress.buffered) {
        scanTitle.textContent = '接口采用整包返回';
        scanHint.textContent = '该接口没有返回流式数据，完整结果到达后才能显示';
      } else if (receivedChars === 0) {
        scanTitle.textContent = '等待模型返回识别结果';
        scanHint.textContent = '模型尚未输出户型数据，可能正在排队或推理；可以随时停止';
      } else {
        scanTitle.textContent = '正在接收并搭建户型';
        scanHint.textContent = idle >= 15
          ? `已有 ${idle} 秒未收到新的户型数据，正在等待模型继续输出`
          : partialPlan ? '新返回的完整对象会自动加入预览' : '正在接收第一段结构数据，完整对象返回后即显示';
      }
      query('#recognition-transfer').textContent = `${requestMode === 'fast' ? '快速' : '精细'}模式 · 已接收 ${receivedChars.toLocaleString()} 字符 · ${lastProgress.transport === 'proxy' ? '经转发接口' : '直连接口'} · ${lastProgress.buffered ? '非流式' : '流式请求'}`;
    };
    const onProgress = (event: RecognitionProgress) => {
      if (closed || !controller || controller.signal.aborted) return;
      lastProgress = event;
      if (event.receivedChars > receivedChars) lastContentAt = Date.now();
      receivedChars = event.receivedChars;
      setStage(event.phase === 'validating' ? 3 : receivedChars > 0 ? 2 : 1);
      if (event.transport === 'proxy') log('proxy', '直连不可用，已切换转发接口');
      if (receivedChars > 0) log('first-content', '收到第一段户型数据');
      if (event.partial) {
        const signature = JSON.stringify(event.partial);
        if (signature !== previewSignature) {
          previewSignature = signature;
          partialPlan = event.partial;
          planImage.src = planToDataUrl(partialPlan, 560);
          const labels = { walls: '墙体', rooms: '房间', openings: '门窗', furniture: '家具' } as const;
          for (const key of ['walls', 'rooms', 'openings', 'furniture'] as const) {
            const count = partialPlan[key].length;
            query(`[data-count="${key}"]`).textContent = String(count);
            if (count > 0) log(key, `已显示首批${labels[key]}`);
          }
          if (!previewTimer) {
            previewTimer = window.setTimeout(() => {
              previewTimer = 0;
              renderPreview();
            }, 250);
          }
        }
      }
      if (event.phase === 'validating') log('validating', '模型输出结束，正在校验完整结果');
      updateHint();
    };
    const stopLoading = () => {
      clearInterval(timer);
      zone.classList.remove('scanning');
      zone.setAttribute('aria-disabled', 'false');
      progress.classList.remove('running');
      query('#recognition-spinner').classList.add('hidden');
      cancelButton.classList.add('hidden');
      recognizeButton.classList.remove('hidden', 'busy');
      recognizeButton.disabled = !imageDataUrl;
      manualButton.disabled = false;
    };
    const setFile = async (nextFile: File) => {
      if (controller) return;
      const error = validateImageFile(nextFile);
      if (error) {
        errorBox.classList.remove('hidden');
        errorBox.textContent = error;
        return;
      }
      const version = ++fileVersion;
      imageDataUrl = null;
      recognizeButton.disabled = true;
      imageInfo.textContent = '正在读取并优化图片…';
      errorBox.classList.add('hidden');
      resetPreview();
      previewPanel.classList.add('hidden');
      progress.classList.add('hidden');
      query('#recognition-workspace').classList.remove('recognizing');
      try {
        const prepared = await fileToDataUrl(nextFile);
        if (closed || version !== fileVersion) return;
        imageDataUrl = prepared;
        preview.src = prepared;
        preview.classList.remove('hidden');
        placeholder.classList.add('hidden');
        const bytes = Math.ceil((prepared.length - prepared.indexOf(',') - 1) * 3 / 4);
        const reduction = Math.max(0, Math.round((1 - bytes / nextFile.size) * 100));
        imageInfo.textContent = `图片就绪 · 发送约 ${Math.ceil(bytes / 1024)} KB${reduction > 0 ? `，体积减少 ${reduction}%` : ''} · 图片仅用于你配置的模型接口识别`;
        recognizeButton.textContent = '开始识别';
        recognizeButton.disabled = false;
      } catch (error) {
        if (closed || version !== fileVersion) return;
        imageInfo.textContent = '图片准备失败';
        errorBox.textContent = error instanceof Error ? error.message : '图片读取失败，请换一张图片。';
        errorBox.classList.remove('hidden');
      }
    };
    zone.addEventListener('click', () => {
      if (!controller) this.query<HTMLInputElement>('#file-input').click();
    });
    zone.addEventListener('keydown', (event) => {
      if ((event.key === 'Enter' || event.key === ' ') && !controller) {
        event.preventDefault();
        this.query<HTMLInputElement>('#file-input').click();
      }
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
    const canUsePartial = () => Boolean(partialPlan?.walls.length && partialPlan.rooms.length);
    const applyPlan = (recognizedPlan: FloorPlan, incomplete = false) => {
      const { plan, adjusted, unplaced } = constrainFurnitureLayout(recognizedPlan);
      stopLoading();
      this.store.replace(plan);
      this.currentProjectId = null;
      this.setPlanSourceLabel(incomplete ? 'AI 部分识别 · 待校正' : 'AI 识别方案');
      modal.close();
      this.setViewMode('split');
      this.scene.resetCamera();
      const notes = [
        adjusted > 0 ? `已校正 ${adjusted} 件家具的位置或朝向` : '',
        unplaced > 0 ? `${unplaced} 件家具没有安全位置，未自动放置` : '',
      ].filter(Boolean).join('；');
      const message = incomplete ? '已使用部分结果，缺失的墙体、房间和门窗需要手动补齐' : '识别完成，可在 2D 视图校正低置信度区域';
      this.toast(notes ? `${message}；${notes}` : message, incomplete || unplaced > 0 ? 'warning' : 'success');
    };
    applyButton.addEventListener('click', () => {
      if (!controller && completedPlan) applyPlan(completedPlan);
    });
    cancelButton.addEventListener('click', () => { controller?.abort(); });
    partialButton.addEventListener('click', () => {
      if (controller || !partialPlan?.walls.length || !partialPlan.rooms.length) return;
      applyPlan(normalizeFloorPlan(partialPlan), true);
    });
    recognizeButton.addEventListener('click', async () => {
      if (!imageDataUrl || !this.config || controller) return;
      const request = new AbortController();
      controller = request;
      requestMode = this.recognitionMode;
      modeOptions.disabled = true;
      resetPreview();
      milestones.clear();
      events.replaceChildren();
      receivedChars = 0;
      lastProgress = { phase: 'connecting', transport: 'direct', receivedChars: 0, partial: null, buffered: false };
      startedAt = lastContentAt = Date.now();
      scanTimer.textContent = '00:00';
      recognizeButton.disabled = true;
      recognizeButton.classList.add('hidden');
      manualButton.disabled = true;
      cancelButton.classList.remove('hidden');
      errorBox.classList.add('hidden');
      progress.classList.remove('hidden');
      progress.classList.add('running');
      previewPanel.classList.remove('hidden');
      query('#recognition-workspace').classList.add('recognizing');
      query('#recognition-spinner').classList.remove('hidden');
      zone.classList.add('scanning');
      zone.setAttribute('aria-disabled', 'true');
      log('start', `图片已优化，开始${requestMode === 'fast' ? '快速' : '精细'}识别`);
      setStage(1);
      timer = window.setInterval(() => {
        const seconds = elapsed();
        scanTimer.textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
        updateHint();
      }, 1000);
      try {
        const recognizedPlan = await recognizeFloorPlan(this.config, imageDataUrl, { mode: requestMode, signal: request.signal, onProgress });
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        if (closed || request.signal.aborted) throw new DOMException('已停止识别', 'AbortError');
        completedPlan = recognizedPlan;
        onProgress({ phase: 'validating', transport: lastProgress?.transport ?? 'direct', receivedChars, partial: recognizedPlan, buffered: lastProgress?.buffered ?? false });
        clearTimeout(previewTimer);
        previewTimer = 0;
        renderPreview();
        stopLoading();
        scanTitle.textContent = '识别完成，等待确认';
        scanHint.textContent = '可以继续查看和旋转预览；确认后再应用到工作区';
        query('#recognition-preview-title').textContent = '识别完成 · 待确认';
        query('#recognition-preview-note').textContent = '数据已通过结构校验。应用后仍可在 2D 中校正尺寸和细节。';
        applyButton.classList.remove('hidden');
        recognizeButton.classList.replace('primary-button', 'ghost-button');
        recognizeButton.textContent = '重新识别';
        log('complete', '结构校验通过，当前方案未修改，等待你确认应用');
      } catch (error) {
        if (closed) return;
        stopLoading();
        const stopped = request.signal.aborted;
        scanTitle.textContent = stopped ? '已停止识别' : '识别未完成';
        scanHint.textContent = partialPlan ? '已保留本次预览，当前方案未修改' : '当前方案未修改，可以换图或重试';
        log(stopped ? 'stopped' : 'failed', stopped ? '你已停止请求' : '请求结束，未自动重新识别');
        errorBox.classList.remove('hidden');
        errorBox.replaceChildren();
        const message = document.createElement('div');
        message.textContent = stopped ? '请求已中止，不会继续等待或自动重试。' : error instanceof Error ? error.message : '识别失败，请重试。';
        errorBox.appendChild(message);
        if (!stopped && error instanceof RecognitionError && error.raw) {
          const details = document.createElement('details');
          details.className = 'raw-output';
          const summary = document.createElement('summary');
          summary.textContent = '查看模型原始输出（仅保存在本页）';
          const pre = document.createElement('pre');
          pre.textContent = error.raw.slice(0, 6000);
          details.append(summary, pre);
          errorBox.appendChild(details);
        }
        if (canUsePartial()) {
          partialButton.classList.remove('hidden');
          query('#recognition-preview-note').textContent = '这是不完整结果。使用后需在 2D 中补齐缺失部分，也可重新识别。';
        }
        recognizeButton.textContent = '重新识别';
      } finally {
        if (controller === request) {
          controller = null;
          modeOptions.disabled = false;
        }
      }
    });
    manualButton.addEventListener('click', () => {
      modal.close();
      this.store.replace(emptyPlan('未命名户型'));
      this.currentProjectId = null;
      this.setPlanSourceLabel('空白户型');
      this.setViewMode('2d');
      this.setTool('wall');
      this.toast('已创建空白户型，拖拽即可画墙', 'info', { label: '撤销', action: () => this.restorePreviousPlan() });
    });
    this.uploadModal = { ...modal, setFile };
    if (file) void setFile(file);
  }

  private showReplay() {
    if (this.activeModal?.element.querySelector('#replay-visual')) return;
    const demoId = this.query<HTMLSelectElement>('#demo-select').value;
    const entry = DEMO_PLANS.find((demo) => demo.id === demoId) ?? DEMO_PLANS[1];
    const plan = getDemoPlan(entry.id);
    const reviewCount = plan.rooms.filter((room) => room.confidence < 0.75).length;
    const frames = [
      { title: '上传示例图纸', detail: `${entry.title}的内置示意图。演示不上传图片、不调用模型，也不会改动当前方案。` },
      { title: '提取墙体、门窗与房间', detail: `${plan.walls.length} 面墙 · ${plan.openings.length} 处门窗 · ${plan.rooms.length} 个房间。去除家具干扰，用颜色分离房间与墙体。` },
      { title: '标注尺寸与置信度', detail: `约 ${planArea(plan).toFixed(0)}㎡ · ${reviewCount} 个房间建议检查。尺寸与置信度均来自示例预设，并非本次 AI 测量。` },
      { title: '生成 3D 沙盘与家具', detail: `${plan.furniture.length} 件示例家具已就位。拖拽旋转、滚轮缩放；确认后再应用到工作区。` },
    ];
    const images = (['drawing', 'structure', 'analysis', 'full'] as const).map((mode) => planToDataUrl(plan, 800, mode));
    let timer = 0;
    let closed = false;
    let previewScene: FloorScene | null = null;
    let previewUnavailable = false;
    const modal = openModal('模拟识别演示', `
      <p class="modal-note">内置示例回放 · 非真实 AI 识别 · 无需 API Key。左侧画面随步骤变化，也可点选右侧步骤回看。</p>
      <div class="replay-layout">
        <figure class="replay-preview">
          <div id="replay-visual" data-stage="0">
            <img id="replay-plan" class="replay-plan" src="${images[0]}" alt="${escapeHtml(entry.title)}示例图纸" />
            <div id="replay-scene" class="hidden" aria-label="示例户型 3D 沙盘"></div>
          </div>
          <figcaption aria-live="polite"><strong id="replay-caption"></strong><span id="replay-detail"></span></figcaption>
        </figure>
        <ol class="replay-steps" aria-label="演示步骤">
          ${frames.map((frame, index) => `<li><button type="button" data-replay-step="${index}"><span class="replay-step-number" aria-hidden="true">0${index + 1}</span><span>${frame.title}</span></button></li>`).join('')}
        </ol>
      </div>
      <div class="modal-actions replay-actions">
        <button id="replay-skip" class="ghost-button" type="button">跳过动画</button>
        <button id="replay-run" class="primary-button" type="button">开始演示</button>
        <button id="replay-apply" class="primary-button hidden" type="button">应用到工作区</button>
      </div>
    `, { wide: true, onClose: () => {
      closed = true;
      clearTimeout(timer);
      previewScene?.dispose();
      if (this.activeModal === modal) this.activeModal = null;
    } });
    modal.element.querySelector('.modal')!.classList.add('replay-modal');
    this.activeModal = modal;
    const query = <T extends HTMLElement = HTMLElement>(selector: string) => modal.element.querySelector<T>(selector)!;
    const steps = modal.element.querySelectorAll<HTMLButtonElement>('[data-replay-step]');
    const visual = query('#replay-visual');
    const image = query<HTMLImageElement>('#replay-plan');
    const sceneContainer = query('#replay-scene');
    const runButton = query<HTMLButtonElement>('#replay-run');
    const skipButton = query<HTMLButtonElement>('#replay-skip');
    const applyButton = query<HTMLButtonElement>('#replay-apply');
    const stop = () => {
      clearTimeout(timer);
      runButton.disabled = false;
      runButton.textContent = '重新播放';
    };
    const showFrame = (index: number) => {
      if (closed) return;
      visual.dataset.stage = String(index);
      steps.forEach((button, step) => {
        button.parentElement!.classList.toggle('active', step === index);
        button.parentElement!.classList.toggle('done', step < index);
        if (step === index) button.setAttribute('aria-current', 'step');
        else button.removeAttribute('aria-current');
      });
      query('#replay-caption').textContent = `0${index + 1} / 04 · ${frames[index].title}`;
      query('#replay-detail').textContent = frames[index].detail;
      image.src = images[index];
      image.alt = `${entry.title} · ${frames[index].title}`;
      image.classList.toggle('hidden', index === 3);
      sceneContainer.classList.toggle('hidden', index !== 3);
      if (index === 3) {
        if (!previewScene && !previewUnavailable) {
          try {
            previewScene = new FloorScene(sceneContainer, new PlanStore(plan), {
              onSelectFurniture: () => {}, onSelectRoom: () => {}, onFurnitureTransform: () => {},
              onFurnitureDragStart: () => {}, onFurnitureDragEnd: () => {}, onPlace: () => {}, onFeedback: () => {},
            }, true);
            previewScene.updateSettings({ ...DEFAULT_SCENE_SETTINGS, autoRotate: false, showLabels: false, showGrid: false, quality: 'balanced' });
          } catch {
            previewUnavailable = true;
            sceneContainer.replaceChildren();
          }
        }
        if (previewUnavailable) {
          image.classList.remove('hidden');
          sceneContainer.classList.add('hidden');
          query('#replay-detail').textContent = '当前设备无法创建额外 3D 预览，改为显示家具平面图；仍可应用示例到工作区。';
        }
      }
      applyButton.classList.toggle('hidden', index !== 3);
      skipButton.classList.toggle('hidden', index === 3);
      runButton.classList.toggle('primary-button', index !== 3);
      runButton.classList.toggle('ghost-button', index === 3);
    };
    steps.forEach((button, index) => button.addEventListener('click', () => {
      stop();
      showFrame(index);
    }));
    skipButton.addEventListener('click', () => { stop(); showFrame(3); });
    runButton.addEventListener('click', () => {
      if (runButton.disabled) return;
      stop();
      runButton.disabled = true;
      runButton.textContent = '播放中…';
      const advance = (index: number) => {
        if (closed) return;
        showFrame(index);
        if (index < frames.length - 1) timer = window.setTimeout(() => advance(index + 1), 1800);
        else stop();
      };
      advance(0);
    });
    applyButton.addEventListener('click', () => {
      this.store.replace(getDemoPlan(entry.id));
      this.currentProjectId = null;
      this.setPlanSourceLabel(null);
      this.query<HTMLSelectElement>('#demo-select').value = entry.id;
      modal.close();
      this.setViewMode('3d');
      this.scene.resetCamera();
      this.toast('示例已应用，可自由旋转与摆放家具', 'success');
    });
    showFrame(0);
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
          <li>模型：${FURNITURE_CATALOG.length} 件原创程序化家具，无外部 GLTF 素材</li>
        </ul>
        <p class="built-with">Built with Qoder</p>
      </div>
    `);
    this.activeModal = modal;
  }

  private showOnboarding() {
    const modal = openModal('把户型，摆成立体的家', `
      <p class="onboarding-lead">无需注册。先从示例开始，或上传自己的户型图。</p>
      <div class="onboarding-steps">
        <article><span>01</span><strong>转一转</strong><p>拖拽旋转沙盘，滚轮缩放，直观看看每个房间。</p></article>
        <article><span>02</span><strong>摆一摆</strong><p>从家具库选择家具，点击地面放置，再移动、旋转或换色。</p></article>
        <article><span>03</span><strong>换成自己的家</strong><p>上传图纸并使用自己的模型接口识别，也可以直接手动绘制。</p></article>
      </div>
      <div class="onboarding-footer"><span>图纸与配置仅由你的浏览器和自配接口处理</span><button id="onboard-start" class="primary-button" type="button">开始体验</button></div>
    `, { wide: true, onClose: () => markOnboarded() });
    this.activeModal = modal;
    modal.element.querySelector('#onboard-start')!.addEventListener('click', modal.close);
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
