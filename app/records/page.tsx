import { AppNav } from "@/components/app-nav";
import { CopyPromptButton } from "@/components/copy-prompt-button";
import { DeleteRecordButton } from "@/components/delete-record-button";
import { FavoriteImageButton } from "@/components/favorite-image-button";
import { ImageWithSkeleton } from "@/components/image-with-skeleton";
import { ImageLightbox, type LightboxItem } from "@/components/image-lightbox";
import { ImageTagsEditor } from "@/components/image-tags-editor";
import { JobControlButton } from "@/components/job-control-button";
import { PageSelect } from "@/components/page-select";
import { RecordsFilterMemory } from "@/components/records-filter-memory";
import { RecordsBulkActions } from "@/components/records-bulk-actions";
import { requireUser } from "@/lib/auth";
import { generationStatusLabel } from "@/lib/generation-status";
import { countJobs, listJobsPage, type JobListFilters } from "@/lib/repository";
import { imageThumbnailUrl } from "@/lib/thumbnails";
import { getUiThemePreference } from "@/lib/ui-theme";
import type { GenerationJob, GenerationStatus } from "@/lib/types";
import { modelOptions } from "@/lib/validation";
import { Pencil, RefreshCcw } from "lucide-react";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 12;

const statusOptions: { label: string; value: GenerationStatus }[] = [
  { label: generationStatusLabel("queued"), value: "queued" },
  { label: generationStatusLabel("running"), value: "running" },
  { label: generationStatusLabel("succeeded"), value: "succeeded" },
  { label: generationStatusLabel("failed"), value: "failed" },
  { label: generationStatusLabel("canceled"), value: "canceled" }
];

const sizeOptions = ["auto", "1024x1024", "1024x1824", "1824x1024", "1360x1024", "1024x1360"];

const periodOptions: { label: string; value: NonNullable<JobListFilters["period"]> }[] = [
  { label: "今天", value: "today" },
  { label: "近 7 天", value: "7d" },
  { label: "近 30 天", value: "30d" }
];

type LightboxPageTarget = "first" | "last";

function rerunHref(job: Pick<GenerationJob, "prompt" | "model" | "size" | "count">) {
  const params = new URLSearchParams({
    prompt: job.prompt,
    model: job.model,
    size: job.size,
    count: String(job.count)
  });
  return `/?${params.toString()}`;
}

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function cleanParam(value: string | string[] | undefined) {
  const text = firstParam(value)?.trim();
  return text || undefined;
}

function normalizeStatus(value: string | string[] | undefined): GenerationStatus | undefined {
  const text = cleanParam(value);
  return statusOptions.some((item) => item.value === text) ? (text as GenerationStatus) : undefined;
}

function normalizePeriod(value: string | string[] | undefined): JobListFilters["period"] {
  const text = cleanParam(value);
  return periodOptions.some((item) => item.value === text) ? (text as JobListFilters["period"]) : undefined;
}

function normalizeLightboxTarget(value: string | string[] | undefined): LightboxPageTarget | undefined {
  const text = cleanParam(value);
  return text === "first" || text === "last" ? text : undefined;
}

function normalizeTag(value: string | string[] | undefined) {
  return cleanParam(value)?.replace(/^#+/, "").slice(0, 32);
}

function normalizeRecordsFilters(params: Record<string, string | string[] | undefined>): JobListFilters {
  const model = cleanParam(params.model);
  const size = cleanParam(params.size);

  return {
    q: cleanParam(params.q),
    status: normalizeStatus(params.status),
    model: modelOptions.some((item) => item.value === model) ? model : undefined,
    size: sizeOptions.includes(size ?? "") ? size : undefined,
    username: cleanParam(params.user),
    tag: normalizeTag(params.tag),
    period: normalizePeriod(params.period)
  };
}

function filterQueryString(filters: JobListFilters) {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.status) params.set("status", filters.status);
  if (filters.model) params.set("model", filters.model);
  if (filters.size) params.set("size", filters.size);
  if (filters.username) params.set("user", filters.username);
  if (filters.tag) params.set("tag", filters.tag);
  if (filters.period) params.set("period", filters.period);
  return params.toString();
}

