import { NextRequest, NextResponse } from "next/server";
import type { CatalogItem, MusicType } from "@/lib/types";

const MB = "https://musicbrainz.org/ws/2";
const LB = "https://api.listenbrainz.org/1/popularity";
const SEARCH_LIMIT = 36;
const RETURN_LIMIT = 20;

type Candidate = CatalogItem & {
  mbScore: number;
  popularity: number;
};

function coverForReleaseGroup(id?: string | null) {
  return id ? `https://coverartarchive.org/release-group/${id}/front-500` : null;
}

function artistCredit(value: unknown): string {
  if (!Array.isArray(value)) return "Unknown artist";
  return value
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      const record = part as Record<string, unknown>;
      return `${typeof record.name === "string" ? record.name : ""}${typeof record.joinphrase === "string" ? record.joinphrase : ""}`;
    })
    .join("") || "Unknown artist";
}


function firstArtistMbid(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  for (const part of value) {
    if (!part || typeof part !== "object") continue;
    const artist = (part as Record<string, unknown>).artist;
    if (artist && typeof artist === "object") {
      const id = (artist as Record<string, unknown>).id;
      if (typeof id === "string") return id;
    }
  }
  return null;
}

function yearFrom(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = value.match(/^(\d{4})/);
  return match ? Number(match[1]) : null;
}

function firstReleaseGroup(recording: Record<string, unknown>): string | null {
  const releases = recording.releases;
  if (!Array.isArray(releases)) return null;
  for (const release of releases) {
    if (!release || typeof release !== "object") continue;
    const group = (release as Record<string, unknown>)["release-group"];
    if (group && typeof group === "object") {
      const id = (group as Record<string, unknown>).id;
      if (typeof id === "string") return id;
    }
  }
  return null;
}

function firstReleaseTitle(recording: Record<string, unknown>): string | undefined {
  const releases = recording.releases;
  if (!Array.isArray(releases) || !releases[0] || typeof releases[0] !== "object") return undefined;
  const title = (releases[0] as Record<string, unknown>).title;
  return typeof title === "string" ? title : undefined;
}

