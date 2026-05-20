import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { query } from "./db";
import { cleanupFailedGeneratedImages } from "./generated-image-cleanup";
import { deleteStoredFile, getStorageRoot, readOrCreateThumbnail, thumbnailPathFor } from "./storage";

export type StorageFileEntry = {
  path: string;
  byteSize: number;
};

export type StorageMaintenanceScan = {
  root: string;
  scannedAt: string;
  totalFiles: number;
  totalBytes: number;
  orphanCount: number;
  orphanBytes: number;
  orphanFiles: StorageFileEntry[];
  generatedImages: number;
  referenceImages: number;
  expectedThumbnails: number;
  existingThumbnails: number;
  missingThumbnails: number;
  failedJobs: number;
  failedImages: number;
  failedImageBytes: number;
};

export type StorageMaintenanceResult = {
  ok: boolean;
  deletedFiles?: number;
  deletedBytes?: number;
  deletedImages?: number;
  rebuilt?: number;
  failed?: number;
  fileErrors?: number;
  errors?: string[];
  scan?: StorageMaintenanceScan;
};

type DbImagePath = {
  local_path: string;
  byte_size: number;
};

type LocalFile = StorageFileEntry & {
  fullPath: string;
};

const MAINTAINED_DIRS = ["images", "references", "thumbnails"];
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);

function normalizeRelativePath(fullPath: string, root: string) {
  return path.relative(root, fullPath).replaceAll("\\", "/");
}

async function walkFiles(root: string, relativeDir: string): Promise<LocalFile[]> {
  const fullDir = path.join(root, relativeDir);

  let entries;
  try {
    entries = await readdir(fullDir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }

  const files: LocalFile[] = [];
  for (const entry of entries) {
    const fullPath = path.join(fullDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walkFiles(root, normalizeRelativePath(fullPath, root)));
    } else if (entry.isFile()) {
      const relativePath = normalizeRelativePath(fullPath, root);
      const ext = path.extname(relativePath).toLowerCase();
      if (!IMAGE_EXTENSIONS.has(ext)) continue;
      const info = await stat(fullPath);
      files.push({
        path: relativePath,
        fullPath,
        byteSize: info.size
      });
    }
  }

  return files;
}

async function listMaintainedFiles() {
  const root = getStorageRoot();
  const nested = await Promise.all(MAINTAINED_DIRS.map((dir) => walkFiles(root, dir)));
  return {
    root,
    files: nested.flat()
  };
}

async function loadStorageDbState() {
  const [generated, references, failedJobs, failedImages] = await Promise.all([
    query<DbImagePath>(`select local_path, byte_size from generated_images`),
    query<DbImagePath>(`select local_path, byte_size from reference_images`),
    query<{ count: string }>(`select count(*)::text as count from generation_jobs where status = 'failed'`),
    query<{ count: string; bytes: string }>(
      `select count(i.id)::text as count, coalesce(sum(i.byte_size), 0)::text as bytes
       from generated_images i
       join generation_jobs j on j.id = i.job_id
       where j.status = 'failed'`
    )
  ]);

  return {
    generated: generated.rows,
    references: references.rows,
    failedJobs: Number(failedJobs.rows[0]?.count ?? 0),
    failedImages: Number(failedImages.rows[0]?.count ?? 0),
    failedImageBytes: Number(failedImages.rows[0]?.bytes ?? 0)
  };
}

