export type MusicType = "song" | "album" | "artist";

export type CatalogItem = {
  mbid: string;
  type: MusicType;
  title: string;
  artist: string;
  subtitle?: string;
  releaseGroupMbid?: string | null;
  artistMbid?: string | null;
  releaseYear?: number | null;
  coverUrl?: string | null;
};

export type Rating = CatalogItem & {
  id?: string;
  overall: number;
  lyrics: number;
  production: number;
  sound: number;
  uniqueness: number;
  emotion: number;
  tiebreak: number;
  review: string;
  created_at: string;
  updated_at: string;
};