function normalize(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function luceneTerm(value: string) {
  // Escape Lucene special characters and quote the term so punctuation in names is safe.
  return `"${value.replace(/([+\-!(){}\[\]^"~*?:\\/]|&&|\|\|)/g, "\\$1")}"`;
}

function buildMusicBrainzQuery(query: string, type: MusicType, artistQuery = "") {
  const tokens = normalize(query).split(" ").filter(Boolean).slice(0, 10);
  if (!tokens.length) return query;

  if (type === "artist") {
    return tokens.map((token) => `artist:${luceneTerm(token)}`).join(" AND ");
  }

  const titleField = type === "song" ? "recording" : "releasegroup";
  if (artistQuery.trim()) {
    const titlePart = tokens.map((token) => `${titleField}:${luceneTerm(token)}`).join(" AND ");
    const artistTokens = normalize(artistQuery).split(" ").filter(Boolean).slice(0, 8);
    const artistPart = artistTokens.map((token) => `artist:${luceneTerm(token)}`).join(" AND ");
    return [titlePart, artistPart].filter(Boolean).join(" AND ");
  }
  // Every typed word may belong to either the title or the artist. This makes searches
  // such as "Nights Frank Ocean" and "Blonde Frank Ocean" work in one box.
  return tokens
    .map((token) => `(${titleField}:${luceneTerm(token)} OR artist:${luceneTerm(token)})`)
    .join(" AND ");
}

function textRelevance(item: CatalogItem, query: string, artistQuery = "") {
  const q = normalize(query);
  const title = normalize(item.title);
  const artist = normalize(item.artist);
  const combined = `${title} ${artist}`.trim();
  const tokens = q.split(" ").filter(Boolean);
  const aq = normalize(artistQuery);

  let score = 0;
  if (title === q) score += 1000;
  else if (title.startsWith(q)) score += 650;
  else if (title.includes(q)) score += 450;

  if (artist === q) score += 700;
  else if (artist.startsWith(q)) score += 350;
  else if (artist.includes(q)) score += 250;

  if (aq) {
    if (artist === aq) score += 1600;
    else if (artist.startsWith(aq)) score += 1100;
    else if (artist.includes(aq)) score += 800;
    else score -= 700;
  }

  const covered = tokens.filter((token) => combined.includes(token)).length;
  score += covered * 90;
  if (covered === tokens.length && tokens.length > 1) score += 350;

  // Reward a clean split where some query words are the title and the rest are the artist.
  for (let split = 1; split < tokens.length; split += 1) {
    const left = tokens.slice(0, split).join(" ");
    const right = tokens.slice(split).join(" ");
    if ((title === left && artist.includes(right)) || (artist === left && title.includes(right))) score += 900;
  }

  return score;
}

async function getPopularity(type: MusicType, ids: string[]) {
  if (!ids.length) return new Map<string, number>();
  const endpoint = type === "song" ? "recording" : type === "album" ? "release-group" : "artist";
  const bodyKey = type === "song" ? "recording_mbids" : type === "album" ? "release_group_mbids" : "artist_mbids";
  const idKey = type === "song" ? "recording_mbid" : type === "album" ? "release_group_mbid" : "artist_mbid";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 650);

  try {
    const response = await fetch(`${LB}/${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ [bodyKey]: ids.slice(0, 36) }),
      signal: controller.signal,
      next: { revalidate: 3600 },
    });
    if (!response.ok) return new Map<string, number>();

    const data = (await response.json()) as unknown;
    if (!Array.isArray(data)) return new Map<string, number>();
    const popularity = new Map<string, number>();
    for (const row of data) {
      if (!row || typeof row !== "object") continue;
      const record = row as Record<string, unknown>;
      const id = record[idKey];
      const listeners = record.total_user_count;
      const listens = record.total_listen_count;
      if (typeof id === "string") {
        const value = typeof listeners === "number" ? listeners : typeof listens === "number" ? listens : 0;
        popularity.set(id, value);
      }
    }
    return popularity;
  } catch {
    return new Map<string, number>();
  } finally {
    clearTimeout(timer);
  }
}

async function searchMusicBrainz(query: string, type: MusicType, artistQuery = "") {
  const endpoint = type === "song" ? "recording" : type === "album" ? "release-group" : "artist";
  const params = new URLSearchParams({ query: buildMusicBrainzQuery(query, type, artistQuery), fmt: "json", limit: String(SEARCH_LIMIT) });
  const userAgent = `Grooved/0.2 (${process.env.MUSICBRAINZ_CONTACT || "https://grooved.local"})`;

  const fetchMusicBrainz = async (searchQuery: string) => {
    const searchParams = new URLSearchParams({ query: searchQuery, fmt: "json", limit: String(SEARCH_LIMIT) });
    let lastError: unknown;

    // MusicBrainz occasionally times out or returns a temporary 5xx. Retry briefly so a
    // single upstream hiccup does not turn into a dead Browse page.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await fetch(`${MB}/${endpoint}?${searchParams.toString()}`, {
          headers: { Accept: "application/json", "User-Agent": userAgent },
          next: { revalidate: 3600 },
        });
        if (response.ok) return response;
        lastError = new Error(`MusicBrainz returned ${response.status}`);
        if (response.status < 500 && response.status !== 429) break;
      } catch (error) {
        lastError = error;
      }
      await new Promise((resolve) => setTimeout(resolve, 700 * (attempt + 1)));
    }
    throw lastError instanceof Error ? lastError : new Error("MusicBrainz request failed");
  };

  let response;
  try {
    response = await fetchMusicBrainz(params.get("query") || query);
  } catch {
    // Structured title+artist searches are better when available. A plain search is a
    // useful final fallback because MusicBrainz can occasionally reject/struggle with
    // a more complex Lucene query while its basic search endpoint is healthy.
    response = await fetchMusicBrainz(query);
  }

  const data = (await response.json()) as Record<string, unknown>;
  const raw = type === "song" ? data.recordings : type === "album" ? data["release-groups"] : data.artists;
  if (!Array.isArray(raw)) return [];

  const candidates: Candidate[] = raw.map((entry) => {
    const value = entry as Record<string, unknown>;
    const id = String(value.id || "");
    const mbScore = Number(value.score || 0);

    if (type === "song") {
      const releaseGroupMbid = firstReleaseGroup(value);
      return {
        mbid: id,
        type,
        title: String(value.title || "Untitled"),
        artist: artistCredit(value["artist-credit"]),
        subtitle: firstReleaseTitle(value) || String(value["first-release-date"] || "Recording"),
        releaseGroupMbid,
        artistMbid: firstArtistMbid(value["artist-credit"]),
        releaseYear: yearFrom(value["first-release-date"]),
        coverUrl: coverForReleaseGroup(releaseGroupMbid),
        mbScore,
        popularity: 0,
      };
    }

    if (type === "album") {
      return {
        mbid: id,
        type,
        title: String(value.title || "Untitled"),
        artist: artistCredit(value["artist-credit"]),
        subtitle: [value["primary-type"], value["first-release-date"]].filter(Boolean).join(" · ") || "Release group",
        releaseGroupMbid: id,
        artistMbid: firstArtistMbid(value["artist-credit"]),
        releaseYear: yearFrom(value["first-release-date"]),
        coverUrl: coverForReleaseGroup(id),
        mbScore,
        popularity: 0,
      };
    }

    return {
      mbid: id,
      type,
      title: String(value.name || "Unknown artist"),
      artist: String(value.disambiguation || value.country || "Artist"),
      subtitle: [value.type, value.country].filter(Boolean).join(" · ") || "Artist",
      releaseGroupMbid: null,
      artistMbid: id,
      releaseYear: null,
      coverUrl: null,
      mbScore,
      popularity: 0,
    };
  }).filter((item) => item.mbid);

  const popularity = await getPopularity(type, candidates.map((item) => item.mbid));
  for (const item of candidates) item.popularity = popularity.get(item.mbid) || 0;

  candidates.sort((a, b) => {
    const aText = textRelevance(a, query, artistQuery);
    const bText = textRelevance(b, query, artistQuery);
    if (aText !== bText) return bText - aText;

    // ListenBrainz listeners break ties between many exact title matches, so familiar
    // recordings tend to rise above obscure ones without hard-coding specific artists.
    const aPopularity = Math.log10(a.popularity + 1) * 100;
    const bPopularity = Math.log10(b.popularity + 1) * 100;
    if (aPopularity !== bPopularity) return bPopularity - aPopularity;
    return b.mbScore - a.mbScore;
  });

  const seen = new Set<string>();
  const items: CatalogItem[] = [];
  for (const item of candidates) {
    // MusicBrainz can contain several recording MBIDs for the same recognizable track.
    // Keep the best-ranked title/artist pair so Browse stays clean.
    const key = type === "song" ? `${normalize(item.title)}|${normalize(item.artist)}` : item.mbid;
    if (seen.has(key)) continue;
    seen.add(key);
    const { mbScore: _mbScore, popularity: _popularity, ...catalogItem } = item;
    items.push(catalogItem);
    if (items.length >= RETURN_LIMIT) break;
  }
  return items;
}

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q")?.trim() || "";
  const artist = request.nextUrl.searchParams.get("artist")?.trim() || "";
  const type = (request.nextUrl.searchParams.get("type") || "song") as MusicType;

  if (!q || q.length < 2) return NextResponse.json({ items: [] });
  if (!( ["song", "album", "artist"] as string[]).includes(type)) {
    return NextResponse.json({ error: "Invalid type" }, { status: 400 });
  }

  try {
    const items = await searchMusicBrainz(q, type, artist);
    return NextResponse.json({ items });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Music search is temporarily unavailable. Please try again shortly." }, { status: 503 });
  }
}
