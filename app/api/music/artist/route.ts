import { NextRequest, NextResponse } from "next/server";
import type { CatalogItem } from "@/lib/types";

const MB = "https://musicbrainz.org/ws/2";

function coverForReleaseGroup(id?: string | null) {
  return id ? `https://coverartarchive.org/release-group/${id}/front-500` : null;
}
function artistCredit(value: unknown): string {
  if (!Array.isArray(value)) return "Unknown artist";
  return value.map((part) => {
    if (!part || typeof part !== "object") return "";
    const record = part as Record<string, unknown>;
    return `${typeof record.name === "string" ? record.name : ""}${typeof record.joinphrase === "string" ? record.joinphrase : ""}`;
  }).join("") || "Unknown artist";
}
function yearFrom(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = value.match(/^(\d{4})/);
  return match ? Number(match[1]) : null;
}
async function mbFetch(url: string) {
  const userAgent = `Grooved/0.3 (${process.env.MUSICBRAINZ_CONTACT || "https://grooved.local"})`;
  let last: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, { headers: { Accept: "application/json", "User-Agent": userAgent }, next: { revalidate: 3600 } });
      if (response.ok) return response;
      last = new Error(`MusicBrainz returned ${response.status}`);
      if (response.status < 500 && response.status !== 429) break;
    } catch (error) { last = error; }
    await new Promise((resolve) => setTimeout(resolve, 700 * (attempt + 1)));
  }
  throw last instanceof Error ? last : new Error("MusicBrainz request failed");
}
async function resolveArtist(name: string) {
  const params = new URLSearchParams({ query: `artist:\"${name.replace(/\"/g, "\\\"")}\"`, fmt: "json", limit: "5" });
  const response = await mbFetch(`${MB}/artist?${params}`);
  const data = await response.json() as { artists?: Array<Record<string, unknown>> };
  const list = data.artists || [];
  const exact = list.find((a) => String(a.name || "").toLowerCase() === name.toLowerCase()) || list[0];
  return exact ? String(exact.id || "") : "";
}

export async function GET(request: NextRequest) {
  const name = request.nextUrl.searchParams.get("name")?.trim() || "";
  let mbid = request.nextUrl.searchParams.get("mbid")?.trim() || "";
  if (!mbid && !name) return NextResponse.json({ error: "Artist required" }, { status: 400 });
  try {
    if (!mbid) mbid = await resolveArtist(name);
    if (!mbid) return NextResponse.json({ error: "Artist not found" }, { status: 404 });

    const artistResponse = await mbFetch(`${MB}/artist/${encodeURIComponent(mbid)}?inc=genres&fmt=json`);
    const artist = await artistResponse.json() as Record<string, unknown>;
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const params = new URLSearchParams({ artist: mbid, fmt: "json", limit: "100", type: "album|ep|single" });
    const releasesResponse = await mbFetch(`${MB}/release-group?${params}`);
    const releases = await releasesResponse.json() as { "release-groups"?: Array<Record<string, unknown>> };

    const albums: CatalogItem[] = (releases["release-groups"] || [])
      .filter((rg) => !Array.isArray(rg["secondary-types"]) || !(rg["secondary-types"] as unknown[]).includes("Compilation"))
      .map((rg) => {
        const id = String(rg.id || "");
        return {
          mbid: id,
          type: "album" as const,
          title: String(rg.title || "Untitled"),
          artist: artistCredit(rg["artist-credit"]) || String(artist.name || name || "Unknown artist"),
          subtitle: [rg["primary-type"], rg["first-release-date"]].filter(Boolean).join(" · ") || "Release",
          releaseGroupMbid: id,
          artistMbid: mbid,
          releaseYear: yearFrom(rg["first-release-date"]),
          coverUrl: coverForReleaseGroup(id),
        };
      })
      .sort((a, b) => (b.releaseYear || 0) - (a.releaseYear || 0));

    const genres = Array.isArray(artist.genres)
      ? (artist.genres as Array<Record<string, unknown>>).sort((a, b) => Number(b.count || 0) - Number(a.count || 0)).slice(0, 8).map((g) => String(g.name || "")).filter(Boolean)
      : [];

    return NextResponse.json({
      artist: { mbid, type: "artist", title: String(artist.name || name || "Artist"), artist: String(artist.disambiguation || artist.country || "Artist"), subtitle: genres.slice(0, 3).join(" · "), artistMbid: mbid, releaseGroupMbid: null, coverUrl: null },
      genres,
      albums,
    });
  } catch (error) {
    console.error("Artist explorer error", error);
    return NextResponse.json({ error: "Artist page is temporarily unavailable." }, { status: 503 });
  }
}
