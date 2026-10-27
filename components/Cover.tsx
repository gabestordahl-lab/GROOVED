"use client";

import { useEffect, useState } from "react";
import type { CatalogItem } from "@/lib/types";

export default function Cover({ item, className = "" }: { item: CatalogItem; className?: string }) {
  const [failed, setFailed] = useState(false);
  const [artistImage, setArtistImage] = useState<string | null>(null);

  useEffect(() => {
    setFailed(false);
    setArtistImage(null);
    if (item.type !== "artist" || !item.artistMbid) return;
    let cancelled = false;
    fetch(`/api/music/artist-image?mbid=${encodeURIComponent(item.artistMbid)}`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => { if (!cancelled && data?.imageUrl) setArtistImage(data.imageUrl); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [item.type, item.artistMbid]);

  const src = item.type === "artist" ? artistImage : item.coverUrl;
  if (src && !failed) {
    return (
      <div className={`cover-art ${item.type === "artist" ? "artist-photo" : ""} ${className}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={`${item.title} artwork`} onError={() => setFailed(true)} />
      </div>
    );
  }

  return (
    <div className={`cover-art vinyl-fallback ${className}`} aria-label={`${item.title} artwork unavailable`}>
      <div className="vinyl-disc"><span /></div>
      <div className="fallback-word">{item.type === "artist" ? item.title.slice(0, 2).toUpperCase() : "G"}</div>
    </div>
  );
}
