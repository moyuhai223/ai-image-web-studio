"use client";

import { RefreshCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ButtonSpinner } from "./button-spinner";

/**
 * 任务详情头部「重做」按钮。
 *
 * 之前用 `<a class="status action-button action-rerun">` 直接跳转,
 * 视觉上与隔壁的 `<button>` 类(重试/删除)在浏览器默认基线、focus 行为
 * 上不完全对齐。统一改为真正的 `<button>` + `router.push`,classNames
 * 与 JobControlButton 保持完全一致,确保标签按钮风格统一。
 */
export function RerunButton({ href }: { href: string }) {
  const router = useRouter();
  const [navigating, setNavigating] = useState(false);

  function handleClick() {
    if (navigating) return;
    setNavigating(true);
    router.push(href);
  }

  return (
    <button
      className="status action-button action-rerun"
      type="button"
      onClick={handleClick}
      disabled={navigating}
    >
      {navigating ? <ButtonSpinner /> : <RefreshCcw size={13} />}
      {navigating ? "跳转中" : "重做"}
    </button>
  );
}
