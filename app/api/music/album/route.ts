import { NextRequest, NextResponse } from "next/server";
import type { CatalogItem } from "@/lib/types";

const MB = "https://musicbrainz.org/ws/2";
function cover(id: string) { return `https://coverartarchive.org/release-group/${id}/front-500`; }
function artistCredit(value: unknown): string {
  if (!Array.isArray(value)) return "Unknown artist";
  return value.map((part) => {
    if (!part || typeof part !== "object") return "";
    const record = part as Record<string, unknown>;
    return `${typeof record.name === "string" ? record.name : ""}${typeof record.joinphrase === "string" ? record.joinphrase : ""}`;
  }).join("") || "Unknown artist";
}
function firstArtistMbid(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  for (const part of value) {
    if (!part || typeof part !== "object") continue;
    const artist = (part as Record<string, unknown>).artist;
    if (artist && typeof artist === "object" && typeof (artist as Record<string, unknown>).id === "string") return (artist as Record<string, unknown>).id as string;
  }
  return null;
}
async function mbFetch(url: string) {
  const userAgent = `Grooved/0.3 (${process.env.MUSICBRAINZ_CONTACT || "https://grooved.local"})`;
  let last: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, { headers: { Accept: "application/json", "User-Agent": userAgent }, next: { revalidate: 3600 } });
      if (response.ok) return response;
      last = new Error(`MusicBrainz returned ${response.status}`);
    } catch (error) { last = error; }
    await new Promise((resolve) => setTimeout(resolve, 700 * (attempt + 1)));
  }
  throw last instanceof Error ? last : new Error("MusicBrainz request failed");
}

export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id")?.trim() || "";
  if (!id) return NextResponse.json({ error: "Album required" }, { status: 400 });
  try {
    const groupResponse = await mbFetch(`${MB}/release-group/${encodeURIComponent(id)}?inc=artist-credits+genres&fmt=json`);
    const group = await groupResponse.json() as Record<string, unknown>;
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const params = new URLSearchParams({ "release-group": id, inc: "artist-credits+recordings+release-groups+media", fmt: "json", limit: "20" });
    const releaseResponse = await mbFetch(`${MB}/release?${params}`);
    const releaseData = await releaseResponse.json() as { releases?: Array<Record<string, unknown>> };
    const releases = releaseData.releases || [];
    const chosen = releases.find((r) => Array.isArray(r.media) && (r.media as Array<Record<string, unknown>>).some((m) => Array.isArray(m.tracks) && (m.tracks as unknown[]).length)) || releases[0];
    const albumArtist = artistCredit(group["artist-credit"]);
    const artistMbid = firstArtistMbid(group["artist-credit"]);
    const tracks: CatalogItem[] = [];
    if (chosen && Array.isArray(chosen.media)) {
      for (const medium of chosen.media as Array<Record<string, unknown>>) {
        if (!Array.isArray(medium.tracks)) continue;
        for (const rawTrack of medium.tracks as Array<Record<string, unknown>>) {
          const recording = rawTrack.recording as Record<string, unknown> | undefined;
          if (!recording?.id) continue;
          tracks.push({
            mbid: String(recording.id),
            type: "song",
            title: String(recording.title || rawTrack.title || "Untitled"),
            artist: artistCredit(recording["artist-credit"]) || albumArtist,
            subtitle: String(group.title || "Album track"),
            releaseGroupMbid: id,
            artistMbid,
            coverUrl: cover(id),
          });
        }
      }
    }
    const album: CatalogItem = { mbid: id, type: "album", title: String(group.title || "Untitled"), artist: albumArtist, subtitle: String(group["first-release-date"] || group["primary-type"] || "Album"), releaseGroupMbid: id, artistMbid, coverUrl: cover(id) };
    return NextResponse.json({ album, tracks });
  } catch (error) {
    console.error("Album explorer error", error);
    return NextResponse.json({ error: "Album tracks are temporarily unavailable." }, { status: 503 });
  }
}
