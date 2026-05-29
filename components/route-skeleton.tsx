import { getUiThemePreference } from "@/lib/ui-theme";

/**
 * 路由级骨架(v0.7.0)。供各页 `loading.tsx` 用,导航等待 server component
 * 取数时即时显示,替代"旧页冻结"或空白等待。
 *
 * 本项目 `.shell` + 顶栏 + 底部 Tab 栏都写在每个 page 内(无共享 layout),
 * 因此 `loading.tsx` 会替换整页 —— 这里渲染主题正确的壳 + 占位顶栏/底栏 +
 * 骨架网格,且全部复用真实页面的 class,让加载态与就绪态尺寸对齐、不跳动。
 *
 * 约束:骨架要"即时",不能访问 user / DB。主题从 cookie 读
 * (`getUiThemePreference` 只读 cookie、无 DB),避免暗色模式下闪白底。
 */
export async function RouteSkeleton({ cards = 8 }: { cards?: number }) {
  const { theme } = await getUiThemePreference();

  return (
    <div className="shell" data-theme={theme}>
      <header className="topbar" aria-hidden="true">
        <div className="topbar-inner">
          <span className="skeleton-block skeleton-line" style={{ width: 132 }} />
        </div>
      </header>
      <main className="main">
        <section className="panel">
          <div className="panel-header">
            <span className="skeleton-block skeleton-line" style={{ width: 96 }} />
          </div>
          <div className="panel-body">
            <div className="records-grid">
              {Array.from({ length: cards }).map((_, index) => (
                <div className="skeleton-block skeleton-card" key={index} />
              ))}
            </div>
          </div>
        </section>
      </main>
      {/* 占位底部 Tab 栏:桌面 CSS 隐藏,≤680px 显示,避免移动端加载时导航闪没 */}
      <nav className="mobile-tab-bar" aria-hidden="true">
        {Array.from({ length: 4 }).map((_, index) => (
          <span className="mobile-tab" key={index}>
            <span className="skeleton-block" style={{ width: 22, height: 22, borderRadius: 7 }} />
          </span>
        ))}
      </nav>
    </div>
  );
}
