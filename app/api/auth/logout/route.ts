import { clearSessionCookie } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST() {
  await clearSessionCookie();
  return new Response(null, {
    status: 303,
    headers: {
      location: "/login"
    }
  });
}
