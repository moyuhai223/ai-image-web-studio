import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { LoginForm } from "@/components/login-form";
import { getUiThemePreference } from "@/lib/ui-theme";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const [user, themePreference] = await Promise.all([getCurrentUser(), getUiThemePreference()]);
  if (user) redirect("/");

  return (
    <main className="login-wrap" data-theme={themePreference.theme}>
      <LoginForm />
    </main>
  );
}
