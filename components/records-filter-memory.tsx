"use client";

import { useEffect } from "react";

const STORAGE_KEY = "ai-image-web-studio.records.filters";

export function RecordsFilterMemory({ filterQuery }: { filterQuery: string }) {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("reset") === "1") {
      window.localStorage.removeItem(STORAGE_KEY);
      window.history.replaceState(null, "", "/records");
      return;
    }

    if (filterQuery) {
      window.localStorage.setItem(STORAGE_KEY, filterQuery);
      return;
    }

    if (params.has("page") || params.has("lightbox")) return;
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved) {
      window.location.replace(`/records?${saved}`);
    }
  }, [filterQuery]);

  return null;
}

