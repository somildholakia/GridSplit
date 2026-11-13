import type { StudioProject } from "./projectStore";
import { DEFAULT_RENDER_PROFILE } from "../domain/production";
import { exportPortableProject } from "./portableProject";
import { getRenderReadiness, type LocalRenderJob } from "./localRenderer";

const CHUNK_SIZE = 3 * 1024 * 1024;
const MAX_RENDER_OUTPUT = 4 * 1024 * 1024 * 1024;

export type ColabProgress = {
  stage: "uploading" | "rendering" | "downloading";
  progress: number;
  message: string;
  job?: LocalRenderJob;
};

type ColabConnection = { endpoint: string; token: string };

function connection(value: ColabConnection): ColabConnection {
  let url: URL;
  try { url = new URL(value.endpoint.trim()); }
  catch { throw new Error("Enter the HTTPS Cloudflare Quick Tunnel URL printed by the Colab notebook."); }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || !host.endsWith(".trycloudflare.com")
    || host.length <= ".trycloudflare.com".length || url.pathname !== "/"
    || url.search || url.hash || url.username || url.password) {
    throw new Error("The Colab endpoint must be a root HTTPS *.trycloudflare.com URL.");
  }
  const token = value.token.trim();
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(token)) {
    throw new Error("Paste the complete connection token printed by the Colab notebook.");
  }
  return { endpoint: url.origin, token };
}

function proxyUrl(value: ColabConnection, path: string, range?: { offset: number; length: number }): string {
  const params = new URLSearchParams({
    endpoint: value.endpoint,
    path,
  });
  if (range) {
    params.set("offset", String(range.offset));
    params.set("length", String(range.length));
  }
  return "/api/render-proxy?" + params.toString();
}

async function readResponse(response: Response): Promise<Record<string, unknown>> {
  const value: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = value && typeof value === "object" && "error" in value
      ? String((value as { error: unknown }).error)
      : "Colab render request failed (" + response.status + ").";
    throw new Error(message);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The Colab renderer returned an invalid response.");
  }
  return value as Record<string, unknown>;
}

async function jsonRequest(
  value: ColabConnection,
  method: "GET" | "POST" | "DELETE",
  path: string,
  payload?: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const response = await fetch(proxyUrl(value, path), {
    method,
    headers: {
      "X-GridSplit-Token": value.token,
      ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
    },
    body: method === "POST" ? JSON.stringify({ payload: payload ?? {} }) : undefined,
    signal,
    cache: "no-store",
  });
  return readResponse(response);
}

function asJob(input: Record<string, unknown>): LocalRenderJob {
  if (typeof input.id !== "string"
    || !/^[a-f0-9]{32}$/.test(input.id)
    || !["queued", "running", "completed", "failed", "cancelled"].includes(String(input.status))) {
    throw new Error("The Colab renderer returned an invalid render job.");
  }
  const rawOutput = input.output && typeof input.output === "object" && !Array.isArray(input.output)
    ? input.output as Record<string, unknown> : undefined;
  if (rawOutput && (typeof rawOutput.bytes !== "number" || !Number.isSafeInteger(rawOutput.bytes)
    || rawOutput.bytes < 1 || rawOutput.bytes > MAX_RENDER_OUTPUT)) {
    throw new Error("Colab reported an invalid or oversized MP4 output.");
  }
  return {
    id: input.id,
    status: input.status as LocalRenderJob["status"],
    progress: typeof input.progress === "number" ? Math.max(0, Math.min(100, input.progress)) : 0,
    message: typeof input.message === "string" ? input.message : undefined,
    error: typeof input.error === "string" ? input.error : undefined,
    output: rawOutput ? rawOutput as LocalRenderJob["output"] : undefined,
  };
}

export async function checkColabRenderer(endpoint: string, token: string): Promise<string> {
  const value = connection({ endpoint, token });
  const result = await jsonRequest(value, "GET", "/v1/health", undefined, AbortSignal.timeout(20_000));
  if (result.ready !== true) throw new Error("Colab is reachable, but FFmpeg/ffprobe are not ready.");
  const gpu = result.gpuAvailable === true && typeof result.gpuName === "string"
    ? "GPU detected: " + result.gpuName
    : "No NVIDIA GPU detected; this session will use CPU encoding.";
  return "Connected to Colab · " + gpu;
}

