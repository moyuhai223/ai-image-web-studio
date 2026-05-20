"use client";

import { Check, Plus, Tag, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type TagSuggestion = {
  tag: string;
  usage_count: number;
};

function normalizeTag(value: string) {
  return value.trim().replace(/^#+/, "").replace(/\s+/g, " ");
}

function tagHref(tag: string, basePath: string) {
  const params = new URLSearchParams({ tag });
  return `${basePath}?${params.toString()}`;
}

export function TagChips({ tags, basePath = "/records" }: { tags?: string[]; basePath?: string }) {
  if (!tags?.length) return null;

  return (
    <div className="tag-chip-row">
      {tags.map((tag) => (
        <a className="tag-chip" href={tagHref(tag, basePath)} key={tag}>
          #{tag}
        </a>
      ))}
    </div>
  );
}

export function ImageTagsEditor({
  imageId,
  initialTags = [],
  tagBasePath = "/records"
}: {
  imageId: string;
  initialTags?: string[];
  tagBasePath?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [tags, setTags] = useState(initialTags);
  const [draft, setDraft] = useState("");
  const [suggestions, setSuggestions] = useState<TagSuggestion[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const availableSuggestions = useMemo(() => {
    const selected = new Set(tags.map((tag) => tag.toLocaleLowerCase()));
    return suggestions.filter((item) => !selected.has(item.tag.toLocaleLowerCase())).slice(0, 18);
  }, [suggestions, tags]);

  useEffect(() => {
    setTags(initialTags);
  }, [initialTags]);

  useEffect(() => {
    if (!open || suggestions.length > 0 || loadingSuggestions) return;

    setLoadingSuggestions(true);
    fetch("/api/tags")
      .then((response) => response.json())
      .then((data: { tags?: TagSuggestion[] }) => setSuggestions(data.tags ?? []))
      .catch(() => setSuggestions([]))
      .finally(() => setLoadingSuggestions(false));
  }, [loadingSuggestions, open, suggestions.length]);

  function addTag(value: string) {
    const nextTag = normalizeTag(value);
    if (!nextTag || nextTag.length > 32) {
      setMessage(nextTag.length > 32 ? "标签最多 32 个字符" : "");
      return;
    }
    setMessage("");
    setTags((current) => {
      if (current.some((tag) => tag.toLocaleLowerCase() === nextTag.toLocaleLowerCase())) return current;
      return [...current, nextTag].slice(0, 12);
    });
    setDraft("");
  }

  function removeTag(value: string) {
    setTags((current) => current.filter((tag) => tag !== value));
  }

  async function saveTags() {
    setSaving(true);
    setMessage("");
    const response = await fetch(`/api/images/${imageId}/tags`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tags })
    });
    setSaving(false);

    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      setMessage(data.error ?? "标签保存失败");
      return;
    }

    const data = (await response.json().catch(() => ({}))) as { tags?: string[] };
    setTags(data.tags ?? tags);
    setOpen(false);
    router.refresh();
  }

  return (
    <div className="image-tags-editor">
      <div className="tag-editor-summary">
        <TagChips tags={tags} basePath={tagBasePath} />
        <button className="status" type="button" onClick={() => setOpen((current) => !current)}>
          <Tag size={13} />
          {tags.length > 0 ? "编辑标签" : "添加标签"}
        </button>
      </div>
      {open ? (
        <div className="tag-editor-panel">
          <div className="tag-editor-input-row">
            <input
              className="input"
              value={draft}
              maxLength={32}
              placeholder="输入标签"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  addTag(draft);
                }
              }}
            />
            <button className="status" type="button" onClick={() => addTag(draft)}>
              <Plus size={13} />
              添加
            </button>
          </div>
          {tags.length > 0 ? (
            <div className="tag-editing-row" aria-label="当前标签">
              {tags.map((tag) => (
                <button className="tag-edit-chip" type="button" key={tag} onClick={() => removeTag(tag)}>
                  #{tag}
                  <X size={12} />
                </button>
              ))}
            </div>
          ) : null}
          <div className="tag-suggestion-block">
            <p className="small muted">{loadingSuggestions ? "正在加载历史标签..." : "历史标签"}</p>
            {availableSuggestions.length > 0 ? (
              <div className="tag-chip-row">
                {availableSuggestions.map((item) => (
                  <button className="tag-chip suggestion" type="button" key={item.tag} onClick={() => addTag(item.tag)}>
                    #{item.tag}
                  </button>
                ))}
              </div>
            ) : !loadingSuggestions ? (
              <p className="small muted">暂无可添加的历史标签。</p>
            ) : null}
          </div>
          {message ? <p className="small tag-editor-message">{message}</p> : null}
          <div className="tag-editor-actions">
            <button className="status" type="button" onClick={() => setOpen(false)} disabled={saving}>
              取消
            </button>
            <button className="status succeeded" type="button" onClick={saveTags} disabled={saving}>
              <Check size={13} />
              {saving ? "保存中" : "保存"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
