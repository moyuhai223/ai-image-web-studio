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
import { RecordSelectCheckbox, RecordsBulkActions, RecordsSelectionProvider } from "@/components/records-bulk-actions";
import { RecordsToolContent, RecordsToolPanelsProvider, RecordsToolTabs } from "@/components/records-tool-panels";
import { ReferenceBasketButton } from "@/components/reference-basket";
import { RerunButton } from "@/components/rerun-button";
import { requireUser } from "@/lib/auth";
import { generationStatusLabel, isRetryableGenerationStatus } from "@/lib/generation-status";
import { countJobs, listJobsPage, type JobListFilters } from "@/lib/repository";
import { imageThumbnailUrl } from "@/lib/thumbnails";
import { getUiThemePreference } from "@/lib/ui-theme";
import type { GenerationJob, GenerationStatus } from "@/lib/types";
import { modelOptions } from "@/lib/validation";
import { Filter, Info, Image as ImageIcon, Inbox, RotateCcw } from "lucide-react";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 12;

const statusOptions: { label: string; value: GenerationStatus }[] = [
  { label: generationStatusLabel("queued"), value: "queued" },
  { label: generationStatusLabel("running"), value: "running" },
  { label: generationStatusLabel("succeeded"), value: "succeeded" },
  { label: generationStatusLabel("failed"), value: "failed" },
  { label: generationStatusLabel("upstream_error"), value: "upstream_error" },
  { label: generationStatusLabel("interrupted"), value: "interrupted" },
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
  // Badge 文案保持紧凑:有 tag 显示 #tag,有其他筛选显示数字,无筛选返回空字符串(组件会跳过 badge 渲染)
  const searchSummary = filtersForQuery.tag ? `#${filtersForQuery.tag}` : filterCount > 0 ? `${filterCount}` : "";
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
          <RecordsSelectionProvider ids={jobs.map((job) => job.id)}>
            <RecordsToolPanelsProvider
              searchSummary={searchSummary}
              initialActive={filterCount > 0 ? "search" : null}
            >
              <div className="panel-header">
                <h1 className="panel-title">生成记录</h1>
                <div className="actions panel-header-actions">
                  {/* 搜索/标签 tab 上提到 header,与标题同一行;窄屏自动退化为图标+计数 */}
                  <RecordsToolTabs />
                  {filterCount > 0 ? <span className="status">已筛选 <span className="num">{filterCount}</span> 项</span> : null}
                  <span className="status">共 <span className="num">{total}</span> 条</span>
                </div>
              </div>
              <div className="panel-body">
                <RecordsToolContent
                  search={
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
                        {/* 改用 .status action-button 风格,与卡片上的「复制 / 重做 / 删除」一脉相承 */}
                        <button className="status action-button action-filter" type="submit">
                          <Filter size={13} aria-hidden />
                          筛选
                        </button>
                        <a className="status action-button action-neutral" href="/records?reset=1">
                          <RotateCcw size={13} aria-hidden />
                          重置
                        </a>
                      </div>
                    </form>
                  }
                  tags={<RecordsBulkActions />}
                />
                {jobs.length === 0 ? (
                  <div className="empty-state empty-state-illustrated">
                    {filterCount > 0 ? <Inbox size={72} strokeWidth={1.4} aria-hidden /> : <ImageIcon size={72} strokeWidth={1.4} aria-hidden />}
                    <p className="empty-state-title">{filterCount > 0 ? "没有匹配的生成记录" : "还没有生成记录"}</p>
                    <p className="small muted">
                      {filterCount > 0
                        ? "换一个关键词、状态、模型或时间范围再试。或者点击重置查看全部。"
                        : "返回工作台输入提示词，开始你的第一次生成。完成后任务会出现在这里。"}
                    </p>
                    <div className="actions">
                      {filterCount > 0 ? (
                        <a className="button secondary" href="/records?reset=1">
                          <RotateCcw size={16} aria-hidden />
                          重置筛选
                        </a>
                      ) : (
                        <a className="button" href="/">前往工作台</a>
                      )}
                    </div>
                  </div>
                ) : null}
                <div className="records-grid">
                  {jobs.map((job) => {
                    const galleryIndex = job.thumbnail_id ? imageJobs.findIndex((imageJob) => imageJob.id === job.id) : 0;

                    return (
                      <article className="image-card record-card" key={job.id}>
                        <RecordSelectCheckbox id={job.id} />
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
                            <div className="record-card-status-row">
                              <span className={`status ${job.status}`}>{generationStatusLabel(job.status)}</span>
                              <a className="status action-button action-detail" href={`/records/${job.id}`}>
                                <Info size={13} />
                                详情
                              </a>
                            </div>
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
                            {job.status === "succeeded" ? (
                              <RerunButton href={rerunHref(job)} />
                            ) : null}
                            {job.thumbnail_id ? (
                              <FavoriteImageButton imageId={job.thumbnail_id} initialFavorite={job.thumbnail_favorite ?? false} />
                            ) : null}
                            {job.thumbnail_id ? (
                              <ReferenceBasketButton imageId={job.thumbnail_id} prompt={job.prompt} />
                            ) : null}
                            {isRetryableGenerationStatus(job.status) ? (
                              <JobControlButton action="requeue" recordId={job.id} />
                            ) : null}
                            {job.status === "queued" || job.status === "running" ? (
                              <JobControlButton action="cancel" recordId={job.id} />
                            ) : null}
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
                  <span className="status">第 <span className="num">{page} / {totalPages}</span> 页</span>
                  <PageSelect page={page} totalPages={totalPages} query={filterQuery} />
                  <a className={`status ${page >= totalPages ? "disabled" : ""}`} href={page >= totalPages ? pageHref(totalPages, filterQuery) : pageHref(page + 1, filterQuery)}>
                    下一页
                  </a>
                </nav>
              </div>
            </RecordsToolPanelsProvider>
          </RecordsSelectionProvider>
        </section>
      </main>
    </div>
  );
}
