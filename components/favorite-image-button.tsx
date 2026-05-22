"use client";

import { Heart } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function FavoriteImageButton({
  imageId,
  initialFavorite = false,
  refreshOnChange = false
}: {
  imageId: string;
  initialFavorite?: boolean;
  refreshOnChange?: boolean;
}) {
  const router = useRouter();
  const [isFavorite, setIsFavorite] = useState(initialFavorite);
  const [saving, setSaving] = useState(false);

  async function toggleFavorite() {
    if (saving) return;
    const nextFavorite = !isFavorite;
    setSaving(true);
    setIsFavorite(nextFavorite);

    const response = await fetch(`/api/images/${imageId}/favorite`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ favorite: nextFavorite })
    });

    setSaving(false);
    if (!response.ok) {
      setIsFavorite(!nextFavorite);
      return;
    }

    const data = (await response.json().catch(() => ({}))) as { isFavorite?: boolean };
    setIsFavorite(Boolean(data.isFavorite));
    if (refreshOnChange) router.refresh();
  }

  return (
    <button
      className={`status action-button favorite-button ${isFavorite ? "favorited" : ""}`}
      type="button"
      onClick={toggleFavorite}
      disabled={saving}
      aria-pressed={isFavorite}
      title={isFavorite ? "取消收藏" : "收藏图片"}
    >
      <Heart size={13} fill={isFavorite ? "currentColor" : "none"} />
      {isFavorite ? "已收藏" : "收藏"}
    </button>
  );
}
