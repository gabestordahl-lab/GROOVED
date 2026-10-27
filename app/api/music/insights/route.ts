import { NextRequest, NextResponse } from "next/server";

const MB = "https://musicbrainz.org/ws/2";
type InputRating = { type: "song" | "album" | "artist"; mbid: string; overall: number; subtitle?: string };
async function mbFetch(url: string) {
  const userAgent = `Grooved/0.3 (${process.env.MUSICBRAINZ_CONTACT || "https://grooved.local"})`;
  const response = await fetch(url, { headers: { Accept: "application/json", "User-Agent": userAgent }, next: { revalidate: 86400 } });
  if (!response.ok) throw new Error(`MusicBrainz ${response.status}`);
  return response;
}
function yearFrom(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = value.match(/(19|20)\d{2}/);
  return match ? Number(match[0]) : null;
}
export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { ratings?: InputRating[] };
    const ratings = (body.ratings || []).filter((r) => r?.mbid && ["song", "album", "artist"].includes(r.type)).sort((a, b) => b.overall - a.overall).slice(0, 4);
    const genreScores = new Map<string, number>();
    const years: number[] = [];
    for (let i = 0; i < ratings.length; i++) {
      const rating = ratings[i];
      const entity = rating.type === "song" ? "recording" : rating.type === "album" ? "release-group" : "artist";
      try {
        const response = await mbFetch(`${MB}/${entity}/${encodeURIComponent(rating.mbid)}?inc=genres${rating.type === "song" ? "+releases" : ""}&fmt=json`);
        const data = await response.json() as Record<string, unknown>;
        if (Array.isArray(data.genres)) {
          for (const raw of data.genres as Array<Record<string, unknown>>) {
            const name = String(raw.name || "").trim();
            if (!name) continue;
            genreScores.set(name, (genreScores.get(name) || 0) + Math.max(1, Number(raw.count || 1)) * (rating.overall / 10));
          }
        }
        let year = yearFrom(data["first-release-date"]) || yearFrom(rating.subtitle);
        if (!year && rating.type === "song" && Array.isArray(data.releases)) {
          const found = (data.releases as Array<Record<string, unknown>>).map((r) => yearFrom(r.date)).filter((v): v is number => Boolean(v)).sort()[0];
          year = found || null;
        }
        if (year) years.push(year);
      } catch { /* profile should still render if an enrichment call fails */ }
      if (i < ratings.length - 1) await new Promise((resolve) => setTimeout(resolve, 1100));
    }
    const genres = [...genreScores.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name]) => name);
    const averageYear = years.length ? Math.round(years.reduce((a, b) => a + b, 0) / years.length) : null;
    const listeningAge = averageYear ? Math.max(0, new Date().getFullYear() - averageYear) : null;
    return NextResponse.json({ genres, averageYear, listeningAge });
  } catch {
    return NextResponse.json({ genres: [], averageYear: null, listeningAge: null });
  }
}
