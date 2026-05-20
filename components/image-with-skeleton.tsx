"use client";

import { useEffect, useRef, useState, type ImgHTMLAttributes } from "react";

type Props = ImgHTMLAttributes<HTMLImageElement> & {
  wrapperClassName?: string;
};

export function ImageWithSkeleton({ wrapperClassName = "", className, loading = "lazy", onLoad, onError, src, ...props }: Props) {
  const [loaded, setLoaded] = useState(false);
  const imageRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    setLoaded(false);
    const image = imageRef.current;
    if (image?.complete && image.naturalWidth > 0) {
      setLoaded(true);
    }
  }, [src]);

  return (
    <span className={`image-skeleton ${loaded ? "loaded" : ""} ${wrapperClassName}`.trim()}>
      <img
        {...props}
        ref={imageRef}
        src={src}
        className={className}
        loading={loading}
        onLoad={(event) => {
          setLoaded(true);
          onLoad?.(event);
        }}
        onError={(event) => {
          setLoaded(true);
          onError?.(event);
        }}
      />
    </span>
  );
}
