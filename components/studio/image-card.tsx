"use client";

import { Download, Pencil } from "lucide-react";
import { FavoriteImageButton } from "../favorite-image-button";
import { ImageLightbox, type LightboxItem } from "../image-lightbox";
import { ImageTagsEditor } from "../image-tags-editor";
import { ImageWithSkeleton } from "../image-with-skeleton";
import { ReferenceBasketButton } from "../reference-basket";
import { imageThumbnailUrl } from "@/lib/thumbnails";
import type { GeneratedImage } from "@/lib/types";

export function ImageCard({
  image,
  galleryItems,
  galleryIndex,
  onEdit
}: {
  image: GeneratedImage;
  galleryItems: LightboxItem[];
  galleryIndex: number;
  onEdit: (imageId: string) => void;
}) {
  return (
    <article className="image-card">
      <ImageLightbox
        src={`/api/images/${image.id}`}
        downloadHref={`/api/images/${image.id}/download`}
        alt="生成图片"
        items={galleryItems}
        initialIndex={galleryIndex}
      >
        <ImageWithSkeleton src={imageThumbnailUrl(image.id)} alt="生成图片" />
      </ImageLightbox>
      <footer>
        <div className="image-card-meta">
          <span className="small muted">{Math.round(image.byte_size / 1024)} KB</span>
          <ImageTagsEditor imageId={image.id} initialTags={image.tags ?? []} />
        </div>
        <div className="actions image-card-actions">
          <FavoriteImageButton imageId={image.id} initialFavorite={image.is_favorite ?? false} />
          <ReferenceBasketButton imageId={image.id} />
          <button className="status action-button action-edit" type="button" onClick={() => onEdit(image.id)}>
            <Pencil size={13} />
            编辑
          </button>
          <a className="status action-button action-download" href={`/api/images/${image.id}/download`}>
            <Download size={13} />
            下载
          </a>
        </div>
      </footer>
    </article>
  );
}
