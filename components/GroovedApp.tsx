"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import Logo from "./Logo";
import Cover from "./Cover";
import { getSupabase, supabaseConfigured } from "@/lib/supabase";
import type { CatalogItem, MusicType, Rating } from "@/lib/types";
import type { User } from "@supabase/supabase-js";

type Page = "home" | "browse" | "crate" | "profile" | "artist" | "settings";
type Theme = "grooved" | "midnight" | "rust" | "ocean";
type Sort = "highest" | "recent" | "title" | "lowest";

const DEFAULT_SCORES = { overall: 7.5, lyrics: 7.5, sound: 7.5, uniqueness: 7.5, emotion: 7.5, production: 7.5, tiebreak: 50 };
const LOCAL_KEY = "grooved-ratings-v1";
const THEME_KEY = "grooved-theme-v1";

function round(value: number) { return Math.round(value * 10) / 10; }
function nowIso() { return new Date().toISOString(); }
function typeLabel(type: MusicType) { return type === "song" ? "Song" : type === "album" ? "Album" : "Artist"; }

export default function GroovedApp() {
  const [page, setPage] = useState<Page>("home");
  const [user, setUser] = useState<User | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [ratings, setRatings] = useState<Rating[]>([]);
  const [selected, setSelected] = useState<CatalogItem | null>(null);
  const [editing, setEditing] = useState<Rating | null>(null);
  const [toast, setToast] = useState("");
  const [theme, setTheme] = useState<Theme>("grooved");
  const [artistTarget, setArtistTarget] = useState<{ name: string; mbid?: string | null } | null>(null);
  const cloudEnabled = supabaseConfigured();

  useEffect(() => {
    const saved = localStorage.getItem(THEME_KEY) as Theme | null;
    if (saved && ["grooved", "midnight", "rust", "ocean"].includes(saved)) setTheme(saved);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase) {
      const local = localStorage.getItem(LOCAL_KEY);
      if (local) setRatings(JSON.parse(local));
      return;
    }
    supabase.auth.getUser().then(({ data }) => setUser(data.user));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => setUser(session?.user ?? null));
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!cloudEnabled) localStorage.setItem(LOCAL_KEY, JSON.stringify(ratings));
  }, [ratings, cloudEnabled]);

  useEffect(() => {
    if (!cloudEnabled || !user) {
      if (cloudEnabled && !user) setRatings([]);
      return;
    }
    const supabase = getSupabase()!;
    supabase
      .from("ratings")
      .select("*")
      .order("updated_at", { ascending: false })
      .then(({ data, error }) => {
        if (error) notify(`Could not load your crate: ${error.message}`);
        else setRatings((data || []).map(dbRowToRating));
      });
  }, [user, cloudEnabled]);

  function notify(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2600);
  }

  async function saveRating(rating: Rating) {
    if (cloudEnabled) {
      if (!user) { setAuthOpen(true); return false; }
      const supabase = getSupabase()!;
      const payload = ratingToDbRow(rating, user.id);
      const { data, error } = await supabase.from("ratings").upsert(payload, { onConflict: "user_id,entity_type,mbid" }).select().single();
      if (error) { notify(`Could not save: ${error.message}`); return false; }
      const saved = dbRowToRating(data);
      setRatings((current) => [saved, ...current.filter((r) => !(r.mbid === saved.mbid && r.type === saved.type))]);
    } else {
      setRatings((current) => [rating, ...current.filter((r) => !(r.mbid === rating.mbid && r.type === rating.type))]);
    }
    notify("Groove Grade saved to My Crate.");
    return true;
  }

  async function deleteRating(rating: Rating) {
    if (cloudEnabled && user) {
      const supabase = getSupabase()!;
      const { error } = await supabase.from("ratings").delete().eq("user_id", user.id).eq("entity_type", rating.type).eq("mbid", rating.mbid);
      if (error) { notify(`Could not remove rating: ${error.message}`); return; }
    }
    setRatings((current) => current.filter((r) => !(r.mbid === rating.mbid && r.type === rating.type)));
    notify("Removed from My Crate.");
  }

  function openArtist(name: string, mbid?: string | null) {
    setArtistTarget({ name, mbid });
    setPage("artist");
  }

  function openRate(item: CatalogItem) {
    const existing = ratings.find((r) => r.mbid === item.mbid && r.type === item.type) || null;
    setEditing(existing);
    setSelected(item);
  }

  const recent = ratings.slice().sort((a, b) => +new Date(b.updated_at) - +new Date(a.updated_at)).slice(0, 5);
  const average = ratings.length ? round(ratings.reduce((sum, r) => sum + r.overall, 0) / ratings.length) : 0;
  const top = ratings.slice().sort((a, b) => b.overall - a.overall)[0];

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Logo />
        <div className="nav-block">
          <nav>
            <Nav active={page === "home"} onClick={() => setPage("home")} icon="⌂">Overview</Nav>
            <Nav active={page === "browse"} onClick={() => setPage("browse")} icon="⌕">Browse</Nav>
            <Nav active={page === "crate"} onClick={() => setPage("crate")} icon="▤">My Crate</Nav>
            <Nav active={page === "profile"} onClick={() => setPage("profile")} icon="◌">Taste Profile</Nav>
            <Nav active={page === "settings"} onClick={() => setPage("settings")} icon="⚙">Settings</Nav>
          </nav>
        </div>
        <div className="sidebar-bottom">
          {cloudEnabled ? (
            user ? (
              <div className="account-card">
                <div className="avatar">{(user.email || "G").slice(0, 1).toUpperCase()}</div>
                <div className="account-copy"><strong>{user.email}</strong><span>Cloud crate</span></div>
                <button className="text-button" onClick={() => getSupabase()?.auth.signOut()}>Sign out</button>
              </div>
            ) : (
              <button className="btn primary wide" onClick={() => setAuthOpen(true)}>Sign in to save your crate</button>
            )
          ) : (
            <div className="demo-note"><strong>Local preview</strong><span>Connect Supabase to sync ratings across devices.</span></div>
          )}
        </div>
      </aside>

      <main>
        <header className="topbar">
          <div className="crumb">GROOVED / {page === "home" ? "Overview" : page === "browse" ? "Browse" : page === "crate" ? "My Crate" : page === "profile" ? "Taste Profile" : page === "settings" ? "Settings" : artistTarget?.name || "Artist"}</div>
          <button className="btn primary" onClick={() => setPage("browse")}>＋ Grade something</button>
        </header>

        {page === "home" && <Home ratings={ratings} recent={recent} average={average} goto={setPage} openRate={openRate} openArtist={openArtist} />}
        {page === "browse" && <Browse ratings={ratings} openRate={openRate} openArtist={openArtist} />}
        {page === "crate" && <Crate ratings={ratings} openRate={openRate} onDelete={deleteRating} goto={setPage} openArtist={openArtist} />}
        {page === "profile" && <TasteProfile ratings={ratings} average={average} />}
        {page === "settings" && <SettingsPage theme={theme} setTheme={setTheme} />}
        {page === "artist" && artistTarget && <ArtistExplorer target={artistTarget} ratings={ratings} openRate={openRate} openArtist={openArtist} onBack={() => setPage("browse")} />}
      </main>

      {selected && (
        <RatingModal
          item={selected}
          existing={editing}
          onClose={() => { setSelected(null); setEditing(null); }}
          onSave={async (rating) => {
            if (await saveRating(rating)) { setSelected(null); setEditing(null); }
          }}
        />
      )}
      {authOpen && <AuthModal onClose={() => setAuthOpen(false)} onNotify={notify} />}
      <div className={`toast ${toast ? "show" : ""}`}>{toast}</div>
    </div>
  );
}

