import { clearSessionCookie } from "@/lib/auth";
import { crossOriginViolation } from "@/lib/request-guard";

export const runtime = "nodejs";

export async function POST(request: Request) {
  // 防跨站强制登出:配置 APP_ORIGIN 后校验来源(sameSite=lax 已是主要防线)。
  if (crossOriginViolation(request)) {
    return new Response(null, { status: 403 });
  }
  await clearSessionCookie();
  return new Response(null, {
    status: 303,
    headers: {
      location: "/login"
    }
  });
}
