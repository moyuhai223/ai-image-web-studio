"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { DownloadCloud, ExternalLink, FileText, Pencil, Plus, Save, Trash2, X } from "lucide-react";
import { formatDateTime } from "@/lib/time";
import type { PromptTemplate } from "@/lib/types";
import { DangerConfirmDialog } from "./danger-confirm-dialog";

type Props = {
  templates: PromptTemplate[];
};

type ApiResponse = {
  error?: string;
  inserted?: number;
  updated?: number;
  total?: number;
};

function formatDate(value: string) {
  return formatDateTime(value);
}

export function PromptTemplatesPanel({ templates }: Props) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState("");

  async function createTemplate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    setLoading(true);
    setMessage("");

    const response = await fetch("/api/prompt-templates", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: formData.get("title"),
        category: formData.get("category"),
        content: formData.get("content")
      })
    });
    const data = (await response.json().catch(() => ({}))) as ApiResponse;
    setLoading(false);
    setMessage(response.ok ? "模板已保存" : data.error ?? "保存失败");
    if (response.ok) {
      form.reset();
      router.refresh();
    }
  }

  async function updateTemplate(event: FormEvent<HTMLFormElement>, id: string) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setLoading(true);
    setMessage("");

    const response = await fetch("/api/prompt-templates", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id,
        title: formData.get("title"),
        category: formData.get("category"),
        content: formData.get("content")
      })
    });
    const data = (await response.json().catch(() => ({}))) as ApiResponse;
    setLoading(false);
    setMessage(response.ok ? "模板已更新" : data.error ?? "更新失败");
    if (response.ok) {
      setEditingId(null);
      router.refresh();
    }
  }

  async function importAwesomeTemplates() {
    setImporting(true);
    setMessage("");

    const response = await fetch("/api/prompt-templates/import-awesome", {
      method: "POST"
    });
    const data = (await response.json().catch(() => ({}))) as ApiResponse;
    setImporting(false);

    if (!response.ok) {
      setMessage(data.error ?? "导入失败");
      return;
    }

    setMessage(`精选库已同步：新增 ${data.inserted ?? 0} 个，更新 ${data.updated ?? 0} 个，共 ${data.total ?? 0} 个`);
    router.refresh();
  }

  async function removeTemplate(id: string) {
    setDeleteError("");
    setDeletingId(id);
    setMessage("");

    const response = await fetch("/api/prompt-templates", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id })
    });
    const data = (await response.json().catch(() => ({}))) as ApiResponse;
    setDeletingId(null);
    if (!response.ok) {
      setDeleteError(data.error ?? "删除失败");
      return;
    }
    setConfirmDeleteId(null);
    setMessage("模板已删除");
    router.refresh();
  }

  function openDeleteConfirm(id: string) {
    setDeleteError("");
    setConfirmDeleteId(id);
  }

  function closeDeleteConfirm() {
    if (deletingId) return;
    setConfirmDeleteId(null);
    setDeleteError("");
  }

  const deletingTemplate = templates.find((template) => template.id === confirmDeleteId);

  return (
    <section className="panel">
      <div className="panel-header">
        <h2 className="panel-title">
          <FileText size={17} /> 提示词模板
        </h2>
        <div className="actions">
          <button className="status action-button action-import" type="button" onClick={importAwesomeTemplates} disabled={importing}>
            <DownloadCloud size={13} />
            {importing ? "导入中" : "导入精选库"}
          </button>
          <span className="status">{templates.length} 个模板</span>
        </div>
      </div>
      <div className="panel-body form-stack">
        <form className="prompt-template-form" onSubmit={createTemplate}>
          <div className="field">
            <label htmlFor="template-title">模板名称</label>
            <input className="input" id="template-title" name="title" maxLength={80} placeholder="产品摄影" required />
          </div>
          <div className="field">
            <label htmlFor="template-category">分类</label>
            <input className="input" id="template-category" name="category" maxLength={40} placeholder="通用" />
          </div>
          <div className="field prompt-template-content-field">
            <label htmlFor="template-content">模板内容</label>
            <textarea
              className="textarea"
              id="template-content"
              name="content"
              maxLength={4000}
              placeholder="写入常用提示词内容"
              required
            />
          </div>
          <button className="button action-button action-add" type="submit" disabled={loading}>
            <Plus size={17} />
            {loading ? "保存中" : "新增模板"}
          </button>
        </form>

        {message ? <p className="small muted">{message}</p> : null}

        {templates.length > 0 ? (
          <div className="prompt-template-list">
            {templates.map((template) =>
              editingId === template.id ? (
                <form className="prompt-template-card" key={template.id} onSubmit={(event) => updateTemplate(event, template.id)}>
                  <div className="prompt-template-edit-grid">
                    <div className="field">
                      <label htmlFor={`template-title-${template.id}`}>模板名称</label>
                      <input
                        className="input"
                        id={`template-title-${template.id}`}
                        name="title"
                        defaultValue={template.title}
                        maxLength={80}
                        required
                      />
                    </div>
                    <div className="field">
                      <label htmlFor={`template-category-${template.id}`}>分类</label>
                      <input
                        className="input"
                        id={`template-category-${template.id}`}
                        name="category"
                        defaultValue={template.category}
                        maxLength={40}
                      />
                    </div>
                  </div>
                  <div className="field">
                    <label htmlFor={`template-content-${template.id}`}>模板内容</label>
                    <textarea
                      className="textarea compact-textarea"
                      id={`template-content-${template.id}`}
                      name="content"
                      defaultValue={template.content}
                      maxLength={4000}
                      required
                    />
                  </div>
                  <div className="actions">
                    <button className="button action-button action-save" type="submit" disabled={loading}>
                      <Save size={16} />
                      {loading ? "保存中" : "保存修改"}
                    </button>
                    <button className="button action-button action-neutral" type="button" onClick={() => setEditingId(null)}>
                      <X size={16} />
                      取消
                    </button>
                  </div>
                </form>
              ) : (
                <article className="prompt-template-card" key={template.id}>
                  <div className="prompt-template-head">
                    <div>
                      <div className="actions">
                        <strong>{template.title}</strong>
                        <span className="status">{template.category || "通用"}</span>
                      </div>
                      <p className="small muted">更新 {formatDate(template.updated_at)}</p>
                      {template.source_name ? (
                        <p className="small prompt-template-source">
                          <span>{template.source_name}</span>
                          {template.source_url ? (
                            <a href={template.source_url} target="_blank" rel="noreferrer">
                              来源 <ExternalLink size={12} />
                            </a>
                          ) : null}
                        </p>
                      ) : null}
                    </div>
                    <div className="actions">
                      <button className="status action-button action-edit" type="button" onClick={() => setEditingId(template.id)}>
                        <Pencil size={13} />
                        编辑
                      </button>
                      <button className="status action-button action-danger" type="button" disabled={deletingId === template.id} onClick={() => openDeleteConfirm(template.id)}>
                        <Trash2 size={13} />
                        {deletingId === template.id ? "删除中" : "删除"}
                      </button>
                    </div>
                  </div>
                  <p className="small prompt-template-preview">{template.content}</p>
                </article>
              )
            )}
          </div>
        ) : (
          <p className="small muted">还没有提示词模板。</p>
        )}
      </div>
      <DangerConfirmDialog
        open={Boolean(confirmDeleteId)}
        title="确认删除提示词模板"
        description={`模板「${deletingTemplate?.title ?? "当前模板"}」删除后不可恢复。`}
        confirmLabel="删除模板"
        loadingLabel="删除中"
        loading={Boolean(deletingId)}
        error={deleteError}
        confirmIcon={<Trash2 size={16} />}
        onClose={closeDeleteConfirm}
        onConfirm={() => {
          if (confirmDeleteId) void removeTemplate(confirmDeleteId);
        }}
      />
    </section>
  );
}