function Nav({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: string; children: React.ReactNode }) {
  return <button className={`nav-btn ${active ? "active" : ""}`} onClick={onClick}><span>{icon}</span><b>{children}</b></button>;
}

function Home({ ratings, recent, average, goto, openRate, openArtist }: { ratings: Rating[]; recent: Rating[]; average: number; goto: (p: Page) => void; openRate: (i: CatalogItem) => void; openArtist: (name: string, mbid?: string | null) => void }) {
  const albums = ratings.filter((r) => r.type === "album").length;
  const songs = ratings.filter((r) => r.type === "song").length;
  const artists = ratings.filter((r) => r.type === "artist").length;
  const [recommendations, setRecommendations] = useState<{ song: CatalogItem | null; album: CatalogItem | null; artist: CatalogItem | null }>({ song: null, album: null, artist: null });
  const [recLoading, setRecLoading] = useState(false);
  const [shuffleSong, setShuffleSong] = useState(0);
  const [shuffleArtist, setShuffleArtist] = useState(0);
  const [shuffleBusy, setShuffleBusy] = useState<"song" | "artist" | null>(null);
  const seeds = useMemo(() => favoriteArtistNames(ratings), [ratings]);
  const ratedArtists = useMemo(() => [...new Set(ratings.map((r) => (r.type === "artist" ? r.title : r.artist).trim()).filter(Boolean))], [ratings]);

  useEffect(() => {
    if (!ratings.length || !seeds.length) { setRecommendations({ song: null, album: null, artist: null }); return; }
    let cancelled = false;
    if (!recommendations.song && !recommendations.album && !recommendations.artist) setRecLoading(true);
    fetch("/api/music/recommend", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        artists: seeds,
        ratedArtists,
        ratedMbids: ratings.map((r) => r.mbid),
        songShuffle: shuffleSong,
        artistShuffle: shuffleArtist,
      }),
    }).then((r) => r.json()).then((data) => {
      if (!cancelled) setRecommendations({ song: data.song || null, album: data.album || null, artist: data.artist || null });
    }).catch(() => {}).finally(() => {
      if (!cancelled) { setRecLoading(false); setShuffleBusy(null); }
    });
    return () => { cancelled = true; };
  }, [ratings, seeds, ratedArtists, shuffleSong, shuffleArtist]);

  function shuffle(target: "song" | "artist") {
    setShuffleBusy(target);
    if (target === "song") setShuffleSong((value) => value + 1);
    else setShuffleArtist((value) => value + 1);
  }

  return (
    <section className="page">
      <div className="hero-row">
        <div><h1>Overview.</h1></div>
        <button className="btn primary" onClick={() => goto("browse")}>Browse music ↗</button>
      </div>

      <div className="section-head"><div><h2>For you</h2></div></div>
      {!ratings.length ? (
        <div className="empty-hero"><div className="empty-vinyl"><span /></div><div><h2>Start your crate.</h2><p>Rate a few songs or albums and GROOVED will build recommendations from your taste.</p><button className="btn primary" onClick={() => goto("browse")}>Browse</button></div></div>
      ) : recLoading && !recommendations.song && !recommendations.album ? (
        <div className="rec-loading">Finding something a little outside your usual rotation…</div>
      ) : (
        <div className="recommendation-grid">
          <RecommendationCard label="Song of the day" item={recommendations.song} onOpen={(item) => openRate(item)} onShuffle={() => shuffle("song")} shuffleBusy={shuffleBusy === "song"} />
          <RecommendationCard label="Album of the week" item={recommendations.album} onOpen={(item) => openRate(item)} />
          <RecommendationCard label="Artist of the week" item={recommendations.artist} onOpen={(item) => openArtist(item.title, item.mbid)} artist onShuffle={() => shuffle("artist")} shuffleBusy={shuffleBusy === "artist"} />
        </div>
      )}

      <div className="section-head"><div><h2>Stats</h2></div></div>
      <div className="stats-grid">
        <Stat label="Average grade" value={ratings.length ? average.toFixed(1) : "—"} note="Across your crate" />
        <Stat label="Songs" value={String(songs)} note="Rated tracks" />
        <Stat label="Albums" value={String(albums)} note="Rated releases" />
        <Stat label="Artists" value={String(artists)} note="Rated artists" />
      </div>

      <div className="section-head"><div><h2>Recently graded</h2></div><button className="text-button" onClick={() => goto("crate")}>View My Crate ↗</button></div>
      {recent.length ? <div className="list-card">{recent.map((r) => <RatingRow key={`${r.type}-${r.mbid}`} rating={r} onClick={() => openRate(r)} />)}</div> : <Empty text="No ratings yet." />}
    </section>
  );
}

