"use client";

import { useRouter } from "next/navigation";

export function PageSelect({
  page,
  totalPages,
  query = "",
  basePath = "/records"
}: {
  page: number;
  totalPages: number;
  query?: string;
  basePath?: string;
}) {
  const router = useRouter();

  function pageHref(nextPage: string) {
    const params = new URLSearchParams(query);
    params.set("page", nextPage);
    return `${basePath}?${params.toString()}`;
  }

  return (
    <label className="page-select">
      <span className="small muted">跳转</span>
      <select
        className="select"
        value={page}
        onChange={(event) => router.push(pageHref(event.target.value))}
      >
        {Array.from({ length: totalPages }, (_, index) => index + 1).map((item) => (
          <option key={item} value={item}>
            第 {item} 页
          </option>
        ))}
      </select>
    </label>
  );
}
