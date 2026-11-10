import type { ParsedBlock, ParsedScene } from "./scriptParser";

export type StudioProject = {
  id: string;
  name: string;
  source: string;
  scenes: ParsedScene[];
  createdAt: string;
  updatedAt: string;
  archived?: boolean;
};

export const PROJECT_STORAGE_KEY = "gridsplit.studio.projects.v1";
export const BACKUP_FORMAT = "gridsplit-studio-backup";
export const BACKUP_VERSION = 1;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBlock(value: unknown): value is ParsedBlock {
  if (!isRecord(value)) return false;
  return typeof value.id === "string"
    && ["narration", "dialogue", "sfx", "music"].includes(String(value.kind))
    && typeof value.text === "string"
    && typeof value.sourceLine === "number"
    && (value.speaker === undefined || typeof value.speaker === "string")
    && (value.cue === undefined || typeof value.cue === "string");
}

function isScene(value: unknown): value is ParsedScene {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.title === "string"
    && typeof value.chapter === "string"
    && typeof value.sourceText === "string"
    && Array.isArray(value.blocks)
    && value.blocks.every(isBlock);
}

export function isStudioProject(value: unknown): value is StudioProject {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.name === "string"
    && typeof value.source === "string"
    && typeof value.createdAt === "string"
    && typeof value.updatedAt === "string"
    && (value.archived === undefined || typeof value.archived === "boolean")
    && Array.isArray(value.scenes)
    && value.scenes.every(isScene);
}

export function readStoredProjects(): StudioProject[] {
  try {
    const raw = localStorage.getItem(PROJECT_STORAGE_KEY);
    if (!raw) return [];
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.filter(isStudioProject).map((project) => ({
      ...project,
      archived: project.archived ?? false,
    }));
  } catch {
    return [];
  }
}

export function createProjectBackup(projects: StudioProject[], exportedAt = new Date().toISOString()): string {
  return JSON.stringify({
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt,
    projects,
  }, null, 2);
}

export function parseProjectBackup(contents: string): StudioProject[] {
  let value: unknown;
  try {
    value = JSON.parse(contents);
  } catch {
    throw new Error("This file is not valid JSON.");
  }

  if (!isRecord(value) || value.format !== BACKUP_FORMAT || value.version !== BACKUP_VERSION) {
    throw new Error("This is not a supported GridSplit Studio backup.");
  }
  if (!Array.isArray(value.projects) || !value.projects.every(isStudioProject)) {
    throw new Error("The backup contains invalid or incomplete project data.");
  }
  return value.projects.map((project) => ({
    ...project,
    archived: project.archived ?? false,
  }));
}

export function duplicateProject(
  project: StudioProject,
  makeId: () => string = () => crypto.randomUUID(),
  now = new Date().toISOString(),
  namePrefix = "Copy of ",
): StudioProject {
  return {
    ...project,
    id: makeId(),
    name: `${namePrefix}${project.name}`,
    createdAt: now,
    updatedAt: now,
    archived: false,
    scenes: project.scenes.map((scene) => ({
      ...scene,
      id: makeId(),
      blocks: scene.blocks.map((block) => ({ ...block, id: makeId() })),
    })),
  };
}

function blockSource(block: ParsedBlock): string {
  if (block.kind === "dialogue") return `[CHARACTER: ${block.speaker ?? "UNKNOWN"}] ${block.text}`;
  if (block.kind === "sfx") return `[SFX: ${block.cue ?? "SOUND"}] ${block.text}`.trim();
  if (block.kind === "music") return `[MUSIC: ${block.cue ?? "MUSIC"}] ${block.text}`.trim();
  return block.text;
}

function sceneWithBlocks(scene: ParsedScene, blocks: ParsedBlock[]): ParsedScene {
  return { ...scene, blocks, sourceText: blocks.map(blockSource).filter(Boolean).join("\n\n") };
}

export function moveBlockAcrossScenes(
  scenes: ParsedScene[],
  sceneIndex: number,
  blockIndex: number,
  direction: -1 | 1,
): ParsedScene[] {
  const targetIndex = sceneIndex + direction;
  if (sceneIndex < 0 || sceneIndex >= scenes.length || targetIndex < 0 || targetIndex >= scenes.length) return scenes;
  const source = scenes[sceneIndex];
  const target = scenes[targetIndex];
  if (!source.blocks[blockIndex]) return scenes;
  const block = source.blocks[blockIndex];
  const sourceBlocks = source.blocks.filter((_, index) => index !== blockIndex);
  const targetBlocks = direction === -1
    ? [...target.blocks, block]
    : [block, ...target.blocks];
  return scenes.map((scene, index) => {
    if (index === sceneIndex) return sceneWithBlocks(source, sourceBlocks);
    if (index === targetIndex) return sceneWithBlocks(target, targetBlocks);
    return scene;
  });
}

export function splitSceneAfterBlock(
  scenes: ParsedScene[],
  sceneIndex: number,
  blockIndex: number,
  makeId: () => string = () => crypto.randomUUID(),
): ParsedScene[] {
  const scene = scenes[sceneIndex];
  if (!scene || blockIndex < 0 || blockIndex >= scene.blocks.length - 1) return scenes;
  const first = sceneWithBlocks(scene, scene.blocks.slice(0, blockIndex + 1));
  const continuation: ParsedScene = {
    id: makeId(),
    title: `${scene.title} — continued`,
    chapter: scene.chapter,
    blocks: scene.blocks.slice(blockIndex + 1),
    sourceText: "",
  };
  continuation.sourceText = continuation.blocks.map(blockSource).filter(Boolean).join("\n\n");
  return [...scenes.slice(0, sceneIndex), first, continuation, ...scenes.slice(sceneIndex + 1)];
}

export function mergeSceneWithPrevious(scenes: ParsedScene[], sceneIndex: number): ParsedScene[] {
  if (sceneIndex <= 0 || sceneIndex >= scenes.length) return scenes;
  const previous = scenes[sceneIndex - 1];
  const current = scenes[sceneIndex];
  const merged = sceneWithBlocks(previous, [...previous.blocks, ...current.blocks]);
  return [...scenes.slice(0, sceneIndex - 1), merged, ...scenes.slice(sceneIndex + 1)];
}

export function moveItem<T>(items: T[], index: number, direction: -1 | 1): T[] {
  const target = index + direction;
  if (index < 0 || index >= items.length || target < 0 || target >= items.length) return items;
  const next = [...items];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}
