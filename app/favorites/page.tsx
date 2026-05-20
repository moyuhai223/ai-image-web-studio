import { AppNav } from "@/components/app-nav";
import { CopyPromptButton } from "@/components/copy-prompt-button";
import { FavoriteImageButton } from "@/components/favorite-image-button";
import { ImageLightbox, type LightboxItem } from "@/components/image-lightbox";
import { ImageTagsEditor } from "@/components/image-tags-editor";
import { ImageWithSkeleton } from "@/components/image-with-skeleton";
import { PageSelect } from "@/components/page-select";
import { requireUser } from "@/lib/auth";
import { generationStatusLabel } from "@/lib/generation-status";
import { countFavoriteImages, listFavoriteImagesPage, type FavoriteImageFilters } from "@/lib/repository";
import { formatDateTime } from "@/lib/time";
import { imageThumbnailUrl } from "@/lib/thumbnails";
import { getUiThemePreference } from "@/lib/ui-theme";
import { modelOptions } from "@/lib/validation";
import { Pencil } from "lucide-react";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 24;

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

const sizeOptions = ["auto", "1024x1024", "1024x1824", "1824x1024", "1360x1024", "1024x1360"];

const periodOptions: { label: string; value: NonNullable<FavoriteImageFilters["period"]> }[] = [
  { label: "今天收藏", value: "today" },
  { label: "近 7 天", value: "7d" },
  { label: "近 30 天", value: "30d" }
];

function cleanParam(value: string | string[] | undefined) {
  const text = firstParam(value)?.trim();
  return text || undefined;
}

function normalizePeriod(value: string | string[] | undefined): FavoriteImageFilters["period"] {
  const text = cleanParam(value);
  return periodOptions.some((item) => item.value === text) ? (text as FavoriteImageFilters["period"]) : undefined;
}

function normalizeTag(value: string | string[] | undefined) {
  return cleanParam(value)?.replace(/^#+/, "").slice(0, 32);
}

function normalizeFavoriteFilters(params: Record<string, string | string[] | undefined>): FavoriteImageFilters {
  const model = cleanParam(params.model);
  const size = cleanParam(params.size);

  return {
    q: cleanParam(params.q),
    tag: normalizeTag(params.tag),
    model: modelOptions.some((item) => item.value === model) ? model : undefined,
    size: sizeOptions.includes(size ?? "") ? size : undefined,
    period: normalizePeriod(params.period)
  };
}

function filterQueryString(filters: FavoriteImageFilters) {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.tag) params.set("tag", filters.tag);
  if (filters.model) params.set("model", filters.model);
  if (filters.size) params.set("size", filters.size);
  if (filters.period) params.set("period", filters.period);
  return params.toString();
}

function pageHref(page: number, filterQuery = "") {
  const params = new URLSearchParams(filterQuery);
  params.set("page", String(page));
  return `/favorites?${params.toString()}`;
}

function activeFilterCount(filters: FavoriteImageFilters) {
  return Object.values(filters).filter(Boolean).length;
}

