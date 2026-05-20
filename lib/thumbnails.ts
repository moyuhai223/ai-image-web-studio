export const THUMBNAIL_MAX_EDGE = 640;
export const THUMBNAIL_WEBP_QUALITY = 82;
export const THUMBNAIL_STORAGE_VERSION = "v3";
export const THUMBNAIL_QUERY = `thumb=1&tv=${THUMBNAIL_STORAGE_VERSION}`;

export function imageThumbnailUrl(imageId: string) {
  return `/api/images/${imageId}?${THUMBNAIL_QUERY}`;
}

export function thumbnailSrc(src: string) {
  return src.includes("?") ? `${src}&${THUMBNAIL_QUERY}` : `${src}?${THUMBNAIL_QUERY}`;
}