export async function scanStorageMaintenance(): Promise<StorageMaintenanceScan> {
  const [{ root, files }, dbState] = await Promise.all([
    listMaintainedFiles(),
    loadStorageDbState()
  ]);

  const expected = new Set<string>();
  for (const image of dbState.generated) {
    expected.add(image.local_path);
    expected.add(thumbnailPathFor(image.local_path));
  }
  for (const reference of dbState.references) {
    expected.add(reference.local_path);
    expected.add(thumbnailPathFor(reference.local_path));
  }

  const existingThumbnailSet = new Set(
    files
      .filter((file) => file.path.startsWith("thumbnails/"))
      .map((file) => file.path)
  );
  const thumbnailSourcePaths = new Set([...dbState.generated, ...dbState.references].map((image) => image.local_path));
  const missingThumbnails = [...thumbnailSourcePaths].filter((localPath) => !existingThumbnailSet.has(thumbnailPathFor(localPath))).length;
  const orphanFiles = files
    .filter((file) => !expected.has(file.path))
    .map(({ path: relativePath, byteSize }) => ({ path: relativePath, byteSize }));

  return {
    root,
    scannedAt: new Date().toISOString(),
    totalFiles: files.length,
    totalBytes: files.reduce((sum, file) => sum + file.byteSize, 0),
    orphanCount: orphanFiles.length,
    orphanBytes: orphanFiles.reduce((sum, file) => sum + file.byteSize, 0),
    orphanFiles: orphanFiles.slice(0, 50),
    generatedImages: dbState.generated.length,
    referenceImages: dbState.references.length,
    expectedThumbnails: thumbnailSourcePaths.size,
    existingThumbnails: existingThumbnailSet.size,
    missingThumbnails,
    failedJobs: dbState.failedJobs,
    failedImages: dbState.failedImages,
    failedImageBytes: dbState.failedImageBytes
  };
}

async function listAllOrphanFiles() {
  const [{ files }, dbState] = await Promise.all([
    listMaintainedFiles(),
    loadStorageDbState()
  ]);

  const expected = new Set<string>();
  for (const image of dbState.generated) {
    expected.add(image.local_path);
    expected.add(thumbnailPathFor(image.local_path));
  }
  for (const reference of dbState.references) {
    expected.add(reference.local_path);
    expected.add(thumbnailPathFor(reference.local_path));
  }

  return files
    .filter((file) => !expected.has(file.path))
    .map(({ path: relativePath, byteSize }) => ({ path: relativePath, byteSize }));
}

export async function cleanupOrphanFiles(): Promise<StorageMaintenanceResult> {
  const files = await listAllOrphanFiles();
  let deletedFiles = 0;
  let deletedBytes = 0;
  let fileErrors = 0;
  const errors: string[] = [];

  for (const file of files) {
    try {
      await deleteStoredFile(file.path);
      deletedFiles += 1;
      deletedBytes += file.byteSize;
    } catch (error) {
      fileErrors += 1;
      errors.push(`${file.path}: ${error instanceof Error ? error.message : "删除失败"}`);
    }
  }

  return {
    ok: fileErrors === 0,
    deletedFiles,
    deletedBytes,
    fileErrors,
    errors: errors.slice(0, 10),
    scan: await scanStorageMaintenance()
  };
}

export async function rebuildAllThumbnails(): Promise<StorageMaintenanceResult> {
  const images = await query<Pick<DbImagePath, "local_path">>(
    `select local_path from generated_images
     union
     select local_path from reference_images
     order by local_path asc`
  );
  let rebuilt = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const image of images.rows) {
    try {
      await deleteStoredFile(thumbnailPathFor(image.local_path));
      await readOrCreateThumbnail(image.local_path);
      rebuilt += 1;
    } catch (error) {
      failed += 1;
      errors.push(`${image.local_path}: ${error instanceof Error ? error.message : "缩略图生成失败"}`);
    }
  }

  return {
    ok: failed === 0,
    rebuilt,
    failed,
    errors: errors.slice(0, 10),
    scan: await scanStorageMaintenance()
  };
}

export async function cleanupFailedTaskImages(): Promise<StorageMaintenanceResult> {
  const cleanup = await cleanupFailedGeneratedImages();

  return {
    ok: cleanup.fileErrors === 0,
    deletedImages: cleanup.deletedImages,
    deletedFiles: cleanup.deletedFiles,
    deletedBytes: cleanup.deletedBytes,
    fileErrors: cleanup.fileErrors,
    errors: cleanup.errors,
    scan: await scanStorageMaintenance()
  };
}
