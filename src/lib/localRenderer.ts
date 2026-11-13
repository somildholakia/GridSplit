import type { StudioProject } from "./projectStore";
import type { AudioMixTrack, MixAudioAsset, RenderProfile, VideoClipEdit } from "../domain/production";
import { DEFAULT_RENDER_PROFILE, validateRenderTimeline } from "../domain/production";
import { exportPortableProject } from "./portableProject";

type RenderableProject = StudioProject & {
  audioMixTracks?: AudioMixTrack[];
  mixAssets?: MixAudioAsset[];
  videoClipEdits?: VideoClipEdit[];
  renderProfile?: RenderProfile;
};

export interface LocalRenderJob {
  id: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  progress: number;
  message?: string;
  output?: {
    filename: string;
    bytes: number;
    durationSeconds: number;
    width: number;
    height: number;
    fps: number;
    videoCodec: string;
    audioCodec: string;
    /** Actual encoder reported by the FFmpeg renderer (h264_nvenc or libx264). */
    encoder?: string;
  };
  error?: string;
}

export interface RenderResult {
  blob: Blob;
  job: LocalRenderJob;
}

function localBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Enter a valid local renderer URL, such as http://127.0.0.1:8766.");
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "::1"].includes(host)
    || url.pathname !== "/" || url.username || url.password || url.search || url.hash) {
    throw new Error("GridSplit accepts only an HTTP loopback renderer URL. Remote hosts are blocked.");
  }
  return url.toString().replace(/\/$/, "");
}

async function responseJson(response: Response): Promise<Record<string, unknown>> {
  const value: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = value && typeof value === "object" && "error" in value
      ? String((value as { error: unknown }).error)
      : "Local renderer request failed (" + response.status + ").";
    throw new Error(message);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The local renderer returned an invalid response.");
  }
  return value as Record<string, unknown>;
}

function asJob(value: Record<string, unknown>): LocalRenderJob {
  if (typeof value.id !== "string" || !["queued", "running", "completed", "failed", "cancelled"].includes(String(value.status))) {
    throw new Error("The local renderer returned an invalid job status.");
  }
  return {
    id: value.id,
    status: value.status as LocalRenderJob["status"],
    progress: typeof value.progress === "number" ? Math.max(0, Math.min(100, value.progress)) : 0,
    message: typeof value.message === "string" ? value.message : undefined,
    output: value.output && typeof value.output === "object" ? value.output as LocalRenderJob["output"] : undefined,
    error: typeof value.error === "string" ? value.error : undefined,
  };
}

export function getRenderReadiness(project: RenderableProject) {
  const clips = project.timelineClips ?? [];
  return validateRenderTimeline({
    imageClips: clips.filter((clip) => clip.track === "images"),
    imageAssetIds: (project.imageAssets ?? []).map((asset) => asset.id),
    audioAssetIds: (project.mixAssets ?? []).map((asset) => asset.id),
    mixAssets: project.mixAssets ?? [],
    profile: project.renderProfile ?? DEFAULT_RENDER_PROFILE,
  });
}

/** Upload a complete local archive to the optional 127.0.0.1 FFmpeg sidecar and poll its job. */
export async function renderProjectLocally(
  project: StudioProject,
  endpoint: string,
  onProgress: (job: LocalRenderJob) => void,
  signal?: AbortSignal,
): Promise<RenderResult> {
  const base = localBaseUrl(endpoint);
  const readiness = getRenderReadiness(project as RenderableProject);
  const errors = readiness.filter((item) => item.severity === "error");
  if (errors.length) throw new Error(errors.map((item) => item.message).join(" "));
  if (signal?.aborted) throw new DOMException("Render cancelled.", "AbortError");

  const archive = await exportPortableProject(project);
  const submitted = await responseJson(await fetch(base + "/v1/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/zip", "X-GridSplit-Project": project.id },
    body: archive,
    signal,
  }));
  let job = asJob(submitted);
  const activeJobId = job.id;
  const cancelJob = () => {
    void fetch(base + "/v1/jobs/" + encodeURIComponent(activeJobId), { method: "DELETE" }).catch(() => undefined);
  };
  signal?.addEventListener("abort", cancelJob, { once: true });
  try {
    onProgress(job);
    while (job.status === "queued" || job.status === "running") {
      if (signal?.aborted) throw new DOMException("Render cancelled.", "AbortError");
      await new Promise((resolve) => window.setTimeout(resolve, 900));
      const next = await responseJson(await fetch(base + "/v1/jobs/" + encodeURIComponent(job.id), { signal }));
      job = asJob(next);
      onProgress(job);
    }
    if (job.status !== "completed") throw new Error(job.error || job.message || "The local render did not complete.");
    const output = await fetch(base + "/v1/jobs/" + encodeURIComponent(job.id) + "/output", { signal });
    if (!output.ok) {
      const failure = await responseJson(output);
      throw new Error(String(failure.error ?? "The local renderer did not provide an MP4 file."));
    }
    const blob = await output.blob();
    if (!blob.size || (blob.type && !blob.type.includes("video/mp4"))) {
      throw new Error("The renderer output is empty or is not an MP4 file.");
    }
    return { blob, job };
  } catch (error) {
    if (signal?.aborted) cancelJob();
    throw error;
  } finally {
    signal?.removeEventListener("abort", cancelJob);
  }
}

export function downloadRenderedVideo(blob: Blob, projectName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = projectName.replace(/[^a-zA-Z0-9_-]+/g, "-") + ".mp4";
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
