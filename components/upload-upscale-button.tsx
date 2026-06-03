"use client";

import { useRef, useState } from "react";
import { Sparkles } from "lucide-react";

/**
 * 上传任意图片做 AI 4K 高清化。选/拖一张图 → POST /api/images/upscale-upload → 入队;
 * 完成后由工作台的队列同步自动出现在「最近记录 / 记录」。type=button + 无 name 的 file input,
 * 放在生成表单里也不会被一起提交。
 */
export function UploadUpscaleButton() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function onPick(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    if (inputRef.current) inputRef.current.value = "";
    if (!file) return;

    setBusy(true);
    setMessage("");
    try {
      const formData = new FormData();
      formData.append("image", file, file.name || "upload.png");
      const response = await fetch("/api/images/upscale-upload", { method: "POST", body: formData });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setMessage(data.error ?? "高清化失败");
        return;
      }
      setMessage("已加入队列,完成后在「最近记录 / 记录」里查看");
    } catch {
      setMessage("网络错误,请重试");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="form-section upload-upscale">
      <button
        className="status action-button action-upscale"
        type="button"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
      >
        <Sparkles size={13} />
        {busy ? "提交中…" : "上传图片高清化 4K"}
      </button>
      <span className="small muted">把任意图片放大重绘到 4K(AI),结果进记录;不影响下方生成</span>
      <input
        ref={inputRef}
        className="file-input"
        type="file"
        accept="image/png,image/jpeg,image/webp"
        onChange={onPick}
      />
      {message ? <span className="small upscale-message">{message}</span> : null}
    </div>
  );
}
