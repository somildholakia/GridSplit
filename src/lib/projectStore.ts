import type { ParsedBlock, ParsedScene } from "./scriptParser";
import type { StudioAudioSegment, StudioCharacter } from "../audio/types";

export type StudioProject = {
  id: string;
  name: string;
  source: string;
  scenes: ParsedScene[];
  createdAt: string;
  updatedAt: string;
  archived?: boolean;
  characters?: StudioCharacter[];
  audioSegments?: StudioAudioSegment[];
  ttsEndpoint?: string;
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

function isCharacter(value: unknown): value is StudioCharacter {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.name === "string"
    && typeof value.voiceId === "string"
    && typeof value.language === "string"
    && typeof value.speed === "number"
    && Number.isFinite(value.speed)
    && value.speed >= 0.5
    && value.speed <= 2
    && (value.narrator === undefined || typeof value.narrator === "boolean");
}

function isAudioSegment(value: unknown): value is StudioAudioSegment {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.sceneId === "string"
    && typeof value.blockId === "string"
    && typeof value.fingerprint === "string"
    && ["pending", "generating", "ready", "failed"].includes(String(value.status))
    && typeof value.providerId === "string"
    && typeof value.voiceId === "string"
    && typeof value.language === "string"
    && typeof value.speed === "number"
    && typeof value.updatedAt === "string"
    && (value.sampleCount === undefined || (typeof value.sampleCount === "number" && value.sampleCount >= 0))
    && (value.sampleRate === undefined || (typeof value.sampleRate === "number" && value.sampleRate > 0))
    && (value.channels === undefined || (typeof value.channels === "number" && value.channels > 0))
    && (value.durationSeconds === undefined || (typeof value.durationSeconds === "number" && value.durationSeconds >= 0))
    && (value.error === undefined || typeof value.error === "string");
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
    && (value.ttsEndpoint === undefined || typeof value.ttsEndpoint === "string")
    && (value.characters === undefined || (Array.isArray(value.characters) && value.characters.every(isCharacter)))
    && (value.audioSegments === undefined || (Array.isArray(value.audioSegments) && value.audioSegments.every(isAudioSegment)))
    && Array.isArray(value.scenes)
    && value.scenes.every(isScene);
}

export function parseStoredProjects(raw: string | null): StudioProject[] {
  try {
    if (!raw) return [];
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.filter(isStudioProject).map((project) => ({
      ...project,
      archived: project.archived ?? false,
      // A generating state cannot survive a page/process restart. If the last
      // saved audio metadata exists, keep its previous preview playable.
      audioSegments: project.audioSegments?.map((segment) => segment.status === "generating"
        ? { ...segment, status: segment.sampleCount && segment.sampleRate ? "ready" as const : "pending" as const }
        : segment),
    }));
  } catch {
    return [];
  }
}

export function readStoredProjects(): StudioProject[] {
  try {
    return parseStoredProjects(localStorage.getItem(PROJECT_STORAGE_KEY));
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
  const sceneIds = new Map<string, string>();
  const blockIds = new Map<string, string>();
  const scenes = project.scenes.map((scene) => {
    const sceneId = makeId();
    sceneIds.set(scene.id, sceneId);
    const blocks = scene.blocks.map((block) => {
      const id = makeId();
      blockIds.set(block.id, id);
      return { ...block, id };
    });
    return { ...scene, id: sceneId, blocks };
  });
  const audioSegments = project.audioSegments?.flatMap((segment) => {
    const sceneId = sceneIds.get(segment.sceneId);
    const blockId = blockIds.get(segment.blockId);
    if (!sceneId || !blockId) return [];
    return [{
      ...segment,
      id: makeId(),
      sceneId,
      blockId,
      status: "pending" as const,
      sampleCount: undefined,
      sampleRate: undefined,
      channels: undefined,
      durationSeconds: undefined,
      error: undefined,
    }];
  });
  return {
    ...project,
    id: makeId(),
    name: `${namePrefix}${project.name}`,
    createdAt: now,
    updatedAt: now,
    archived: false,
    scenes,
    characters: project.characters?.map((character) => ({ ...character, id: makeId() })),
    audioSegments,
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
