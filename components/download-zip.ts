// 客户端:把所选图片打包下载。records 传 jobIds、favorites 传 imageIds。
// 走 fetch + blob 触发浏览器下载(POST 带 id 列表,不用塞进 URL)。

export async function downloadImagesZip(body: { imageIds?: string[]; jobIds?: string[] }): Promise<{ ok: boolean; truncated?: boolean; error?: string }> {
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
  const truncated = response.headers.get("x-truncated") === "true";

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  return { ok: true, truncated };
}

// 逐张下载原图(不打包):先取 owned 图片 id 列表,再逐个走 /api/images/{id}/download 触发下载。
// 浏览器对程序化多文件下载会限速/弹"允许多文件下载",故每次间隔一点。
export async function downloadOriginalImages(body: { imageIds?: string[]; jobIds?: string[] }): Promise<{ ok: boolean; count?: number; truncated?: boolean; error?: string }> {
  let response: Response;
  try {
    response = await fetch("/api/images/download", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...body, mode: "list" })
    });
  } catch {
    return { ok: false, error: "请求失败,请重试" };
  }

  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    return { ok: false, error: data.error ?? "下载失败" };
  }

  const data = (await response.json().catch(() => ({}))) as { ids?: string[]; truncated?: boolean };
  const ids = Array.isArray(data.ids) ? data.ids.filter((id): id is string => typeof id === "string") : [];
  if (ids.length === 0) {
    return { ok: false, error: "没有可下载的图片" };
  }

  for (let i = 0; i < ids.length; i += 1) {
    const anchor = document.createElement("a");
    anchor.href = `/api/images/${ids[i]}/download`;
    anchor.download = "";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    if (i < ids.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
  }
  return { ok: true, count: ids.length, truncated: Boolean(data.truncated) };
}
