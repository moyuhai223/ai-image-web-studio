export type ByteRange = {
  start: number;
  end: number;
  length: number;
  contentRange: string;
};

export type ByteRangeParseResult =
  | { kind: "none" }
  | { kind: "invalid" }
  | { kind: "range"; range: ByteRange };

export function parseByteRangeHeader(header: string | null, size: number): ByteRangeParseResult {
  if (!header) return { kind: "none" };
  if (size <= 0) return { kind: "invalid" };

  const value = header.trim();
  if (!value.startsWith("bytes=")) return { kind: "invalid" };

  const rangeValue = value.slice("bytes=".length).trim();
  if (!rangeValue || rangeValue.includes(",")) return { kind: "invalid" };

  const match = rangeValue.match(/^(\d*)-(\d*)$/);
  if (!match) return { kind: "invalid" };

  const [, rawStart, rawEnd] = match;
  if (!rawStart && !rawEnd) return { kind: "invalid" };

  let start: number;
  let end: number;

  if (!rawStart) {
    const suffixLength = Number(rawEnd);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return { kind: "invalid" };
    start = Math.max(size - suffixLength, 0);
    end = size - 1;
  } else {
    start = Number(rawStart);
    if (!Number.isSafeInteger(start) || start < 0 || start >= size) return { kind: "invalid" };
    end = rawEnd ? Number(rawEnd) : size - 1;
    if (!Number.isSafeInteger(end) || end < start) return { kind: "invalid" };
    end = Math.min(end, size - 1);
  }

  return {
    kind: "range",
    range: {
      start,
      end,
      length: end - start + 1,
      contentRange: `bytes ${start}-${end}/${size}`
    }
  };
}

export function isIfRangeSatisfied(header: string | null, etag: string, lastModified: string) {
  if (!header) return true;
  const value = header.trim();
  return value === etag || value === lastModified;
}
