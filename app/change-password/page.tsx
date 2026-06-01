import { redirect } from "next/navigation";
import { LogOut } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { getUiThemePreference } from "@/lib/ui-theme";
import { ChangePasswordForm } from "@/components/change-password-form";

export const dynamic = "force-dynamic";

export default async function ChangePasswordPage() {
  const [user, themePreference] = await Promise.all([getCurrentUser(), getUiThemePreference()]);
  if (!user) redirect("/login");
  // 仅服务强制改密流程：已无需改密的用户不应停留在此页。
  if (!user.must_change_password) redirect("/");

  return (
    <main className="login-wrap" data-theme={themePreference.theme}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, width: "min(420px, 100%)" }}>
        <ChangePasswordForm username={user.username} />
        <form action="/api/auth/logout" method="post" style={{ display: "flex", justifyContent: "center" }}>
          <button className="ghost-button" type="submit">
            <LogOut size={15} />
            退出登录
          </button>
        </form>
      </div>
    </main>
  );
}
