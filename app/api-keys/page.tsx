import { AppNav } from "@/components/app-nav";
import { AppFooter } from "@/components/app-footer";
import { ApiKeysManager } from "@/components/api-keys-manager";
import { listApiKeys } from "@/lib/api-keys";
import { requireUser } from "@/lib/auth";
import { getUiThemePreference } from "@/lib/ui-theme";

export const dynamic = "force-dynamic";

/** 每用户自助 API Key 管理页(member 看自己的,admin 看全部)。 */
export default async function ApiKeysPage() {
  const user = await requireUser();
  const [themePreference, keys] = await Promise.all([getUiThemePreference(), listApiKeys(user)]);

  return (
    <div className="shell" data-theme={themePreference.theme}>
      <AppNav user={user} themeMode={themePreference.mode} />
      <main className="main">
        <ApiKeysManager initialKeys={keys} isAdmin={user.role === "admin"} />
      </main>
      <AppFooter />
    </div>
  );
}
