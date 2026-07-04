import { clearSessionCookie, getCurrentUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { crossOriginViolation } from "@/lib/request-guard";

export const runtime = "nodejs";

export async function POST(request: Request) {
  // 防跨站强制登出:配置 APP_ORIGIN 后校验来源(sameSite=lax 已是主要防线)。
  if (crossOriginViolation(request)) {
    return new Response(null, { status: 403 });
  }
  // 递增 session_epoch:无状态 token 无法只失效单个,登出即作废该用户所有已签发 token(含泄露的)——
  // 即「登出=登出所有设备」。这样登出才真正能踢掉被盗会话,而非仅删本地 cookie。
  const user = await getCurrentUser();
  if (user) {
    await query(`update users set session_epoch = session_epoch + 1, updated_at = now() where id = $1`, [user.id]);
  }
  await clearSessionCookie();
  return new Response(null, {
    status: 303,
    headers: {
      location: "/login"
    }
  });
}