function rerunHref(image: { job_prompt: string; job_model: string; job_size: string }) {
  const params = new URLSearchParams({
    prompt: image.job_prompt,
    model: image.job_model,
    size: image.job_size,
    count: "1"
  });
  return `/?${params.toString()}`;
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function formatDuration(valueMs: number | null) {
  if (typeof valueMs !== "number") return "耗时 -";
  const totalSeconds = Math.max(0, Math.round(valueMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes <= 0 ? `耗时 ${seconds} 秒` : `耗时 ${minutes} 分 ${seconds} 秒`;
}

export default async function FavoritesPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const filters = normalizeFavoriteFilters(params);
  const filterQuery = filterQueryString(filters);
  const requestedPage = Number(firstParam(params.page) ?? 1);
  const [total, themePreference] = await Promise.all([countFavoriteImages(user, filters), getUiThemePreference()]);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Number.isFinite(requestedPage) ? Math.min(Math.max(1, requestedPage), totalPages) : 1;
  const images = await listFavoriteImagesPage(user, page, PAGE_SIZE, filters);
  const lightboxItems: LightboxItem[] = images.map((image) => ({
    src: `/api/images/${image.id}`,
    downloadHref: `/api/images/${image.id}/download`,
    alt: image.job_prompt
  }));

  return (
    <div className="shell" data-theme={themePreference.theme}>
      <AppNav user={user} themeMode={themePreference.mode} />
      <main className="main">
        <section className="panel">
          <div className="panel-header">
            <h1 className="panel-title">收藏作品集</h1>
            <div className="actions">
              {activeFilterCount(filters) > 0 ? <span className="status">已筛选 {activeFilterCount(filters)} 项</span> : null}
              <span className="status">共 {total} 张</span>
            </div>
          </div>
          <div className="panel-body">
            <form className="record-filters favorite-filters" action="/favorites" method="get">
              <div className="field">
                <label htmlFor="favorite-q">关键词</label>
                <input className="input" id="favorite-q" name="q" defaultValue={filters.q ?? ""} placeholder="提示词、模型、标签" />
              </div>
              <div className="field">
                <label htmlFor="favorite-tag">标签</label>
                <input className="input" id="favorite-tag" name="tag" defaultValue={filters.tag ?? ""} placeholder="图片标签" />
              </div>
              <div className="field">
                <label htmlFor="favorite-model">模型</label>
                <select className="select" id="favorite-model" name="model" defaultValue={filters.model ?? ""}>
                  <option value="">全部模型</option>
                  {modelOptions.map((item) => (
                    <option value={item.value} key={item.value}>{item.label}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="favorite-size">尺寸</label>
                <select className="select" id="favorite-size" name="size" defaultValue={filters.size ?? ""}>
                  <option value="">全部尺寸</option>
                  {sizeOptions.map((item) => (
                    <option value={item} key={item}>{item}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="favorite-period">收藏时间</label>
                <select className="select" id="favorite-period" name="period" defaultValue={filters.period ?? ""}>
                  <option value="">全部时间</option>
                  {periodOptions.map((item) => (
                    <option value={item.value} key={item.value}>{item.label}</option>
                  ))}
                </select>
              </div>
              <div className="record-filter-actions">
                <button className="button" type="submit">筛选</button>
                <a className="status" href="/favorites">重置</a>
              </div>
            </form>
            {images.length === 0 ? (
              <div className="empty-state">
                <p>{activeFilterCount(filters) > 0 ? "没有匹配的收藏图片。" : "还没有收藏图片。"}</p>
                <p className="small muted">{activeFilterCount(filters) > 0 ? "可以换一个关键词、标签或时间范围再试。" : "在生成结果、记录详情或记录页点击“收藏”，好图会集中放在这里。"}</p>
              </div>
            ) : (
              <div className="records-grid favorite-grid">
                {images.map((image, index) => (
                  <article className="image-card favorite-card" key={image.id}>
                    <ImageLightbox
                      src={`/api/images/${image.id}`}
                      downloadHref={`/api/images/${image.id}/download`}
                      alt={image.job_prompt}
                      items={lightboxItems}
                      initialIndex={index}
                    >
                      <ImageWithSkeleton src={imageThumbnailUrl(image.id)} alt={image.job_prompt} />
                    </ImageLightbox>
                    <footer className="record-card-footer">
                      <div className="record-card-body">
                        <div className="favorite-card-head">
                          <span className={`status ${image.job_status}`}>{generationStatusLabel(image.job_status)}</span>
                          <FavoriteImageButton imageId={image.id} initialFavorite={true} refreshOnChange={true} />
                        </div>
                        <p className="small record-card-prompt" title={image.job_prompt}>{image.job_prompt}</p>
                        <div className="record-card-meta-row">
                          <p className="small muted">{image.job_model} · {image.username}</p>
                          <CopyPromptButton prompt={image.job_prompt} />
                        </div>
                        <div className="asset-mini-row">
                          <span>{image.width ?? "-"} x {image.height ?? "-"}</span>
                          <span>{formatBytes(image.byte_size)}</span>
                          <span>{formatDuration(image.job_duration_ms)}</span>
                          <span>{formatDateTime(image.favorite_created_at ?? image.created_at)}</span>
                        </div>
                        <ImageTagsEditor imageId={image.id} initialTags={image.tags ?? []} tagBasePath="/favorites" />
                      </div>
                      <div className="actions image-card-actions">
                        <a className="status" href={`/records/${image.job_id}`}>详情</a>
                        <a className="status" href={rerunHref(image)}>重做</a>
                        <a className="status" href={`/?referenceImageId=${image.id}`}>
                          <Pencil size={13} />
                          编辑
                        </a>
                        <a className="status" href={`/api/images/${image.id}/download`}>下载</a>
                      </div>
                    </footer>
                  </article>
                ))}
              </div>
            )}
            <nav className="pagination" aria-label="收藏分页">
              <a className={`status ${page <= 1 ? "disabled" : ""}`} href={page <= 1 ? pageHref(1, filterQuery) : pageHref(page - 1, filterQuery)}>
                上一页
              </a>
              <span className="status">第 {page} / {totalPages} 页</span>
              <PageSelect page={page} totalPages={totalPages} query={filterQuery} basePath="/favorites" />
              <a className={`status ${page >= totalPages ? "disabled" : ""}`} href={page >= totalPages ? pageHref(totalPages, filterQuery) : pageHref(page + 1, filterQuery)}>
                下一页
              </a>
            </nav>
          </div>
        </section>
      </main>
    </div>
  );
}
