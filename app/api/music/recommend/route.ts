import { NextRequest, NextResponse } from "next/server";
import type { CatalogItem } from "@/lib/types";

const MB = "https://musicbrainz.org/ws/2";
const LB = "https://api.listenbrainz.org/1";

function cover(id: string) { return `https://coverartarchive.org/release-group/${id}/front-500`; }
function hash(value: string) { let h = 0; for (const ch of value) h = ((h << 5) - h + ch.charCodeAt(0)) | 0; return Math.abs(h); }
function normalize(value: string) { return value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim(); }
function collectSimilar(value: unknown, out: Array<{ mbid: string; name: string }>) {
  if (Array.isArray(value)) { for (const item of value) collectSimilar(item, out); return; }
  if (!value || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  if (typeof record.similar_artist_mbid === "string" && typeof record.similar_artist_name === "string") out.push({ mbid: record.similar_artist_mbid, name: record.similar_artist_name });
  for (const child of Object.values(record)) collectSimilar(child, out);
}

async function similarArtists(seedMbid: string) {
  try {
    const response = await fetch(`${LB}/lb-radio/artist/${encodeURIComponent(seedMbid)}`, { headers: { Accept: "application/json" }, next: { revalidate: 86400 } });
    if (!response.ok) return [];
    const data = await response.json() as unknown;
    const raw: Array<{ mbid: string; name: string }> = [];
    collectSimilar(data, raw);
    const seen = new Set<string>();
    return raw.filter((x) => x.mbid !== seedMbid && !seen.has(x.mbid) && seen.add(x.mbid));
  } catch { return []; }
}

async function mbFetch(url: string) {
  const userAgent = `Grooved/0.5 (${process.env.MUSICBRAINZ_CONTACT || "https://grooved.local"})`;
  let last: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(url, { headers: { Accept: "application/json", "User-Agent": userAgent }, next: { revalidate: 3600 } });
      if (r.ok) return r;
      last = new Error(`MusicBrainz ${r.status}`);
    } catch (e) { last = e; }
    await new Promise((resolve) => setTimeout(resolve, 650 * (attempt + 1)));
  }
  throw last instanceof Error ? last : new Error("MusicBrainz request failed");
}

async function resolveArtist(name: string) {
  const p = new URLSearchParams({ query: `artist:\"${name.replace(/\"/g, "\\\"")}\"`, fmt: "json", limit: "5" });
  const r = await mbFetch(`${MB}/artist?${p}`);
  const d = await r.json() as { artists?: Array<Record<string, unknown>> };
  const a = (d.artists || []).find((x) => normalize(String(x.name || "")) === normalize(name)) || d.artists?.[0];
  return a ? { mbid: String(a.id || ""), name: String(a.name || name), subtitle: String(a.disambiguation || a.country || "Artist") } : null;
}

function pickDiscoveryArtist(similar: Array<{ mbid: string; name: string }>, ratedArtists: Set<string>, seedNames: Set<string>, salt: string) {
  const unseen = similar.filter((item) => !ratedArtists.has(normalize(item.name)) && !seedNames.has(normalize(item.name)));
  if (!unseen.length) return null;
  // Skip the first few closest matches when possible. Those tend to be the obvious names.
  const discoveryPool = unseen.length > 8 ? unseen.slice(4, Math.min(28, unseen.length)) : unseen;
  return discoveryPool[hash(salt) % discoveryPool.length] || unseen[0];
}

async function releaseGroupsFor(artistMbid: string, rated: Set<string>) {
  const p = new URLSearchParams({ artist: artistMbid, fmt: "json", limit: "100", type: "album|ep|single" });
  const response = await mbFetch(`${MB}/release-group?${p}`);
  const data = await response.json() as { "release-groups"?: Array<Record<string, unknown>> };
  const groups = (data["release-groups"] || []).filter((g) => g.id && !rated.has(String(g.id)) && (!Array.isArray(g["secondary-types"]) || !(g["secondary-types"] as unknown[]).includes("Compilation")));
  const albums = groups.filter((g) => String(g["primary-type"] || "").toLowerCase() === "album");
  return albums.length ? albums : groups;
}