function pageHref(page: number, filterQuery: string, lightboxTarget?: LightboxPageTarget) {
  const params = new URLSearchParams(filterQuery);
  params.set("page", String(page));
  if (lightboxTarget) params.set("lightbox", lightboxTarget);
  return `/records?${params.toString()}`;
}

function activeFilterCount(filters: JobListFilters) {
  return Object.values(filters).filter(Boolean).length;
}

export default async function RecordsPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const filters = normalizeRecordsFilters(params);
  const filtersForQuery = user.role === "admin" ? filters : { ...filters, username: undefined };
  const filterQuery = filterQueryString(filtersForQuery);
  const requestedPage = Number(firstParam(params.page) ?? 1);
  const lightboxTarget = normalizeLightboxTarget(params.lightbox);
  const [total, themePreference] = await Promise.all([countJobs(user, filtersForQuery), getUiThemePreference()]);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Number.isFinite(requestedPage) ? Math.min(Math.max(1, requestedPage), totalPages) : 1;
  const jobs = await listJobsPage(user, page, PAGE_SIZE, filtersForQuery);
  const imageJobs = jobs.filter((job) => job.thumbnail_id);
  const filterCount = activeFilterCount(filtersForQuery);
  const previousLightboxPageHref = page > 1 ? pageHref(page - 1, filterQuery, "last") : undefined;
  const nextLightboxPageHref = page < totalPages ? pageHref(page + 1, filterQuery, "first") : undefined;
  const lightboxItems: LightboxItem[] = imageJobs.map((job) => ({
    src: `/api/images/${job.thumbnail_id}`,
    downloadHref: `/api/images/${job.thumbnail_id}/download`,
    alt: "生成图片"
  }));

  return (
    <div className="shell" data-theme={themePreference.theme}>
      <AppNav user={user} themeMode={themePreference.mode} />
      <RecordsFilterMemory filterQuery={filterQuery} />
      <main className="main">
        <section className="panel">
          <div className="panel-header">
            <h1 className="panel-title">生成记录</h1>
            <div className="actions">
              {filterCount > 0 ? <span className="status">已筛选 {filterCount} 项</span> : null}
              <span className="status">共 {total} 条</span>
            </div>
          </div>
          <div className="panel-body">
            <details className="record-filter-panel" open={filterCount > 0}>
              <summary>
                <span>搜索筛选</span>
                <span className="record-filter-summary-meta">{filterCount > 0 ? `已筛选 ${filterCount} 项` : "点击展开"}</span>
              </summary>
              <form className="record-filters" action="/records" method="get">
                <div className="field">
                  <label htmlFor="record-q">关键词</label>
                  <input className="input" id="record-q" name="q" defaultValue={filtersForQuery.q ?? ""} placeholder="提示词、模型、尺寸" />
                </div>
                <div className="field">
                  <label htmlFor="record-status">状态</label>
                  <select className="select" id="record-status" name="status" defaultValue={filtersForQuery.status ?? ""}>
                    <option value="">全部状态</option>
                    {statusOptions.map((item) => (
                      <option value={item.value} key={item.value}>{item.label}</option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="record-model">模型</label>
                  <select className="select" id="record-model" name="model" defaultValue={filtersForQuery.model ?? ""}>
                    <option value="">全部模型</option>
                    {modelOptions.map((item) => (
                      <option value={item.value} key={item.value}>{item.label}</option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="record-size">尺寸</label>
                  <select className="select" id="record-size" name="size" defaultValue={filtersForQuery.size ?? ""}>
                    <option value="">全部尺寸</option>
                    {sizeOptions.map((item) => (
                      <option value={item} key={item}>{item}</option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="record-period">时间</label>
                  <select className="select" id="record-period" name="period" defaultValue={filtersForQuery.period ?? ""}>
                    <option value="">全部时间</option>
                    {periodOptions.map((item) => (
                      <option value={item.value} key={item.value}>{item.label}</option>
                    ))}
                  </select>
                </div>
                {user.role === "admin" ? (
                  <div className="field">
                    <label htmlFor="record-user">用户</label>
                    <input className="input" id="record-user" name="user" defaultValue={filtersForQuery.username ?? ""} placeholder="用户名" />
                  </div>
                ) : null}
                <div className="field">
                  <label htmlFor="record-tag">标签</label>
                  <input className="input" id="record-tag" name="tag" defaultValue={filtersForQuery.tag ?? ""} placeholder="图片标签" />
                </div>
                <div className="record-filter-actions">
                  <button className="button" type="submit">筛选</button>
                  <a className="status" href="/records?reset=1">重置</a>
                </div>
              </form>
            </details>
            <RecordsBulkActions visibleCount={jobs.length} />
            <div className="records-grid">
              {jobs.map((job) => {
                const galleryIndex = job.thumbnail_id ? imageJobs.findIndex((imageJob) => imageJob.id === job.id) : 0;

                return (
                  <article className="image-card record-card" key={job.id}>
                    <label className="record-select-control" aria-label="选择记录">
                      <input
                        data-record-select
                        form="records-bulk-form"
                        type="checkbox"
                        name="recordId"
                        value={job.id}
                      />
                    </label>
                    {job.thumbnail_id ? (
                      <ImageLightbox
                        src={`/api/images/${job.thumbnail_id}`}
                        downloadHref={`/api/images/${job.thumbnail_id}/download`}
                        alt="生成图片"
                        items={lightboxItems}
                        initialIndex={galleryIndex}
                        autoOpen={
                          (lightboxTarget === "first" && galleryIndex === 0) ||
                          (lightboxTarget === "last" && galleryIndex === imageJobs.length - 1)
                        }
                        autoOpenQueryParam="lightbox"
                        previousPageHref={previousLightboxPageHref}
                        nextPageHref={nextLightboxPageHref}
                      >
                        <ImageWithSkeleton src={imageThumbnailUrl(job.thumbnail_id)} alt="" />
                      </ImageLightbox>
                    ) : (
                      <div className="empty-state record-card-preview-empty">无图片</div>
                    )}
                    <footer className="record-card-footer">
                      <div className="record-card-body">
                        <span className={`status ${job.status}`}>{generationStatusLabel(job.status)}</span>
                        {job.thumbnail_id ? (
                          <ImageTagsEditor imageId={job.thumbnail_id} initialTags={job.thumbnail_tags ?? job.tags ?? []} />
                        ) : null}
                        <p className="small record-card-prompt" title={job.prompt}>{job.prompt}</p>
                        <div className="record-card-meta-row">
                          <p className="small muted">{job.model} · {job.username}</p>
                          <CopyPromptButton prompt={job.prompt} />
                        </div>
                      </div>
                      <div className="actions image-card-actions">
                        <a className="status" href={rerunHref(job)}>
                          <RefreshCcw size={13} />
                          重做
                        </a>
                        {job.thumbnail_id ? (
                          <FavoriteImageButton imageId={job.thumbnail_id} initialFavorite={job.thumbnail_favorite ?? false} />
                        ) : null}
                        {job.thumbnail_id ? (
                          <a className="status" href={`/?referenceImageId=${job.thumbnail_id}`}>
                            <Pencil size={13} />
                            编辑
                          </a>
                        ) : null}
                        {job.status === "failed" || job.status === "canceled" ? (
                          <JobControlButton action="requeue" recordId={job.id} />
                        ) : null}
                        {job.status === "queued" || job.status === "running" ? (
                          <JobControlButton action="cancel" recordId={job.id} />
                        ) : null}
                        <a className="status" href={`/records/${job.id}`}>详情</a>
                        {job.status === "queued" || job.status === "running" ? null : <DeleteRecordButton recordId={job.id} />}
                      </div>
                    </footer>
                  </article>
                );
              })}
            </div>
            <nav className="pagination" aria-label="记录分页">
              <a className={`status ${page <= 1 ? "disabled" : ""}`} href={page <= 1 ? pageHref(1, filterQuery) : pageHref(page - 1, filterQuery)}>
                上一页
              </a>
              <span className="status">第 {page} / {totalPages} 页</span>
              <PageSelect page={page} totalPages={totalPages} query={filterQuery} />
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
