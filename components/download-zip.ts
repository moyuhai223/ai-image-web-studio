// 客户端:把所选图片打包下载。records 传 jobIds、favorites 传 imageIds。
// 走 fetch + blob 触发浏览器下载(POST 带 id 列表,不用塞进 URL)。

export async function downloadImagesZip(body: { imageIds?: string[]; jobIds?: string[] }): Promise<{ ok: boolean; error?: string }> {
  let response: Response;
  try {
    response = await fetch("/api/images/download", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
  } catch {
    return { ok: false, error: "下载请求失败,请重试" };
  }

  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    return { ok: false, error: data.error ?? "下载失败" };
  }

  const blob = await response.blob();
  const disposition = response.headers.get("content-disposition") ?? "";
  const matched = /filename="?([^"]+)"?/.exec(disposition);
  const filename = matched?.[1] ?? "ai-image-studio.zip";

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  return { ok: true };
}