function RecommendationCard({ label, item, onOpen, artist = false, onShuffle, shuffleBusy = false }: { label: string; item: CatalogItem | null; onOpen: (item: CatalogItem) => void; artist?: boolean; onShuffle?: () => void; shuffleBusy?: boolean }) {
  if (!item) return <div className="recommendation-card muted-card"><span className="rec-label">{label}</span><div className="rec-empty">Keep rating music to sharpen this pick.</div></div>;
  return (
    <article className="recommendation-card">
      <div className="rec-card-head"><span className="rec-label">{label}</span>{onShuffle && <button className="shuffle-button" onClick={onShuffle} disabled={shuffleBusy} aria-label={`Shuffle ${label}`}>{shuffleBusy ? "…" : "↻ Shuffle"}</button>}</div>
      <Cover item={item} className="rec-cover" />
      <div className="rec-copy"><h3>{item.title}</h3><p>{artist ? "Artist" : item.artist}</p><small>{item.subtitle}</small></div>
      <button className="btn wide" onClick={() => onOpen(item)}>{artist ? "View artist" : "Grade it"}</button>
    </article>
  );
}

function Browse({ ratings, openRate, openArtist }: { ratings: Rating[]; openRate: (i: CatalogItem) => void; openArtist: (name: string, mbid?: string | null) => void }) {
  type SearchTab = { q: string; artistQ: string; items: CatalogItem[]; error: string };
  const emptyTab = (): SearchTab => ({ q: "", artistQ: "", items: [], error: "" });
  const [type, setType] = useState<MusicType>("song");
  const [tabs, setTabs] = useState<Record<MusicType, SearchTab>>({ song: emptyTab(), album: emptyTab(), artist: emptyTab() });
  const [loadingType, setLoadingType] = useState<MusicType | null>(null);
  const cache = useRef(new Map<string, CatalogItem[]>());
  const activeRequest = useRef<AbortController | null>(null);
  const current = tabs[type];

  function updateTab(patch: Partial<SearchTab>) {
    setTabs((state) => ({ ...state, [type]: { ...state[type], ...patch } }));
  }

  async function search(e?: FormEvent) {
    e?.preventDefault();
    const query = current.q.trim();
    if (query.length < 2) return;
    const artist = type !== "artist" ? current.artistQ.trim() : "";
    const cacheKey = `${type}|${query.toLowerCase()}|${artist.toLowerCase()}`;
    const cached = cache.current.get(cacheKey);
    if (cached) { updateTab({ items: cached, error: "" }); return; }

    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    setLoadingType(type);
    updateTab({ error: "" });
    try {
      const params = new URLSearchParams({ q: query, type });
      if (artist) params.set("artist", artist);
      const response = await fetch(`/api/music/search?${params.toString()}`, { signal: controller.signal });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "Search failed");
      const found = (json.items || []) as CatalogItem[];
      cache.current.set(cacheKey, found);
      setTabs((state) => ({ ...state, [type]: { ...state[type], items: found, error: "" } }));
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setTabs((state) => ({ ...state, [type]: { ...state[type], error: err instanceof Error ? err.message : "Search failed", items: [] } }));
    } finally {
      setLoadingType((active) => active === type ? null : active);
    }
  }

  return (
    <section className="page">
      <div className="hero-row"><div><h1>Browse.</h1></div></div>
      <div className="type-tabs">
        {(["song", "album", "artist"] as MusicType[]).map((t) => <button key={t} className={type === t ? "active" : ""} onClick={() => setType(t)}>{t === "song" ? "Songs" : t === "album" ? "Albums" : "Artists"}</button>)}
      </div>
      <form className={`catalog-search ${type !== "artist" ? "split-search" : ""}`} onSubmit={search}>
        <div className="search-field"><span>⌕</span><input value={current.q} onChange={(e) => updateTab({ q: e.target.value })} placeholder={type === "song" ? "Song title" : type === "album" ? "Album title" : "Artist name"} aria-label={type === "song" ? "Song title" : type === "album" ? "Album title" : "Artist name"} /></div>
        {type !== "artist" && <div className="search-field artist-filter"><span>by</span><input value={current.artistQ} onChange={(e) => updateTab({ artistQ: e.target.value })} placeholder="Artist (optional)" aria-label="Artist filter" /></div>}
        <button className="btn primary" disabled={loadingType === type}>{loadingType === type ? "Searching…" : "Search"}</button>
      </form>
      {current.error && <div className="error-box">{current.error}</div>}
      {!current.items.length && loadingType !== type && !current.error ? <Empty text="Search to see results." /> : null}
      <div className="catalog-grid">
        {current.items.map((item) => {
          const existing = ratings.find((r) => r.mbid === item.mbid && r.type === item.type);
          return <CatalogCard key={`${item.type}-${item.mbid}`} item={item} grade={existing?.overall} onRate={() => openRate(item)} onArtist={() => openArtist(item.type === "artist" ? item.title : item.artist, item.type === "artist" ? item.mbid : item.artistMbid)} />;
        })}
      </div>
    </section>
  );
}

