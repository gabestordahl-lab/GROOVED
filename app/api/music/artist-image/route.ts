import { NextRequest, NextResponse } from "next/server";

const MB = "https://musicbrainz.org/ws/2";

export async function GET(request: NextRequest) {
  const mbid = request.nextUrl.searchParams.get("mbid")?.trim();
  if (!mbid) return NextResponse.json({ imageUrl: null });
  const userAgent = `Grooved/0.4 (${process.env.MUSICBRAINZ_CONTACT || "https://grooved.local"})`;
  try {
    const mb = await fetch(`${MB}/artist/${encodeURIComponent(mbid)}?inc=url-rels&fmt=json`, {
      headers: { Accept: "application/json", "User-Agent": userAgent },
      next: { revalidate: 86400 },
    });
    if (!mb.ok) return NextResponse.json({ imageUrl: null });
    const artist = await mb.json() as { relations?: Array<{ url?: { resource?: string } }> };
    const wikidata = artist.relations?.map((r) => r.url?.resource || "").find((url) => url.includes("wikidata.org/wiki/Q"));
    const qid = wikidata?.match(/wiki\/(Q\d+)/)?.[1];
    if (!qid) return NextResponse.json({ imageUrl: null });

    const wd = await fetch(`https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`, { next: { revalidate: 86400 } });
    if (!wd.ok) return NextResponse.json({ imageUrl: null });
    const data = await wd.json() as any;
    const filename = data?.entities?.[qid]?.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
    if (typeof filename !== "string") return NextResponse.json({ imageUrl: null });
    const imageUrl = `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(filename)}?width=700`;
    return NextResponse.json({ imageUrl });
  } catch {
    return NextResponse.json({ imageUrl: null });
  }
}