async function songFromGroup(group: Record<string, unknown>, artist: { mbid: string; name: string }, rated: Set<string>, salt: string) {
  const groupId = String(group.id || "");
  if (!groupId) return null;
  const rp = new URLSearchParams({ "release-group": groupId, inc: "artist-credits+recordings+media", fmt: "json", limit: "10" });
  const rr = await mbFetch(`${MB}/release?${rp}`);
  const rd = await rr.json() as { releases?: Array<Record<string, unknown>> };
  const release = (rd.releases || []).find((x) => Array.isArray(x.media) && (x.media as Array<Record<string, unknown>>).some((m) => Array.isArray(m.tracks) && (m.tracks as unknown[]).length));
  const tracks: Array<Record<string, unknown>> = [];
  if (release && Array.isArray(release.media)) {
    for (const m of release.media as Array<Record<string, unknown>>) if (Array.isArray(m.tracks)) tracks.push(...m.tracks as Array<Record<string, unknown>>);
  }
  const usable = tracks.filter((t) => t.recording && typeof t.recording === "object" && !rated.has(String((t.recording as Record<string, unknown>).id || "")));
  if (!usable.length) return null;
  const t = usable[hash(salt) % usable.length];
  const rec = t.recording as Record<string, unknown>;
  return {
    mbid: String(rec.id), type: "song" as const, title: String(rec.title || t.title || "Untitled"), artist: artist.name,
    subtitle: String(group.title || "Discovery pick"), releaseGroupMbid: groupId, artistMbid: artist.mbid, coverUrl: cover(groupId),
  } satisfies CatalogItem;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { artists?: string[]; ratedArtists?: string[]; ratedMbids?: string[]; songShuffle?: number; artistShuffle?: number };
    const seeds = (body.artists || []).filter(Boolean).slice(0, 5);
    if (!seeds.length) return NextResponse.json({ song: null, album: null, artist: null });

    const now = new Date();
    const day = now.toISOString().slice(0, 10);
    const week = `${now.getFullYear()}-${Math.ceil((((+now) - +new Date(now.getFullYear(), 0, 1)) / 86400000 + 1) / 7)}`;
    const rated = new Set(body.ratedMbids || []);
    const ratedArtists = new Set((body.ratedArtists || []).map(normalize));
    const seedNames = new Set(seeds.map(normalize));

    // Rotate which favorite artist acts as the seed so recommendations reflect more than one corner of the user's taste.
    const seedName = seeds[hash(`${day}-music-seed-${body.songShuffle || 0}`) % seeds.length];
    const seedArtist = await resolveArtist(seedName);
    if (!seedArtist?.mbid) return NextResponse.json({ song: null, album: null, artist: null });
    const similar = await similarArtists(seedArtist.mbid);

    const musicPick = pickDiscoveryArtist(similar, ratedArtists, seedNames, `${seedArtist.mbid}-${week}-music-${body.songShuffle || 0}`);
    const musicArtist = musicPick ? { mbid: musicPick.mbid, name: musicPick.name, subtitle: `A deeper pick from your taste in ${seedArtist.name}` } : seedArtist;

    await new Promise((r) => setTimeout(r, 950));
    const groups = await releaseGroupsFor(musicArtist.mbid, rated);
    const albumRaw = groups.length ? groups[hash(`${musicArtist.mbid}-${week}-album`) % groups.length] : null;
    const songGroup = groups.length ? groups[hash(`${musicArtist.mbid}-${day}-song-${body.songShuffle || 0}`) % groups.length] : albumRaw;

    const album: CatalogItem | null = albumRaw ? {
      mbid: String(albumRaw.id), type: "album", title: String(albumRaw.title || "Untitled"), artist: musicArtist.name,
      subtitle: [albumRaw["primary-type"], albumRaw["first-release-date"]].filter(Boolean).join(" · "), releaseGroupMbid: String(albumRaw.id), artistMbid: musicArtist.mbid, coverUrl: cover(String(albumRaw.id)),
    } : null;

    let song: CatalogItem | null = null;
    if (songGroup) {
      await new Promise((r) => setTimeout(r, 950));
      song = await songFromGroup(songGroup, musicArtist, rated, `${musicArtist.mbid}-${day}-${body.songShuffle || 0}`);
    }

    // Artist of the week uses an independent shuffle salt without adding more MusicBrainz calls.
    const artistPick = pickDiscoveryArtist(similar, ratedArtists, seedNames, `${seedArtist.mbid}-${week}-artist-${body.artistShuffle || 0}`);
    const artistTarget = artistPick || seedArtist;
    const artistItem: CatalogItem = {
      mbid: artistTarget.mbid, type: "artist", title: artistTarget.name,
      artist: artistPick ? `Discovery pick from ${seedArtist.name}` : seedArtist.subtitle,
      subtitle: artistPick ? `Because you rate ${seedArtist.name} highly` : "Based on your highest-rated music",
      artistMbid: artistTarget.mbid, releaseGroupMbid: null, coverUrl: null,
    };

    return NextResponse.json({ song, album, artist: artistItem });
  } catch (error) {
    console.error("Recommendation error", error);
    return NextResponse.json({ song: null, album: null, artist: null });
  }
}
