import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import sharp from "sharp";
import { config } from "./config";
import { assertPublicBaseUrl } from "./egress-guard";
import { THUMBNAIL_MAX_EDGE, THUMBNAIL_STORAGE_VERSION, THUMBNAIL_WEBP_QUALITY } from "./thumbnails";
import { allowedImageTypes } from "./validation";

export type StoredFile = {
  relativePath: string;
  mimeType: string;
  byteSize: number;
  checksum: string;
  width: number | null;
  height: number | null;
};

function storageRoot() {
  return path.resolve(process.cwd(), config.storageRoot);
}

export function getStorageRoot() {
  return storageRoot();
}

export async function checkStorageWritable() {
  const root = storageRoot();
  await mkdir(root, { recursive: true });
  const healthFile = path.join(root, `.health-${randomUUID()}.tmp`);
  await writeFile(healthFile, "ok");
  await unlink(healthFile);
  return root;
}

function datedPath(kind: "images" | "references" | "masks") {
  const now = new Date();
  return path.join(
    kind,
    String(now.getFullYear()),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0")
  );
}

export function resolveStoragePath(relativePath: string) {
  const root = storageRoot();
  const fullPath = path.resolve(root, relativePath);
  if (!fullPath.startsWith(root + path.sep) && fullPath !== root) {
    throw new Error("Invalid storage path");
  }
  return fullPath;
}

export async function readStoredFile(relativePath: string) {
  const fullPath = resolveStoragePath(relativePath);
  const [buffer, stats] = await Promise.all([readFile(fullPath), stat(fullPath)]);
  return { buffer, stats };
}

export async function statStoredFile(relativePath: string) {
  const fullPath = resolveStoragePath(relativePath);
  return stat(fullPath);
}

export function streamStoredFile(relativePath: string, range?: { start: number; end: number }) {
  const fullPath = resolveStoragePath(relativePath);
  return Readable.toWeb(createReadStream(fullPath, range)) as ReadableStream<Uint8Array>;
}

export function thumbnailPathFor(relativePath: string) {
  const parsed = path.parse(relativePath);
  return path.join("thumbnails", parsed.dir, `${parsed.name}-${THUMBNAIL_STORAGE_VERSION}.webp`).replaceAll("\\", "/");
}

export async function readOrCreateThumbnail(relativePath: string) {
  const sourcePath = resolveStoragePath(relativePath);
  const thumbRelativePath = thumbnailPathFor(relativePath);
  const thumbPath = resolveStoragePath(thumbRelativePath);

  try {
    await access(thumbPath);
  } catch {
    await mkdir(path.dirname(thumbPath), { recursive: true });
    await sharp(sourcePath)
      .rotate()
      .resize({ width: THUMBNAIL_MAX_EDGE, height: THUMBNAIL_MAX_EDGE, fit: "inside", withoutEnlargement: true })
      .webp({ quality: THUMBNAIL_WEBP_QUALITY, effort: 4 })
      .toFile(thumbPath);
  }

  const [buffer, stats] = await Promise.all([readFile(thumbPath), stat(thumbPath)]);
  return { buffer, stats, mimeType: "image/webp" };
}

