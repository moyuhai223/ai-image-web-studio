import { randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { cp, mkdir, readdir, readFile, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { once } from "node:events";
import { pipeline } from "node:stream/promises";
import { createGunzip, createGzip } from "node:zlib";
import type { PoolClient } from "pg";
import { query, transaction } from "./db";
import { createLogger } from "./logger";
import { getStorageRoot } from "./storage";
import { APP_VERSION } from "./version";

const log = createLogger("data-backup");

type BackupTable = {
  name: string;
  orderBy: string;
};

type LocalBackupFile = {
  archivePath: string;
  fullPath: string;
  byteSize: number;
  mtime: Date;
};

export type DataBackupItem = {
  filename: string;
  byteSize: number;
  createdAt: string;
  modifiedAt: string;
};

export type CreatedDataBackup = DataBackupItem & {
  tableCounts: Record<string, number>;
  fileCount: number;
  fileBytes: number;
};

export type DataRestoreResult = {
  restoredFrom: string;
  safetyBackup: DataBackupItem;
  tableCounts: Record<string, number>;
  fileCount: number;
  fileBytes: number;
};

export type DataBackupValidationResult = {
  filename: string;
  ok: true;
  appVersion: string | null;
  createdAt: string | null;
  tableCounts: Record<string, number>;
  fileCount: number;
  fileBytes: number;
  manifestFileCount: number | null;
  manifestFileBytes: number | null;
  warnings: string[];
};

type BackupManifest = {
  app?: string;
  appVersion?: string;
  createdAt?: string;
  database?: {
    tables?: Record<string, number>;
  };
  storage?: {
    fileCount?: number;
    byteSize?: number;
  };
};

type ParsedBackupArchive = {
  manifest: BackupManifest;
  tables: Map<string, unknown[]>;
  stagingRoot: string;
  fileCount: number;
  fileBytes: number;
};

type ReadArchiveOptions = {
  extractStorage?: boolean;
};

const BACKUP_DIR = "backups";
const BACKUP_FILENAME_RE = /^ai-image-web-studio-backup-\d{8}-\d{6}-[a-f0-9]{8}\.tar\.gz$/;
const TAR_BLOCK_SIZE = 512;
const BACKUP_TABLES: BackupTable[] = [
  { name: "users", orderBy: "created_at asc, id asc" },
  { name: "login_attempts", orderBy: "created_at asc, id asc" },
  { name: "audit_logs", orderBy: "created_at asc, id asc" },
  { name: "generation_jobs", orderBy: "created_at asc, id asc" },
  { name: "generated_images", orderBy: "created_at asc, sort_order asc, id asc" },
  { name: "generated_image_tags", orderBy: "created_at asc, id asc" },
  { name: "generated_image_favorites", orderBy: "created_at asc, user_id asc, image_id asc" },
  { name: "reference_images", orderBy: "created_at asc, id asc" },
  { name: "prompt_templates", orderBy: "created_at asc, id asc" },
  { name: "app_settings", orderBy: "key asc" }
];
const BACKUP_STORAGE_DIRS = ["images", "references", "thumbnails"];
const RESTORE_TABLE_ORDER = [
  "users",
  "login_attempts",
  "audit_logs",
  "app_settings",
  "prompt_templates",
  "reference_images",
  "generation_jobs",
  "generated_images",
  "generated_image_tags",
  "generated_image_favorites"
];
const TRUNCATE_TABLES = [
  "generated_image_favorites",
  "generated_image_tags",
  "generated_images",
  "generation_jobs",
  "reference_images",
  "prompt_templates",
  "app_settings",
  "audit_logs",
  "login_attempts",
  "users"
];

function formatTimestamp(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  const second = String(date.getSeconds()).padStart(2, "0");
  return `${year}${month}${day}-${hour}${minute}${second}`;
}

function backupRoot() {
  return path.join(getStorageRoot(), BACKUP_DIR);
}

async function ensureBackupRoot() {
  const root = backupRoot();
  await mkdir(root, { recursive: true });
  return root;
}

function assertInside(parent: string, child: string) {
  const resolvedParent = path.resolve(parent);
  const resolvedChild = path.resolve(child);
  if (!resolvedChild.startsWith(resolvedParent + path.sep) && resolvedChild !== resolvedParent) {
    throw new Error("路径越界，已拒绝操作");
  }
}

function assertBackupFilename(filename: string) {
  if (!BACKUP_FILENAME_RE.test(filename)) {
    throw new Error("备份文件名无效");
  }
}

function resolveBackupPath(filename: string) {
  assertBackupFilename(filename);
  const root = backupRoot();
  const fullPath = path.resolve(root, filename);
  if (!fullPath.startsWith(root + path.sep)) {
    throw new Error("备份路径无效");
  }
  return fullPath;
}

function normalizeArchivePath(value: string) {
  return value.replaceAll("\\", "/").replace(/^\/+/, "");
}

function isSafeArchivePath(value: string) {
  const normalized = normalizeArchivePath(value);
  return Boolean(normalized) && !normalized.startsWith("../") && !normalized.includes("/../") && normalized !== "..";
}

async function walkStorageFiles(storageRoot: string, relativeDir: string): Promise<LocalBackupFile[]> {
  const fullDir = path.join(storageRoot, relativeDir);
  let entries;
  try {
    entries = await readdir(fullDir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }

  const files: LocalBackupFile[] = [];
  for (const entry of entries) {
    const fullPath = path.join(fullDir, entry.name);
    const relativePath = normalizeArchivePath(path.relative(storageRoot, fullPath));
    if (entry.isDirectory()) {
      files.push(...await walkStorageFiles(storageRoot, relativePath));
      continue;
    }
    if (!entry.isFile()) continue;
    const info = await stat(fullPath);
    files.push({
      archivePath: normalizeArchivePath(path.join("storage", relativePath)),
      fullPath,
      byteSize: info.size,
      mtime: info.mtime
    });
  }

  return files;
}

async function listStorageFilesForBackup() {
  const storageRoot = getStorageRoot();
  const nested = await Promise.all(BACKUP_STORAGE_DIRS.map((dir) => walkStorageFiles(storageRoot, dir)));
  return nested.flat().sort((a, b) => a.archivePath.localeCompare(b.archivePath));
}

async function exportDatabaseTables() {
  const tables: { name: string; rows: unknown[] }[] = [];
  for (const table of BACKUP_TABLES) {
    const result = await query<Record<string, unknown>>(`select * from ${table.name} order by ${table.orderBy}`);
    tables.push({ name: table.name, rows: result.rows });
  }
  return tables;
}

function writeString(buffer: Buffer, offset: number, length: number, value: string) {
  const bytes = Buffer.from(value, "utf8");
  bytes.copy(buffer, offset, 0, Math.min(bytes.length, length));
}

function writeOctal(buffer: Buffer, offset: number, length: number, value: number) {
  const octal = Math.max(0, Math.trunc(value)).toString(8).padStart(length - 1, "0").slice(-(length - 1));
  buffer.write(octal, offset, length - 1, "ascii");
  buffer[offset + length - 1] = 0;
}

function splitTarPath(archivePath: string) {
  const normalized = normalizeArchivePath(archivePath);
  if (Buffer.byteLength(normalized) <= 100) {
    return { name: normalized, prefix: "" };
  }

  const parts = normalized.split("/");
  for (let index = 1; index < parts.length; index += 1) {
    const prefix = parts.slice(0, index).join("/");
    const name = parts.slice(index).join("/");
    if (Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(name) <= 100) {
      return { name, prefix };
    }
  }

  throw new Error(`备份文件路径过长：${archivePath}`);
}

function tarHeader(input: { archivePath: string; size: number; mtime: Date; mode?: number }) {
  const header = Buffer.alloc(TAR_BLOCK_SIZE, 0);
  const { name, prefix } = splitTarPath(input.archivePath);
  writeString(header, 0, 100, name);
  writeOctal(header, 100, 8, input.mode ?? 0o644);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, input.size);
  writeOctal(header, 136, 12, Math.floor(input.mtime.getTime() / 1000));
  header.fill(0x20, 148, 156);
  header[156] = "0".charCodeAt(0);
  writeString(header, 257, 6, "ustar");
  writeString(header, 263, 2, "00");
  writeString(header, 265, 32, "ai-image-web-studio");
  writeString(header, 297, 32, "ai-image-web-studio");
  if (prefix) writeString(header, 345, 155, prefix);

  let checksum = 0;
  for (const byte of header) checksum += byte;
  const checksumText = checksum.toString(8).padStart(6, "0").slice(-6);
  header.write(checksumText, 148, 6, "ascii");
  header[154] = 0;
  header[155] = 0x20;
  return header;
}

function paddingFor(size: number) {
  const remainder = size % TAR_BLOCK_SIZE;
  return remainder === 0 ? 0 : TAR_BLOCK_SIZE - remainder;
}

function readTarString(buffer: Buffer, offset: number, length: number) {
  const slice = buffer.subarray(offset, offset + length);
  const end = slice.indexOf(0);
  return slice.subarray(0, end === -1 ? slice.length : end).toString("utf8").trim();
}

function readTarOctal(buffer: Buffer, offset: number, length: number) {
  const value = readTarString(buffer, offset, length).replace(/\0/g, "").trim();
  if (!value) return 0;
  const parsed = Number.parseInt(value, 8);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error("备份包 tar 头部大小无效");
  }
  return parsed;
}

function isZeroBlock(buffer: Buffer) {
  return buffer.every((byte) => byte === 0);
}

async function writeArchiveChunk(gzip: ReturnType<typeof createGzip>, chunk: Buffer) {
  if (!gzip.write(chunk)) {
    await once(gzip, "drain");
  }
}

async function addBufferToArchive(gzip: ReturnType<typeof createGzip>, archivePath: string, content: Buffer, mtime: Date) {
  await writeArchiveChunk(gzip, tarHeader({ archivePath, size: content.byteLength, mtime }));
  await writeArchiveChunk(gzip, content);
  const padding = paddingFor(content.byteLength);
  if (padding > 0) await writeArchiveChunk(gzip, Buffer.alloc(padding));
}

async function addFileToArchive(gzip: ReturnType<typeof createGzip>, file: LocalBackupFile) {
  await writeArchiveChunk(gzip, tarHeader({ archivePath: file.archivePath, size: file.byteSize, mtime: file.mtime }));
  for await (const chunk of createReadStream(file.fullPath)) {
    await writeArchiveChunk(gzip, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const padding = paddingFor(file.byteSize);
  if (padding > 0) await writeArchiveChunk(gzip, Buffer.alloc(padding));
}

async function readArchiveEntries(
  sourcePath: string,
  stagingRoot: string,
  options: ReadArchiveOptions = {}
): Promise<ParsedBackupArchive> {
  const extractStorage = options.extractStorage ?? true;
  await mkdir(stagingRoot, { recursive: true });
  const input = createReadStream(sourcePath);
  const gunzip = createGunzip();
  input.pipe(gunzip);
  const iterator = gunzip[Symbol.asyncIterator]();
  let pending = Buffer.alloc(0);
  let manifest: BackupManifest | null = null;
  const tables = new Map<string, unknown[]>();
  let fileCount = 0;
  let fileBytes = 0;

  async function readBody(size: number, onChunk?: (chunk: Buffer) => Promise<void> | void, allowEof = false) {
    let remaining = size;
    const chunks: Buffer[] = [];

    while (remaining > 0) {
      if (pending.length === 0) {
        const next = await iterator.next();
        if (next.done) {
          if (allowEof && chunks.length === 0) return null;
          throw new Error("备份包内容不完整");
        }
        pending = Buffer.isBuffer(next.value) ? next.value : Buffer.from(next.value);
      }

      const take = Math.min(remaining, pending.length);
      const chunk = pending.subarray(0, take);
      pending = pending.subarray(take);
      remaining -= take;

      if (onChunk) {
        await onChunk(chunk);
      } else {
        chunks.push(Buffer.from(chunk));
      }
    }

    return onChunk ? Buffer.alloc(0) : Buffer.concat(chunks);
  }

  async function skipBody(size: number) {
    if (size > 0) await readBody(size, () => undefined, false);
  }

  async function readJsonEntry<T>(size: number, label: string) {
    const body = await readBody(size, undefined, false);
    if (!body) throw new Error(`${label} 读取失败`);
    try {
      return JSON.parse(body.toString("utf8")) as T;
    } catch {
      throw new Error(`${label} 不是有效 JSON`);
    }
  }

  async function extractStorageEntry(archivePath: string, size: number) {
    if (!isSafeArchivePath(archivePath)) {
      throw new Error(`备份包包含非法路径：${archivePath}`);
    }
    const normalized = normalizeArchivePath(archivePath);
    const [, topDir] = normalized.split("/");
    if (!BACKUP_STORAGE_DIRS.includes(topDir)) {
      await skipBody(size);
      return;
    }

    if (!extractStorage) {
      await skipBody(size);
      fileCount += 1;
      fileBytes += size;
      return;
    }

    const destination = path.resolve(stagingRoot, normalized);
    assertInside(stagingRoot, destination);
    await mkdir(path.dirname(destination), { recursive: true });
    const output = createWriteStream(destination, { flags: "wx" });
    try {
      await readBody(size, async (chunk) => {
        if (!output.write(chunk)) {
          await once(output, "drain");
        }
      });
      output.end();
      await once(output, "finish");
      fileCount += 1;
      fileBytes += size;
    } catch (error) {
      output.destroy();
      throw error;
    }
  }

  while (true) {
    const header = await readBody(TAR_BLOCK_SIZE, undefined, true);
    if (!header) break;
    if (isZeroBlock(header)) break;

    const rawName = readTarString(header, 0, 100);
    const rawPrefix = readTarString(header, 345, 155);
    const archivePath = normalizeArchivePath(rawPrefix ? `${rawPrefix}/${rawName}` : rawName);
    const size = readTarOctal(header, 124, 12);
    const typeFlag = String.fromCharCode(header[156] || 48);

    if (!archivePath) {
      await skipBody(size + paddingFor(size));
      continue;
    }

    if (typeFlag !== "0" && typeFlag !== "\0") {
      await skipBody(size);
      await skipBody(paddingFor(size));
      continue;
    }

    if (archivePath === "manifest.json") {
      manifest = await readJsonEntry<BackupManifest>(size, "manifest.json");
    } else if (archivePath.startsWith("database/") && archivePath.endsWith(".json")) {
      const tableName = path.basename(archivePath, ".json");
      const rows = await readJsonEntry<unknown[]>(size, archivePath);
      if (!Array.isArray(rows)) throw new Error(`${archivePath} 必须是数组`);
      tables.set(tableName, rows);
    } else if (archivePath.startsWith("storage/")) {
      await extractStorageEntry(archivePath, size);
    } else {
      await skipBody(size);
    }

    await skipBody(paddingFor(size));
  }

  if (!manifest) {
    throw new Error("备份包缺少 manifest.json");
  }
  if (manifest.app !== "ai-image-web-studio") {
    throw new Error("备份包不是 AI Image Web Studio 数据备份");
  }

  for (const table of BACKUP_TABLES) {
    if (!tables.has(table.name)) {
      tables.set(table.name, []);
    }
  }

  return {
    manifest,
    tables,
    stagingRoot,
    fileCount,
    fileBytes
  };
}

async function backupItemFromFile(filename: string): Promise<DataBackupItem | null> {
  if (!BACKUP_FILENAME_RE.test(filename)) return null;
  const fullPath = path.join(await ensureBackupRoot(), filename);
  const info = await stat(fullPath).catch(() => null);
  if (!info?.isFile()) return null;
  return {
    filename,
    byteSize: info.size,
    createdAt: info.birthtime.toISOString(),
    modifiedAt: info.mtime.toISOString()
  };
}

export async function listDataBackups(): Promise<DataBackupItem[]> {
  const root = await ensureBackupRoot();
  const entries = await readdir(root, { withFileTypes: true });
  const backups = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && BACKUP_FILENAME_RE.test(entry.name))
      .map((entry) => backupItemFromFile(entry.name))
  );

  return backups
    .filter((item): item is DataBackupItem => Boolean(item))
    .sort((a, b) => Date.parse(b.modifiedAt) - Date.parse(a.modifiedAt));
}

export async function createDataBackup(): Promise<CreatedDataBackup> {
  const createdAt = new Date();
  const filename = `ai-image-web-studio-backup-${formatTimestamp(createdAt)}-${randomUUID().slice(0, 8)}.tar.gz`;
  const root = await ensureBackupRoot();
  const fullPath = path.join(root, filename);
  const [tables, storageFiles, schemaSql] = await Promise.all([
    exportDatabaseTables(),
    listStorageFilesForBackup(),
    readFile(path.join(process.cwd(), "lib", "schema.sql"), "utf8").catch(() => "")
  ]);
  const tableCounts = Object.fromEntries(tables.map((table) => [table.name, table.rows.length]));
  const fileBytes = storageFiles.reduce((sum, file) => sum + file.byteSize, 0);
  const manifest = {
    app: "ai-image-web-studio",
    appVersion: APP_VERSION,
    createdAt: createdAt.toISOString(),
    format: "tar.gz",
    database: {
      tables: tableCounts
    },
    storage: {
      root: getStorageRoot(),
      directories: BACKUP_STORAGE_DIRS,
      fileCount: storageFiles.length,
      byteSize: fileBytes
    }
  };

  const gzip = createGzip({ level: 6 });
  const output = createWriteStream(fullPath, { flags: "wx" });
  const done = pipeline(gzip, output);

  try {
    await addBufferToArchive(gzip, "manifest.json", Buffer.from(JSON.stringify(manifest, null, 2)), createdAt);
    await addBufferToArchive(gzip, "database/schema.sql", Buffer.from(schemaSql), createdAt);
    for (const table of tables) {
      await addBufferToArchive(
        gzip,
        `database/${table.name}.json`,
        Buffer.from(JSON.stringify(table.rows, null, 2)),
        createdAt
      );
    }
    for (const file of storageFiles) {
      await addFileToArchive(gzip, file);
    }
    await writeArchiveChunk(gzip, Buffer.alloc(TAR_BLOCK_SIZE * 2));
    gzip.end();
    await done;
  } catch (error) {
    gzip.destroy(error instanceof Error ? error : new Error("备份失败"));
    output.destroy();
    await unlink(fullPath).catch(() => undefined);
    throw error;
  }

  const item = await backupItemFromFile(filename);
  if (!item) throw new Error("备份已创建，但无法读取备份文件");
  return {
    ...item,
    tableCounts,
    fileCount: storageFiles.length,
    fileBytes
  };
}

export async function deleteDataBackup(filename: string) {
  const fullPath = resolveBackupPath(filename);
  await unlink(fullPath);
}

export async function pruneDataBackups(retainCount: number) {
  const safeRetainCount = Math.max(1, Math.min(100, Math.trunc(retainCount)));
  const backups = await listDataBackups();
  const removable = backups.slice(safeRetainCount);

  for (const backup of removable) {
    await deleteDataBackup(backup.filename).catch(() => undefined);
  }

  return {
    removed: removable.length,
    backups: await listDataBackups()
  };
}

export async function getDataBackupFile(filename: string) {
  const fullPath = resolveBackupPath(filename);
  const info = await stat(fullPath).catch(() => null);
  if (!info?.isFile()) return null;
  return {
    filename,
    fullPath,
    byteSize: info.size,
    modifiedAt: info.mtime
  };
}

function quoteIdentifier(value: string) {
  if (!/^[a-z_][a-z0-9_]*$/i.test(value)) {
    throw new Error(`数据库字段名无效：${value}`);
  }
  return `"${value.replaceAll('"', '""')}"`;
}

function normalizeRows(rows: unknown[], tableName: string) {
  return rows.map((row) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      throw new Error(`${tableName}.json 包含无效行数据`);
    }
    return row as Record<string, unknown>;
  });
}