function CatalogCard({ item, grade, onRate, onArtist }: { item: CatalogItem; grade?: number; onRate: () => void; onArtist: () => void }) {
  return (
    <article className="catalog-card">
      <Cover item={item} />
      <div className="card-copy"><div className="card-top"><span className="pill">{typeLabel(item.type)}</span>{grade !== undefined && <span className="mini-grade">{grade.toFixed(1)}</span>}</div><h3>{item.title}</h3>{item.type === "artist" ? <button className="artist-link" onClick={onArtist}>View discography</button> : <button className="artist-link" onClick={onArtist}>{item.artist}</button>}<small>{item.subtitle}</small>{item.type === "artist" ? <div className="card-actions"><button className="btn primary wide" onClick={onArtist}>Open artist</button><button className="text-button" onClick={onRate}>{grade !== undefined ? "Edit grade" : "Grade artist"}</button></div> : <button className={`btn ${grade !== undefined ? "" : "primary"} wide`} onClick={onRate}>{grade !== undefined ? "Edit Groove Grade" : "Give a Groove Grade"}</button>}</div>
    </article>
  );
}

function Crate({ ratings, openRate, onDelete, goto, openArtist }: { ratings: Rating[]; openRate: (i: CatalogItem) => void; onDelete: (r: Rating) => void; goto: (p: Page) => void; openArtist: (name: string, mbid?: string | null) => void }) {
  const [query, setQuery] = useState("");
  const [type, setType] = useState<"all" | MusicType>("all");
  const [sort, setSort] = useState<Sort>("highest");
  const filtered = useMemo(() => {
    let list = ratings.filter((r) => type === "all" || r.type === type).filter((r) => `${r.title} ${r.artist}`.toLowerCase().includes(query.toLowerCase()));
    list = list.slice().sort((a, b) => sort === "highest" ? (b.overall - a.overall || b.tiebreak - a.tiebreak) : sort === "lowest" ? (a.overall - b.overall || b.tiebreak - a.tiebreak) : sort === "title" ? a.title.localeCompare(b.title) : +new Date(b.updated_at) - +new Date(a.updated_at));
    return list;
  }, [ratings, query, type, sort]);

  return (
    <section className="page">
      <div className="hero-row"><div><h1>My Crate.</h1></div><button className="btn primary" onClick={() => goto("browse")}>＋ Add from Browse</button></div>
      <div className="crate-tools">
        <div className="type-tabs compact-tabs"><button className={type === "all" ? "active" : ""} onClick={() => setType("all")}>All</button>{(["song", "album", "artist"] as MusicType[]).map((t) => <button key={t} className={type === t ? "active" : ""} onClick={() => setType(t)}>{t === "song" ? "Songs" : t === "album" ? "Albums" : "Artists"}</button>)}</div>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search My Crate..." />
        <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}><option value="highest">Highest grade</option><option value="recent">Recently graded</option><option value="title">Title A–Z</option><option value="lowest">Lowest grade</option></select>
      </div>
      {!filtered.length ? <Empty text={ratings.length ? "No ratings match those filters." : "No ratings yet."} /> : (
        <div className="crate-grid">{filtered.map((r, index) => <CrateCard key={`${r.type}-${r.mbid}`} rating={r} rank={sort === "highest" ? index + 1 : undefined} onEdit={() => openRate(r)} onDelete={() => onDelete(r)} onArtist={() => openArtist(r.type === "artist" ? r.title : r.artist, r.type === "artist" ? r.mbid : r.artistMbid)} />)}</div>
      )}
    </section>
  );
}