async function unlinkIfExists(relativePath: string) {
  try {
    await unlink(resolveStoragePath(relativePath));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
}

export async function deleteStoredFile(relativePath: string) {
  await unlinkIfExists(relativePath);
}

export async function deleteStoredImageFiles(relativePath: string) {
  await Promise.all([
    unlinkIfExists(relativePath),
    unlinkIfExists(thumbnailPathFor(relativePath))
  ]);
}

function checksum(buffer: Buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function extensionForMime(mimeType: string) {
  return allowedImageTypes.get(mimeType) ?? "png";
}

function safeFilenamePrefix(input: string) {
  const cleaned = input.replace(/[^a-zA-Z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 96);
  return cleaned || randomUUID();
}

async function writeUniqueStorageFile(relativeDir: string, filenamePrefix: string, ext: string, buffer: Buffer) {
  const basePrefix = safeFilenamePrefix(filenamePrefix);

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const suffix = attempt === 0 ? "" : `-${randomUUID().slice(0, 8)}`;
    const relativePath = path.join(relativeDir, `${basePrefix}${suffix}.${ext}`).replaceAll("\\", "/");
    const fullPath = resolveStoragePath(relativePath);
    await mkdir(path.dirname(fullPath), { recursive: true });

    try {
      await writeFile(fullPath, buffer, { flag: "wx" });
      return relativePath;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }
    }
  }

  throw new Error("保存图片失败：无法分配唯一文件名");
}

function pngDimensions(buffer: Buffer) {
  if (buffer.length < 24) return null;
  if (buffer.toString("ascii", 1, 4) !== "PNG") return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function jpegDimensions(buffer: Buffer) {
  let offset = 2;
  while (offset < buffer.length) {
    if (buffer[offset] !== 0xff) return null;
    const marker = buffer[offset + 1];
    const length = buffer.readUInt16BE(offset + 2);
    if (marker >= 0xc0 && marker <= 0xc3) {
      return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
    }
    offset += 2 + length;
  }
  return null;
}

function dimensions(buffer: Buffer, mimeType: string) {
  if (mimeType === "image/png") return pngDimensions(buffer);
  if (mimeType === "image/jpeg") return jpegDimensions(buffer);
  return null;
}

export async function saveImageBuffer(
  buffer: Buffer,
  mimeType: string,
  kind: "images" | "references" | "masks",
  filenamePrefix: string = randomUUID()
): Promise<StoredFile> {
  if (!allowedImageTypes.has(mimeType)) {
    throw new Error(`Unsupported image type: ${mimeType}`);
  }

  const relativeDir = datedPath(kind);
  const ext = extensionForMime(mimeType);
  const relativePath = await writeUniqueStorageFile(relativeDir, filenamePrefix, ext, buffer);

  const size = dimensions(buffer, mimeType);
  return {
    relativePath,
    mimeType,
    byteSize: buffer.byteLength,
    checksum: checksum(buffer),
    width: size?.width ?? null,
    height: size?.height ?? null
  };
}

export async function saveUploadedImage(file: File, userPrefix: string) {
  if (!allowedImageTypes.has(file.type)) {
    throw new Error("只支持 PNG、JPEG 或 WebP 图片");
  }

  const maxBytes = config.maxUploadMb * 1024 * 1024;
  if (file.size > maxBytes) {
    throw new Error(`图片不能超过 ${config.maxUploadMb}MB`);
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  return saveImageBuffer(buffer, file.type, "references", `${userPrefix}-${randomUUID()}`);
}

export async function imageSourceToBuffer(source: { b64?: string; url?: string; mimeType?: string }) {
  if (source.b64) {
    const parsed = parseDataUri(source.b64);
    if (parsed) return parsed;
    return {
      buffer: Buffer.from(source.b64, "base64"),
      mimeType: source.mimeType ?? "image/png"
    };
  }

  if (source.url) {
    // SSRF 守卫:上游返回的图片 URL 也可能指向内网/元数据(半可信上游夹带),下载前先校验。
    await assertPublicBaseUrl(source.url);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.generationTimeoutMs);

    try {
      const response = await fetch(source.url, { signal: controller.signal });
      if (!response.ok) {
        throw new Error(`Failed to download generated image: ${response.status}`);
      }
      const mimeType = response.headers.get("content-type")?.split(";")[0] ?? source.mimeType ?? "image/png";
      return {
        buffer: Buffer.from(await response.arrayBuffer()),
        mimeType
      };
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error(`下载生成图片超过 ${Math.round(config.generationTimeoutMs / 60000)} 分钟未完成`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error("Provider returned an empty image source");
}

export function parseDataUri(input: string) {
  const match = input.match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i);
  if (!match) return null;
  return {
    mimeType: match[1],
    buffer: Buffer.from(match[2], "base64")
  };
}