async function insertRows(client: PoolClient, tableName: string, rows: Record<string, unknown>[]) {
  if (rows.length === 0) return;

  const columns = Object.keys(rows[0]);
  if (columns.length === 0) return;
  const columnSql = columns.map(quoteIdentifier).join(", ");
  const rowsPerBatch = Math.max(1, Math.floor(5000 / columns.length));

  for (let start = 0; start < rows.length; start += rowsPerBatch) {
    const batch = rows.slice(start, start + rowsPerBatch);
    const values: unknown[] = [];
    const placeholders = batch.map((row, rowIndex) => {
      const rowPlaceholders = columns.map((column, columnIndex) => {
        values.push(row[column] ?? null);
        return `$${rowIndex * columns.length + columnIndex + 1}`;
      });
      return `(${rowPlaceholders.join(", ")})`;
    });

    await client.query(
      `insert into ${quoteIdentifier(tableName)} (${columnSql})
       values ${placeholders.join(", ")}`,
      values
    );
  }
}

async function insertGeneratedImages(client: PoolClient, rows: Record<string, unknown>[]) {
  if (rows.length === 0) return;
  const insertRowsWithoutParents = rows.map((row) => ({ ...row, parent_image_id: null }));
  await insertRows(client, "generated_images", insertRowsWithoutParents);

  for (const row of rows) {
    if (typeof row.id === "string" && typeof row.parent_image_id === "string") {
      await client.query(`update generated_images set parent_image_id = $2 where id = $1`, [row.id, row.parent_image_id]);
    }
  }
}