export async function renderProjectOnColab(
  project: StudioProject,
  endpoint: string,
  token: string,
  onProgress: (progress: ColabProgress) => void,
  signal?: AbortSignal,
): Promise<{ blob: Blob; job: LocalRenderJob }> {
  const value = connection({ endpoint, token });
  const errors = getRenderReadiness(project).filter((item) => item.severity === "error");
  if (errors.length) throw new Error(errors.map((item) => item.message).join(" "));
  if (signal?.aborted) throw new DOMException("Render cancelled.", "AbortError");

  let uploadId: string | null = null;
  let jobId: string | null = null;
  try {
    // The same renderer verifies NVENC support and probes an actual one-frame
    // encode before selecting h264_nvenc; an unavailable probe selects libx264.
    const gpuProject: StudioProject = {
      ...project,
      renderProfile: { ...(project.renderProfile ?? DEFAULT_RENDER_PROFILE), encoder: "nvidia" },
    };
    const archive = await exportPortableProject(gpuProject);
    if (!archive.size || archive.size > 1024 * 1024 * 1024) {
      throw new Error("The portable project archive must be smaller than 1 GB.");
    }
    const chunkCount = Math.ceil(archive.size / CHUNK_SIZE);
    const session = await jsonRequest(value, "POST", "/v1/uploads", {
      size: archive.size, chunkSize: CHUNK_SIZE, chunkCount, projectId: project.id,
    }, signal);
    if (typeof session.uploadId !== "string" || session.chunkSize !== CHUNK_SIZE) {
      throw new Error("Colab did not create a valid upload session.");
    }
    uploadId = session.uploadId;
    for (let index = 0; index < chunkCount; index += 1) {
      if (signal?.aborted) throw new DOMException("Render cancelled.", "AbortError");
      const start = index * CHUNK_SIZE;
      const chunk = archive.slice(start, Math.min(archive.size, start + CHUNK_SIZE));
      const chunkPath = "/v1/uploads/" + uploadId + "/" + index;
      let uploaded = false;
      let lastError: unknown;
      for (let attempt = 0; attempt < 3 && !uploaded; attempt += 1) {
        if (signal?.aborted) throw new DOMException("Render cancelled.", "AbortError");
        try {
          const response = await fetch(proxyUrl(value, chunkPath), {
            method: "PUT",
            headers: {
              "X-GridSplit-Token": value.token,
              "Content-Type": "application/octet-stream",
            },
            body: chunk,
            signal,
            cache: "no-store",
          });
          await readResponse(response);
          uploaded = true;
        } catch (error) {
          lastError = error;
          if (signal?.aborted) throw new DOMException("Render cancelled.", "AbortError");
          if (attempt < 2) await new Promise((resolve) => window.setTimeout(resolve, 350 * (attempt + 1)));
        }
      }
      if (!uploaded) {
        throw new Error("Could not upload project chunk " + (index + 1) + " of " + chunkCount + ". " +
          (lastError instanceof Error ? lastError.message : "Retry the render after checking the tunnel."));
      }
      const percent = Math.round(((index + 1) / chunkCount) * 100);
      onProgress({
        stage: "uploading",
        progress: percent,
        message: "Uploading project media to Colab · " + percent + "%",
      });
    }

    if (signal?.aborted) throw new DOMException("Render cancelled.", "AbortError");
    const submitted = await jsonRequest(value, "POST", "/v1/uploads/" + uploadId + "/complete", {}, signal);
    const job = asJob(submitted);
    jobId = job.id;
    uploadId = null;
    onProgress({ stage: "rendering", progress: job.progress, message: job.message || "Colab render started.", job });

    let current = job;
    while (current.status === "queued" || current.status === "running") {
      if (signal?.aborted) throw new DOMException("Render cancelled.", "AbortError");
      await new Promise((resolve) => window.setTimeout(resolve, 1200));
      const snapshot = await jsonRequest(value, "GET", "/v1/jobs/" + current.id, undefined, signal);
      current = asJob(snapshot);
      onProgress({
        stage: "rendering",
        progress: current.progress,
        message: current.message || "Rendering on Colab.",
        job: current,
      });
    }
    if (current.status !== "completed" || !current.output?.bytes) {
      throw new Error(current.error || current.message || "The Colab render did not complete.");
    }

    const totalBytes = current.output.bytes;
    const chunks: BlobPart[] = [];
    for (let offset = 0; offset < totalBytes; offset += CHUNK_SIZE) {
      if (signal?.aborted) throw new DOMException("Render cancelled.", "AbortError");
      const length = Math.min(CHUNK_SIZE, totalBytes - offset);
      const response = await fetch(proxyUrl(value, "/v1/jobs/" + current.id + "/output", { offset, length }), {
        method: "GET",
        headers: { "X-GridSplit-Token": value.token },
        signal,
        cache: "no-store",
      });
      if (response.status !== 206) {
        const error = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(error?.error || "Colab did not return the requested MP4 byte range.");
      }
      const chunk = await response.blob();
      if (chunk.size !== length) throw new Error("An MP4 download chunk was incomplete.");
      chunks.push(chunk);
      const percent = Math.round(((offset + length) / totalBytes) * 100);
      onProgress({
        stage: "downloading",
        progress: percent,
        message: "Downloading rendered MP4 from Colab · " + percent + "%",
        job: current,
      });
    }
    const blob = new Blob(chunks, { type: "video/mp4" });
    if (!blob.size) throw new Error("Colab returned an empty MP4.");
    onProgress({ stage: "downloading", progress: 100, message: "MP4 downloaded and ready.", job: current });
    return { blob, job: current };
  } catch (error) {
    if (jobId) {
      void jsonRequest(value, "DELETE", "/v1/jobs/" + jobId).catch(() => undefined);
    } else if (uploadId) {
      void jsonRequest(value, "DELETE", "/v1/uploads/" + uploadId).catch(() => undefined);
    }
    if (signal?.aborted) throw new DOMException("Render cancelled.", "AbortError");
    throw error;
  }
}
