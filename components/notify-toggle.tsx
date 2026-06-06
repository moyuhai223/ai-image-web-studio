"use client";

import { Bell, BellOff } from "lucide-react";
import { useEffect, useState } from "react";
import { BROWSER_NOTIFY_KEY } from "./job-notification-center";

// 顶栏「完成提醒」开关:开启后,生成任务完成且页面不在前台时,用浏览器系统通知提醒。
// 偏好存 localStorage(BROWSER_NOTIFY_KEY),权限走浏览器 Notification 授权(必须在点击手势里申请)。
export function NotifyToggle() {
  const [supported, setSupported] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission>("default");

  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) {
      setSupported(false);
      return;
    }
    setPermission(Notification.permission);
    try {
      setEnabled(Notification.permission === "granted" && window.localStorage.getItem(BROWSER_NOTIFY_KEY) === "1");
    } catch {
      // localStorage 不可用(隐私模式),保持关闭
    }
  }, []);

  if (!supported) return null;

  async function toggle() {
    if (enabled) {
      try {
        window.localStorage.setItem(BROWSER_NOTIFY_KEY, "0");
      } catch {
        // ignore
      }
      setEnabled(false);
      return;
    }

    let perm = Notification.permission;
    if (perm === "default") {
      try {
        perm = await Notification.requestPermission();
      } catch {
        perm = Notification.permission;
      }
      setPermission(perm);
    }
    if (perm !== "granted") return; // denied:无法开启,按钮转为禁用 + 提示

    try {
      window.localStorage.setItem(BROWSER_NOTIFY_KEY, "1");
    } catch {
      // ignore
    }
    setEnabled(true);
    // 立即弹一条确认:既给即时反馈,也验证浏览器授权确实生效
    try {
      const probe = new Notification("完成提醒已开启 🔔", { body: "生成完成时会这样提醒你" });
      probe.onclick = () => {
        try {
          window.focus();
        } catch {
          // ignore
        }
        probe.close();
      };
    } catch {
      // ignore
    }
  }

  const denied = permission === "denied";
  const label = denied ? "提醒被屏蔽" : enabled ? "提醒开" : "提醒关";
  const title = denied
    ? "浏览器已屏蔽本站通知,请在地址栏站点权限里改为「允许」后再开启"
    : enabled
      ? "生成完成且页面在后台时,会用系统通知提醒。点击关闭"
      : "开启后:生成完成且页面在后台时,用系统通知提醒你";

  return (
    <button
      className="ghost-button notify-toggle"
      type="button"
      onClick={toggle}
      disabled={denied}
      aria-pressed={enabled}
      aria-label={label}
      title={title}
      data-on={enabled ? "true" : undefined}
    >
      {enabled ? <Bell size={16} /> : <BellOff size={16} />}
      <span className="nav-label">{label}</span>
    </button>
  );
}
