import { Loader2 } from "lucide-react";

/**
 * 按钮内的小转圈。
 *
 * 之前所有 async 按钮 loading 态只换文字("删除中"/"重试中"/"跳转中"),
 * 用户看不出"已经在响应了还是卡住了"。用 lucide-react 的 Loader2 + 一个
 * 简单的 `.button-spinner` 旋转 class(在 globals.css 里定义 @keyframes spin),
 * 在按钮 loading 时替换原来的状态图标(Trash2/Ban/RotateCcw/RefreshCcw),
 * 文字保留不动,避免破坏排版宽度。
 *
 * 这里不是 client component — 纯展示,无 state,可在 server / client 共用。
 */
export function ButtonSpinner({ size = 13 }: { size?: number }) {
  return <Loader2 size={size} className="button-spinner" aria-hidden="true" />;
}