function CrateCard({ rating, rank, onEdit, onDelete, onArtist }: { rating: Rating; rank?: number; onEdit: () => void; onDelete: () => void; onArtist: () => void }) {
  return <article className="crate-card"><div className="rank-slot">{rank ? `#${rank}` : typeLabel(rating.type)}</div><Cover item={rating} className="crate-cover" /><div className="crate-copy"><span className="pill">{typeLabel(rating.type)}</span><h3>{rating.title}</h3><button className="artist-link" onClick={onArtist}>{rating.type === "artist" ? "View discography" : rating.artist}</button>{rating.review && <blockquote>“{rating.review}”</blockquote>}<div className="crate-actions"><button className="text-button" onClick={onEdit}>Edit</button><button className="text-button danger" onClick={onDelete}>Remove</button></div></div><ScoreRing score={rating.overall} /></article>;
}

function TasteProfile({ ratings, average }: { ratings: Rating[]; average: number }) {
  const categories = ["lyrics", "sound", "uniqueness", "emotion", "production"] as const;
  const averages = categories.map((key) => ({ key, value: ratings.length ? round(ratings.reduce((s, r) => s + r[key], 0) / ratings.length) : 0 })).sort((a, b) => b.value - a.value);
  const typeCounts = (["song", "album", "artist"] as MusicType[]).map((type) => ({ type, count: ratings.filter((r) => r.type === type).length }));
  const [insights, setInsights] = useState<{ genres: string[]; averageYear: number | null; listeningAge: number | null }>({ genres: [], averageYear: null, listeningAge: null });
  const [loadingInsights, setLoadingInsights] = useState(false);

  useEffect(() => {
    if (!ratings.length) { setInsights({ genres: [], averageYear: null, listeningAge: null }); return; }
    let cancelled = false;
    setLoadingInsights(true);
    fetch("/api/music/insights", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ratings: ratings.map((r) => ({ type: r.type, mbid: r.mbid, overall: r.overall, subtitle: r.subtitle })) }) })
      .then((r) => r.json()).then((data) => { if (!cancelled) setInsights({ genres: data.genres || [], averageYear: data.averageYear ?? null, listeningAge: data.listeningAge ?? null }); })
      .catch(() => {}).finally(() => { if (!cancelled) setLoadingInsights(false); });
    return () => { cancelled = true; };
  }, [ratings]);

  return (
    <section className="page">
      <div className="hero-row"><div><h1>Taste Profile.</h1></div></div>
      <div className="stats-grid">
        <Stat label="Average Groove Grade" value={ratings.length ? average.toFixed(1) : "—"} note="Overall mean" />
        <Stat label="Total graded" value={String(ratings.length)} note="Across all types" />
        <Stat label="Listening age" value={insights.listeningAge !== null ? `${insights.listeningAge} yrs` : "—"} note={insights.averageYear ? `Average release year: ${insights.averageYear}` : loadingInsights ? "Reading your crate…" : "Based on release years"} />
        <Stat label="Top genre" value={insights.genres[0] ? capitalize(insights.genres[0]) : "—"} note={loadingInsights ? "Reading your crate…" : "From your highest-rated music"} />
      </div>
      <div className="profile-grid">
        <div className="panel"><h2>What you rate</h2>{typeCounts.map((row) => <Bar key={row.type} label={row.type === "song" ? "Songs" : row.type === "album" ? "Albums" : "Artists"} value={ratings.length ? row.count / ratings.length * 10 : 0} display={String(row.count)} />)}</div>
        <div className="panel"><h2>Favorite genres</h2>{insights.genres.length ? <div className="genre-cloud">{insights.genres.map((genre, index) => <span key={genre} className={index === 0 ? "primary-genre" : ""}>{capitalize(genre)}</span>)}</div> : <p className="panel-muted">{loadingInsights ? "Finding the patterns in your highest-rated music…" : "Rate a few more releases and songs to build this."}</p>}</div>
      </div>
      <div className="panel category-panel"><h2>Category averages</h2><div className="category-bars">{averages.map((row) => <Bar key={row.key} label={row.key === "emotion" ? "Emotional Impact" : capitalize(row.key)} value={row.value} display={ratings.length ? row.value.toFixed(1) : "—"} />)}</div></div>
    </section>
  );
}