async function restoreDatabase(parsed: ParsedBackupArchive) {
  const tableCounts: Record<string, number> = {};
  await transaction(async (client) => {
    await client.query(`truncate table ${TRUNCATE_TABLES.map(quoteIdentifier).join(", ")} restart identity cascade`);

    for (const tableName of RESTORE_TABLE_ORDER) {
      const rows = normalizeRows(parsed.tables.get(tableName) ?? [], tableName);
      tableCounts[tableName] = rows.length;
      if (tableName === "generated_images") {
        await insertGeneratedImages(client, rows);
      } else {
        await insertRows(client, tableName, rows);
      }
    }
  });

  return tableCounts;
}

async function replaceStorageDirectories(stagingRoot: string) {
  const storageRoot = getStorageRoot();
  await mkdir(storageRoot, { recursive: true });
  const preparedRoot = path.join(storageRoot, `.restore-ready-${randomUUID()}`);
  const oldRoot = path.join(storageRoot, `.restore-old-${randomUUID()}`);
  assertInside(storageRoot, preparedRoot);
  assertInside(storageRoot, oldRoot);
  await mkdir(preparedRoot, { recursive: true });
  await mkdir(oldRoot, { recursive: true });

  const oldTargets: { dir: string; target: string; oldTarget: string; existed: boolean }[] = [];
  const activatedTargets: { target: string }[] = [];
  let keepOldRoot = false;

  try {
    for (const dir of BACKUP_STORAGE_DIRS) {
      const source = path.join(stagingRoot, "storage", dir);
      const prepared = path.join(preparedRoot, dir);
      assertInside(preparedRoot, prepared);
      const sourceInfo = await stat(source).catch(() => null);
      if (sourceInfo?.isDirectory()) {
        await cp(source, prepared, { recursive: true });
      } else {
        await mkdir(prepared, { recursive: true });
      }
    }

    for (const dir of BACKUP_STORAGE_DIRS) {
      const target = path.join(storageRoot, dir);
      const oldTarget = path.join(oldRoot, dir);
      assertInside(storageRoot, target);
      assertInside(oldRoot, oldTarget);
      const targetInfo = await stat(target).catch(() => null);
      if (targetInfo) {
        await rename(target, oldTarget);
        oldTargets.push({ dir, target, oldTarget, existed: true });
      } else {
        oldTargets.push({ dir, target, oldTarget, existed: false });
      }
    }

    try {
      for (const dir of BACKUP_STORAGE_DIRS) {
        const prepared = path.join(preparedRoot, dir);
        const target = path.join(storageRoot, dir);
        assertInside(preparedRoot, prepared);
        assertInside(storageRoot, target);
        await rename(prepared, target);
        activatedTargets.push({ target });
      }
    } catch (error) {
      for (const item of activatedTargets.reverse()) {
        await rm(item.target, { recursive: true, force: true }).catch(() => undefined);
      }
      for (const item of oldTargets.reverse()) {
        await rm(item.target, { recursive: true, force: true }).catch(() => undefined);
        if (item.existed) {
          try {
            await rename(item.oldTarget, item.target);
          } catch (rollbackError) {
            keepOldRoot = true;
            log.error("恢复备份目录失败，旧目录保留", { oldRoot, error: rollbackError });
          }
        }
      }
      if (keepOldRoot) {
        throw new Error(`图片目录切换失败，旧目录回滚不完整，旧目录已保留在 ${oldRoot}`);
      }
      throw error;
    }
  } finally {
    await rm(preparedRoot, { recursive: true, force: true }).catch(() => undefined);
    if (!keepOldRoot) {
      await rm(oldRoot, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

async function assertNoActiveGenerationJobs() {
  const result = await query<{ count: string }>(
    `select count(*)::text as count
     from generation_jobs
     where status in ('queued', 'running')`
  );
  const count = Number(result.rows[0]?.count ?? 0);
  if (count > 0) {
    throw new Error(`当前还有 ${count} 个排队或运行中的任务，请先取消或等待完成后再恢复备份`);
  }
}

function validationFromParsed(filename: string, parsed: ParsedBackupArchive): DataBackupValidationResult {
  const tableCounts = Object.fromEntries(
    BACKUP_TABLES.map((table) => [table.name, parsed.tables.get(table.name)?.length ?? 0])
  );
  const warnings: string[] = [];
  const manifestTables = parsed.manifest.database?.tables ?? {};

  for (const table of BACKUP_TABLES) {
    const expected = manifestTables[table.name];
    if (typeof expected === "number" && expected !== tableCounts[table.name]) {
      warnings.push(`${table.name} 行数与 manifest 不一致：${tableCounts[table.name]} / ${expected}`);
    }
  }

  const manifestFileCount = typeof parsed.manifest.storage?.fileCount === "number" ? parsed.manifest.storage.fileCount : null;
  const manifestFileBytes = typeof parsed.manifest.storage?.byteSize === "number" ? parsed.manifest.storage.byteSize : null;
  if (manifestFileCount !== null && manifestFileCount !== parsed.fileCount) {
    warnings.push(`图片文件数量与 manifest 不一致：${parsed.fileCount} / ${manifestFileCount}`);
  }
  if (manifestFileBytes !== null && manifestFileBytes !== parsed.fileBytes) {
    warnings.push(`图片文件体积与 manifest 不一致：${parsed.fileBytes} / ${manifestFileBytes}`);
  }
  if (!parsed.manifest.appVersion) {
    warnings.push("manifest 缺少应用版本号");
  }
  if (!parsed.manifest.createdAt) {
    warnings.push("manifest 缺少创建时间");
  }

  return {
    filename,
    ok: true,
    appVersion: parsed.manifest.appVersion ?? null,
    createdAt: parsed.manifest.createdAt ?? null,
    tableCounts,
    fileCount: parsed.fileCount,
    fileBytes: parsed.fileBytes,
    manifestFileCount,
    manifestFileBytes,
    warnings
  };
}

async function validateBackupPath(sourcePath: string, filename: string): Promise<DataBackupValidationResult> {
  const stagingRoot = path.join(getStorageRoot(), `.validate-${randomUUID()}`);

  try {
    const parsed = await readArchiveEntries(sourcePath, stagingRoot, { extractStorage: false });
    return validationFromParsed(filename, parsed);
  } finally {
    await rm(stagingRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function restoreFromBackupPath(sourcePath: string, restoredFrom: string): Promise<DataRestoreResult> {
  await assertNoActiveGenerationJobs();
  const stagingRoot = path.join(getStorageRoot(), `.restore-${randomUUID()}`);

  try {
    const parsed = await readArchiveEntries(sourcePath, stagingRoot, { extractStorage: true });
    const safetyBackup = await createDataBackup();
    const tableCounts = await restoreDatabase(parsed);
    await replaceStorageDirectories(stagingRoot);

    return {
      restoredFrom,
      safetyBackup,
      tableCounts,
      fileCount: parsed.fileCount,
      fileBytes: parsed.fileBytes
    };
  } finally {
    await rm(stagingRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function restoreDataBackup(filename: string): Promise<DataRestoreResult> {
  const file = await getDataBackupFile(filename);
  if (!file) {
    throw new Error("备份文件不存在");
  }
  return restoreFromBackupPath(file.fullPath, filename);
}

export async function validateDataBackup(filename: string): Promise<DataBackupValidationResult> {
  const file = await getDataBackupFile(filename);
  if (!file) {
    throw new Error("备份文件不存在");
  }
  return validateBackupPath(file.fullPath, filename);
}

export async function validateUploadedDataBackup(file: File) {
  const filename = await saveUploadedDataBackup(file);
  try {
    return {
      filename,
      validation: await validateDataBackup(filename)
    };
  } catch (error) {
    await deleteDataBackup(filename).catch(() => undefined);
    throw error;
  }
}


export async function saveUploadedDataBackup(file: File) {
  if (!file.name.toLowerCase().endsWith(".tar.gz")) {
    throw new Error("只支持 .tar.gz 备份包");
  }
  if (file.size <= 0) {
    throw new Error("备份包为空");
  }

  const root = await ensureBackupRoot();
  const filename = `ai-image-web-studio-backup-${formatTimestamp(new Date())}-${randomUUID().slice(0, 8)}.tar.gz`;
  const fullPath = path.join(root, filename);
  await writeFile(fullPath, Buffer.from(await file.arrayBuffer()), { flag: "wx" });
  return filename;
}
