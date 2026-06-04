"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Cloud, DatabaseZap, FileClock, FileText, ImageIcon, KeyRound, ShieldCheck, Users } from "lucide-react";

type SettingsTabId = "system" | "keys" | "users" | "templates" | "references" | "maintenance" | "cache" | "audit";

type SettingsTabsProps = Record<SettingsTabId, ReactNode>;

const tabMeta = [
  { id: "system", label: "系统状态", Icon: ShieldCheck },
  { id: "keys", label: "Key 管理", Icon: KeyRound },
  { id: "users", label: "用户管理", Icon: Users },
  { id: "templates", label: "提示词模板", Icon: FileText },
  { id: "references", label: "参考图", Icon: ImageIcon },
  { id: "maintenance", label: "维护操作", Icon: DatabaseZap },
  { id: "cache", label: "缓存", Icon: Cloud },
  { id: "audit", label: "审计日志", Icon: FileClock }
] as const;

function tabFromHash(hash: string): SettingsTabId | null {
  const id = hash.replace(/^#settings-/, "");
  return tabMeta.some((item) => item.id === id) ? (id as SettingsTabId) : null;
}

export function SettingsTabs(props: SettingsTabsProps) {
  const [active, setActive] = useState<SettingsTabId>("system");
  const activeTab = useMemo(() => tabMeta.find((item) => item.id === active) ?? tabMeta[0], [active]);
  const ActiveIcon = activeTab.Icon;

  useEffect(() => {
    const initial = tabFromHash(window.location.hash);
    if (initial) setActive(initial);

    function handleHashChange() {
      const next = tabFromHash(window.location.hash);
      if (next) setActive(next);
    }

    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  function selectTab(id: SettingsTabId) {
    setActive(id);
    window.history.replaceState(null, "", `#settings-${id}`);
  }

  return (
    <div className="settings-layout settings-paged">
      <aside className="settings-nav" aria-label="设置分组">
        {tabMeta.map(({ id, label, Icon }) => (
          <button
            className={id === active ? "active" : ""}
            type="button"
            key={id}
            aria-label={label}
            aria-current={id === active ? "page" : undefined}
            title={label}
            onClick={() => selectTab(id)}
          >
            <Icon size={15} />
            <span>{label}</span>
          </button>
        ))}
      </aside>
      <div className="settings-sections">
        <section className="settings-section settings-tab-panel" id={`settings-${active}`}>
          <div className="settings-tab-heading">
            <ActiveIcon size={17} />
            <h1>{activeTab.label}</h1>
          </div>
          <div className="settings-tab-body">{props[active]}</div>
        </section>
      </div>
    </div>
  );
}