function ArtistExplorer({ target, ratings, openRate, openArtist, onBack }: { target: { name: string; mbid?: string | null }; ratings: Rating[]; openRate: (i: CatalogItem) => void; openArtist: (name: string, mbid?: string | null) => void; onBack: () => void }) {
  const [data, setData] = useState<{ artist: CatalogItem; genres: string[]; albums: CatalogItem[] } | null>(null);
  const [albumTarget, setAlbumTarget] = useState<CatalogItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false; setLoading(true); setError(""); setAlbumTarget(null);
    const params = new URLSearchParams(); if (target.mbid) params.set("mbid", target.mbid); else params.set("name", target.name);
    fetch(`/api/music/artist?${params}`).then(async (r) => { const json = await r.json(); if (!r.ok) throw new Error(json.error || "Could not load artist"); return json; }).then((json) => { if (!cancelled) setData(json); }).catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : "Could not load artist"); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [target.name, target.mbid]);

  if (albumTarget) return <AlbumExplorer album={albumTarget} ratings={ratings} openRate={openRate} onBack={() => setAlbumTarget(null)} openArtist={openArtist} />;
  if (loading) return <section className="page"><button className="text-button back-link" onClick={onBack}>← Back</button><div className="artist-loading">Loading discography…</div></section>;
  if (error || !data) return <section className="page"><button className="text-button back-link" onClick={onBack}>← Back</button><div className="error-box">{error || "Artist unavailable."}</div></section>;
  const existing = ratings.find((r) => r.type === "artist" && r.mbid === data.artist.mbid);
  return (
    <section className="page">
      <button className="text-button back-link" onClick={onBack}>← Back to Browse</button>
      <div className="artist-hero"><Cover item={data.artist} className="artist-hero-cover" /><div><span className="pill">Artist</span><h1>{data.artist.title}</h1>{data.genres.length ? <div className="genre-cloud compact">{data.genres.slice(0, 5).map((g) => <span key={g}>{capitalize(g)}</span>)}</div> : null}<button className={`btn ${existing ? "" : "primary"}`} onClick={() => openRate(data.artist)}>{existing ? `Edit artist grade · ${existing.overall.toFixed(1)}` : "Grade artist"}</button></div></div>
      <div className="section-head"><div><h2>Discography</h2></div></div>
      {!data.albums.length ? <Empty text="No releases found." /> : <div className="catalog-grid">{data.albums.map((album) => { const grade = ratings.find((r) => r.type === "album" && r.mbid === album.mbid)?.overall; return <DiscographyCard key={album.mbid} item={album} grade={grade} onOpen={() => setAlbumTarget(album)} onRate={() => openRate(album)} />; })}</div>}
    </section>
  );
}

function DiscographyCard({ item, grade, onOpen, onRate }: { item: CatalogItem; grade?: number; onOpen: () => void; onRate: () => void }) {
  return <article className="catalog-card"><button className="cover-button" onClick={onOpen}><Cover item={item} /></button><div className="card-copy"><div className="card-top"><span className="pill">Album</span>{grade !== undefined && <span className="mini-grade">{grade.toFixed(1)}</span>}</div><h3>{item.title}</h3><p>{item.subtitle}</p><div className="disc-actions"><button className="btn primary wide" onClick={onOpen}>Open album</button><button className="text-button" onClick={onRate}>{grade !== undefined ? "Edit grade" : "Grade album"}</button></div></div></article>;
}

function AlbumExplorer({ album, ratings, openRate, onBack, openArtist }: { album: CatalogItem; ratings: Rating[]; openRate: (i: CatalogItem) => void; onBack: () => void; openArtist: (name: string, mbid?: string | null) => void }) {
  const [data, setData] = useState<{ album: CatalogItem; tracks: CatalogItem[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false; setLoading(true); setError("");
    fetch(`/api/music/album?id=${encodeURIComponent(album.mbid)}`).then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error || "Could not load album"); return j; }).then((j) => { if (!cancelled) setData(j); }).catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : "Could not load album"); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [album.mbid]);
  if (loading) return <section className="page"><button className="text-button back-link" onClick={onBack}>← Discography</button><div className="artist-loading">Loading tracks…</div></section>;
  if (error || !data) return <section className="page"><button className="text-button back-link" onClick={onBack}>← Discography</button><div className="error-box">{error || "Album unavailable."}</div></section>;
  const albumGrade = ratings.find((r) => r.type === "album" && r.mbid === data.album.mbid)?.overall;
  return <section className="page"><button className="text-button back-link" onClick={onBack}>← {data.album.artist} discography</button><div className="album-hero"><Cover item={data.album} className="album-hero-cover" /><div><span className="pill">Album</span><h1>{data.album.title}</h1><button className="artist-link large" onClick={() => openArtist(data.album.artist, data.album.artistMbid)}>{data.album.artist}</button><p>{data.album.subtitle}</p><button className={`btn ${albumGrade !== undefined ? "" : "primary"}`} onClick={() => openRate(data.album)}>{albumGrade !== undefined ? `Edit album grade · ${albumGrade.toFixed(1)}` : "Grade album"}</button></div></div><div className="section-head"><div><h2>Tracks</h2></div></div>{data.tracks.length ? <div className="track-list">{data.tracks.map((track, index) => { const grade = ratings.find((r) => r.type === "song" && r.mbid === track.mbid)?.overall; return <div className="track-row" key={`${track.mbid}-${index}`}><span className="track-number">{index + 1}</span><div className="track-title"><strong>{track.title}</strong><span>{track.artist}</span></div>{grade !== undefined ? <ScoreRing score={grade} compact /> : <span className="unrated">—</span>}<button className={`btn ${grade === undefined ? "primary" : ""}`} onClick={() => openRate(track)}>{grade !== undefined ? "Edit" : "Grade"}</button></div>; })}</div> : <Empty text="No track list was available for this release." />}</section>;
}

