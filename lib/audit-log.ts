import { query } from "./db";
import type { User } from "./types";

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
    console.warn("Audit log write failed:", error);
  }
}

export async function listAuditLogs(limit = 80) {
  const safeLimit = Math.max(1, Math.min(200, Math.trunc(limit)));
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
     order by created_at desc
     limit $1`,
    [safeLimit]
  );
  return result.rows;
}
