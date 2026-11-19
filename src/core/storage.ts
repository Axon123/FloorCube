import type { FloorPlan, ModelConfig } from './schema';
import { normalizeFloorPlan } from './schema';

export interface SavedProject {
  id: string;
  name: string;
  updatedAt: number;
  plan: FloorPlan;
}

const KEYS = {
  config: 'floorcube.model-config',
  projects: 'floorcube.projects',
  autosave: 'floorcube.autosave',
  onboarded: 'floorcube.onboarded',
} as const;

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown) {
  localStorage.setItem(key, JSON.stringify(value));
}

export function loadConfig(): ModelConfig | null {
  const config = readJson<ModelConfig>(KEYS.config);
  if (!config || typeof config.baseUrl !== 'string' || typeof config.apiKey !== 'string' || typeof config.model !== 'string') return null;
  if (!config.baseUrl || !config.apiKey || !config.model) return null;
  return config;
}

export function saveConfig(config: ModelConfig) {
  writeJson(KEYS.config, config);
}

export function clearConfig() {
  localStorage.removeItem(KEYS.config);
}

export function loadProjects(): SavedProject[] {
  const projects = readJson<SavedProject[]>(KEYS.projects);
  if (!Array.isArray(projects)) return [];
  return projects.filter((project) => project && typeof project.id === 'string' && typeof project.name === 'string' && project.plan);
}

export function saveProjects(projects: SavedProject[]) {
  writeJson(KEYS.projects, projects);
}

export function upsertProject(project: SavedProject) {
  const projects = loadProjects().filter((item) => item.id !== project.id);
  projects.unshift(project);
  saveProjects(projects.slice(0, 30));
}

export function deleteProject(id: string) {
  saveProjects(loadProjects().filter((item) => item.id !== id));
}

export function loadAutosave(): FloorPlan | null {
  const raw = readJson<unknown>(KEYS.autosave);
  if (!raw) return null;
  try {
    return normalizeFloorPlan(raw);
  } catch {
    return null;
  }
}

export function saveAutosave(plan: FloorPlan) {
  writeJson(KEYS.autosave, plan);
}

export function isOnboarded() {
  return localStorage.getItem(KEYS.onboarded) === '1';
}

export function markOnboarded() {
  localStorage.setItem(KEYS.onboarded, '1');
}