function ScoreRing({ score, compact = false }: { score: number; compact?: boolean }) {
  const color = scoreColor(score);
  const pct = Math.max(0, Math.min(100, score * 10));
  return <div className={`score-ring ${compact ? "compact" : ""}`} style={{ background: `conic-gradient(${color} 0 ${pct}%, var(--soft) ${pct}% 100%)` }}><div><strong>{score.toFixed(1)}</strong>{!compact && <span>GRADE</span>}</div></div>;
}

function RatingModal({ item, existing, onClose, onSave }: { item: CatalogItem; existing: Rating | null; onClose: () => void; onSave: (rating: Rating) => Promise<void> }) {
  const initial = existing || { ...item, ...DEFAULT_SCORES, review: "", created_at: nowIso(), updated_at: nowIso() };
  const [scores, setScores] = useState({ overall: initial.overall, lyrics: initial.lyrics, sound: initial.sound, uniqueness: initial.uniqueness, emotion: initial.emotion, production: initial.production, tiebreak: initial.tiebreak });
  const [review, setReview] = useState(initial.review);
  const [saving, setSaving] = useState(false);
  const categories = [["lyrics", "Lyrics"], ["sound", "Sound"], ["uniqueness", "Uniqueness"], ["emotion", "Emotional Impact"], ["production", "Production"]] as const;
  async function submit() {
    setSaving(true);
    await onSave({ ...item, ...scores, review: review.trim(), created_at: existing?.created_at || nowIso(), updated_at: nowIso() });
    setSaving(false);
  }
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.currentTarget === e.target && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={`Grade ${item.title}`}>
        <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        <div className="modal-item"><Cover item={item} className="modal-cover" /><div><span className="pill">{typeLabel(item.type)}</span><h2>{item.title}</h2><p>{item.artist}</p><small>{item.subtitle}</small></div></div>
        <div className="main-slider"><div className="slider-heading"><div><h3>Groove Grade</h3></div><output>{scores.overall.toFixed(1)}</output></div><input type="range" min="0" max="10" step="0.1" value={scores.overall} onChange={(e) => setScores({ ...scores, overall: +e.target.value })} /></div>
        <div className="category-grid">{categories.map(([key, label]) => <Slider key={key} label={label} value={scores[key]} onChange={(v) => setScores({ ...scores, [key]: v })} />)}</div>
        <div className="tiebreak-field"><div><strong>Tie-break priority</strong><span>Only used when two items have the exact same Groove Grade.</span></div><div className="tiebreak-control"><input type="range" min="0" max="100" step="1" value={scores.tiebreak} onChange={(e) => setScores({ ...scores, tiebreak: +e.target.value })} /><output>{scores.tiebreak}</output></div></div>
        <label className="review-field"><span>Review / listening notes</span><textarea value={review} onChange={(e) => setReview(e.target.value)} placeholder="What worked? What didn’t? What keeps pulling you back?" maxLength={1200} /></label>
        <div className="modal-footer"><span className="fine-print">Scores are private to your account in this first version.</span><div><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={submit} disabled={saving}>{saving ? "Saving…" : existing ? "Update grade" : "Add to My Crate"}</button></div></div>
      </div>
    </div>
  );
}

function Slider({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return <label className="category-slider"><span>{label}<output>{value.toFixed(1)}</output></span><input type="range" min="0" max="10" step="0.1" value={value} onChange={(e) => onChange(+e.target.value)} /></label>;
}

function AuthModal({ onClose, onNotify }: { onClose: () => void; onNotify: (m: string) => void }) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true);
    const supabase = getSupabase();
    if (!supabase) { setBusy(false); return; }
    const result = mode === "signin" ? await supabase.auth.signInWithPassword({ email, password }) : await supabase.auth.signUp({ email, password });
    setBusy(false);
    if (result.error) return onNotify(result.error.message);
    if (mode === "signup" && !result.data.session) onNotify("Account created. Check your email if confirmation is enabled.");
    else onNotify(mode === "signin" ? "Signed in." : "Account created.");
    onClose();
  }
  return <div className="modal-backdrop"><form className="auth-modal" onSubmit={submit}><button type="button" className="modal-close" onClick={onClose}>×</button><Logo compact /><div><h2>{mode === "signin" ? "Sign in to GROOVED" : "Create your GROOVED account"}</h2><p>Sync your ratings and reviews across devices.</p></div><label>Email<input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" /></label><label>Password<input type="password" minLength={6} required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 6 characters" /></label><button className="btn primary wide" disabled={busy}>{busy ? "Working…" : mode === "signin" ? "Sign in" : "Create account"}</button><button type="button" className="text-button auth-switch" onClick={() => setMode(mode === "signin" ? "signup" : "signin")}>{mode === "signin" ? "Need an account? Sign up" : "Already have an account? Sign in"}</button></form></div>;
}

