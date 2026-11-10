export const MAX_BATCH_IMAGE_SIZE = 100 * 1024 * 1024;
export const MAX_BATCH_IMAGE_COUNT = 500;

export interface ImageImportEntry {
  file: File;
  relativePath: string;
}

/** Natural filename ordering keeps frame-2 before frame-10. */
export function naturalSortImages<T extends ImageImportEntry>(entries: T[]): T[] {
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
  return [...entries].sort((a, b) =>
    collator.compare(a.relativePath || a.file.name, b.relativePath || b.file.name));
}

export function validateImageBatch(files: FileList | File[]): { accepted: ImageImportEntry[]; rejected: string[] } {
  const accepted: ImageImportEntry[] = [];
  const rejected: string[] = [];
  const seen = new Set<string>();
  for (const file of Array.from(files)) {
    const path = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
    const key = `${path.toLocaleLowerCase()}::${file.size}::${file.lastModified}`;
    if (!file.type.startsWith("image/")) { rejected.push(`${path}: not an image`); continue; }
    if (file.size <= 0 || file.size > MAX_BATCH_IMAGE_SIZE) { rejected.push(`${path}: empty or larger than 100 MB`); continue; }
    if (seen.has(key)) { rejected.push(`${path}: duplicate file`); continue; }
    seen.add(key);
    accepted.push({ file, relativePath: path });
  }
  if (accepted.length > MAX_BATCH_IMAGE_COUNT) {
    rejected.push(`Only the first ${MAX_BATCH_IMAGE_COUNT} images can be imported at once.`);
    accepted.length = MAX_BATCH_IMAGE_COUNT;
  }
  return { accepted: naturalSortImages(accepted), rejected };
}
