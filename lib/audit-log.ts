import { query } from "./db";
import { createLogger } from "./logger";
import type { User } from "./types";

const log = createLogger("audit-log");

export type AuditLogItem = {
  id: string;
  user_id: string | null;
  username: string;
  action: string;
  target_type: string;
  target_id: string | null;
  detail: Record<string, unknown>;
  ip: string | null;
  created_at: string;
};

type WriteAuditLogInput = {
  user: Pick<User, "id" | "username">;
  request?: Request;
  action: string;
  targetType: string;
  targetId?: string | null;
  detail?: Record<string, unknown>;
};

export type AuditLogFilters = {
  limit?: number;
  username?: string;
  action?: string;
  targetType?: string;
  keyword?: string;
  from?: string;
  to?: string;
};

function requestIp(request: Request | undefined) {
  if (!request) return null;
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip") || null;
}

function safeDetail(detail: Record<string, unknown> | undefined) {
  if (!detail) return {};
  return Object.fromEntries(
    Object.entries(detail).filter(([key]) => !key.toLowerCase().includes("password") && !key.toLowerCase().includes("api_key"))
  );
}

export async function writeAuditLog(input: WriteAuditLogInput) {
  try {
    await query(
      `insert into audit_logs (user_id, username, action, target_type, target_id, detail, ip)
       values ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
      [
        input.user.id,
        input.user.username,
        input.action,
        input.targetType,
        input.targetId ?? null,
        JSON.stringify(safeDetail(input.detail)),
        requestIp(input.request)
      ]
    );
  } catch (error) {
    log.warn("Audit log write failed", { error });
  }
}

function like(value: string) {
  return `%${value.trim()}%`;
}

function endOfDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString();
}

export async function listAuditLogs(filters: AuditLogFilters = {}) {
  const safeLimit = Math.max(1, Math.min(500, Math.trunc(filters.limit ?? 80)));
  const where: string[] = [];
  const values: unknown[] = [];

  function add(value: unknown) {
    values.push(value);
    return `$${values.length}`;
  }

  if (filters.username?.trim()) {
    where.push(`username ilike ${add(like(filters.username))}`);
  }

  if (filters.action?.trim()) {
    where.push(`action ilike ${add(like(filters.action))}`);
  }

  if (filters.targetType?.trim()) {
    where.push(`target_type ilike ${add(like(filters.targetType))}`);
  }

  if (filters.keyword?.trim()) {
    const param = add(like(filters.keyword));
    where.push(`(username ilike ${param} or action ilike ${param} or target_type ilike ${param} or coalesce(target_id, '') ilike ${param} or coalesce(ip, '') ilike ${param} or detail::text ilike ${param})`);
  }

  if (filters.from?.trim()) {
    where.push(`created_at >= ${add(filters.from)}::timestamptz`);
  }

  if (filters.to?.trim()) {
    where.push(`created_at < ${add(endOfDate(filters.to))}::timestamptz`);
  }

  const limitParam = add(safeLimit);
  const result = await query<AuditLogItem>(
    `select id,
            user_id::text,
            username,
            action,
            target_type,
            target_id,
            detail,
            ip,
            created_at::text
     from audit_logs
     ${where.length > 0 ? `where ${where.join(" and ")}` : ""}
     order by created_at desc
     limit ${limitParam}`,
    values
  );
  return result.rows;
}

export async function clearAuditLogs() {
  const result = await query<{ deleted_count: string }>(
    `with deleted as (
       delete from audit_logs
       returning 1
     )
     select count(*)::text as deleted_count from deleted`
  );
  return Number(result.rows[0]?.deleted_count ?? 0);
}