function SettingsPage({ theme, setTheme }: { theme: Theme; setTheme: (theme: Theme) => void }) {
  const themes: Array<{ id: Theme; name: string; note: string; swatches: string[] }> = [
    { id: "grooved", name: "Original", note: "Cream, charcoal, lime", swatches: ["#f6f3e9", "#20231d", "#d7f36a"] },
    { id: "midnight", name: "Midnight", note: "Ink, graphite, electric lime", swatches: ["#11130f", "#24271f", "#c9ee54"] },
    { id: "rust", name: "Warm Vinyl", note: "Ivory, espresso, burnt orange", swatches: ["#f4ede1", "#322821", "#d87b49"] },
    { id: "ocean", name: "Deep Blue", note: "Mist, navy, sea green", swatches: ["#eef3ef", "#17252c", "#66c8a4"] },
  ];
  return <section className="page"><div className="hero-row"><div><h1>Settings.</h1></div></div><div className="panel"><h2>Color scheme</h2><div className="theme-grid">{themes.map((item) => <button key={item.id} className={`theme-card ${theme === item.id ? "active" : ""}`} onClick={() => setTheme(item.id)}><div className="theme-swatches">{item.swatches.map((color) => <i key={color} style={{ background: color }} />)}</div><strong>{item.name}</strong><span>{item.note}</span>{theme === item.id && <b>Selected</b>}</button>)}</div></div></section>;
}

function RatingRow({ rating, onClick }: { rating: Rating; onClick: () => void }) {
  return <button className="rating-row" onClick={onClick}><Cover item={rating} className="row-cover" /><div><strong>{rating.title}</strong><span>{rating.artist} · {typeLabel(rating.type)}</span></div><b>{rating.overall.toFixed(1)}</b><span>›</span></button>;
}
function Stat({ label, value, note }: { label: string; value: string; note: string }) { return <div className="stat"><span>{label}</span><strong>{value}</strong><small>{note}</small></div>; }
function Empty({ text }: { text: string }) { return <div className="empty-state"><div className="empty-vinyl small"><span /></div><h3>Nothing here yet.</h3><p>{text}</p></div>; }
function Bar({ label, value, display }: { label: string; value: number; display: string }) { return <div className="bar-row"><span>{label}</span><div><i style={{ width: `${Math.min(100, Math.max(0, value * 10))}%` }} /></div><strong>{display}</strong></div>; }
function capitalize(s: string) { return s.charAt(0).toUpperCase() + s.slice(1); }

function scoreColor(score: number) {
  const clamped = Math.max(0, Math.min(10, score));
  const hue = clamped <= 5 ? clamped * 9.5 : 47.5 + (clamped - 5) * 14.5;
  const lightness = clamped >= 8 ? 34 : 43;
  return `hsl(${hue} 66% ${lightness}%)`;
}
function favoriteArtistNames(ratings: Rating[]) {
  const map = new Map<string, { score: number; count: number }>();
  for (const r of ratings) {
    const name = (r.type === "artist" ? r.title : r.artist).trim();
    if (!name || name.toLowerCase() === "unknown artist") continue;
    const current = map.get(name) || { score: 0, count: 0 };
    current.score += r.overall + Math.max(0, r.overall - 7) * 0.6;
    current.count += 1;
    map.set(name, current);
  }
  return [...map.entries()].sort((a, b) => (b[1].score / b[1].count + Math.min(2, b[1].count * .25)) - (a[1].score / a[1].count + Math.min(2, a[1].count * .25))).slice(0, 5).map(([name]) => name);
}

function dbRowToRating(row: any): Rating {
  return { id: row.id, mbid: row.mbid, type: row.entity_type, title: row.title, artist: row.artist, subtitle: row.subtitle || undefined, releaseGroupMbid: row.release_group_mbid, coverUrl: row.cover_url, overall: Number(row.overall), lyrics: Number(row.lyrics), sound: Number(row.melody), uniqueness: Number(row.vocals), emotion: Number(row.emotion), production: Number(row.production), tiebreak: Number(row.tiebreak ?? 50), review: row.review || "", created_at: row.created_at, updated_at: row.updated_at };
}
function ratingToDbRow(rating: Rating, userId: string) {
  return { user_id: userId, entity_type: rating.type, mbid: rating.mbid, title: rating.title, artist: rating.artist, subtitle: rating.subtitle || null, release_group_mbid: rating.releaseGroupMbid || null, cover_url: rating.coverUrl || null, overall: rating.overall, lyrics: rating.lyrics, production: rating.production, melody: rating.sound, vocals: rating.uniqueness, emotion: rating.emotion, tiebreak: rating.tiebreak, review: rating.review, updated_at: rating.updated_at };
}
