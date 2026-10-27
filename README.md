# GROOVED

GROOVED is a private-first music rating app built around a vinyl collection metaphor.

- **Browse** searches MusicBrainz for songs, albums, and artists.
- **Cover Art Archive** supplies real release artwork where available.
- **My Crate** stores everything you rate.
- **Groove Grade** is a 0.0–10.0 overall score with sliders for lyrics, production, melody, vocals, and emotional impact.
- **Taste Profile** summarizes your ratings without inventing preferences.
- **Supabase** provides accounts and persistent cloud storage.

## 1. Create a Supabase project

Create a project at Supabase, open the SQL Editor, and run `supabase/schema.sql`.

In Authentication settings, choose whether email confirmation is required. For a private first build, you can keep it enabled or disable it while testing.

## 2. Configure environment variables

Copy `.env.example` to `.env.local` and set:

```bash
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=...
MUSICBRAINZ_CONTACT=your-real-contact-email@example.com
```

`MUSICBRAINZ_CONTACT` is used in GROOVED's identifying User-Agent. MusicBrainz asks applications to identify themselves and limits normal clients to roughly one request per second, so Browse uses explicit search submission and server-side caching.

If Supabase values are omitted, the app runs in **local preview mode** and stores ratings in localStorage. That is useful for design testing, but it is not the production database.

## 3. Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## 4. Deploy

The project is structured for Vercel. Add the same three environment variables in the Vercel project settings, then deploy.

## Database/privacy model

GROOVED v1 is private-first. Supabase Row Level Security is enabled so an authenticated user can select, insert, update, or delete only their own rating rows.

## Catalog note

GROOVED does **not** duplicate the entire MusicBrainz database into Supabase. MusicBrainz remains the source catalog, while Supabase stores GROOVED-specific user data. That avoids maintaining millions of music records and keeps the first version simpler.

## v1 limitations

- Cover Art Archive supplies release art, but some MusicBrainz entries have no cover image.
- Artist photography is intentionally not scraped; artist cards use the GROOVED vinyl fallback.
- Search is appropriate for an early/private release. A large public launch should add shared distributed rate limiting/cache in front of MusicBrainz.
- Social profiles, public reviews, follows, and community aggregate scores are intentionally deferred.


## v0.4 upgrade
If this project already uses the earlier GROOVED Supabase database, run `supabase/migration_v04.sql` once in the Supabase SQL Editor. This adds the user-controlled tie-break priority. Existing Melody values are carried forward as Sound and existing Vocals values are carried forward as Uniqueness.

## Launch polish changes

- Browser tab title is now simply `GROOVED`.
- Browse keeps each Songs / Albums / Artists tab's query and results when switching.
- Repeated searches are cached in the browser during the session.
- In-flight searches are cancelled when a new one replaces them, reducing glitchy result flashes.
- ListenBrainz popularity enrichment has a short timeout so it improves ranking without holding search hostage.
- Recommendations rotate across the user's highest-rated artists, avoid already-rated artists, and intentionally sample deeper similar-artist results for discovery.
- Song of the Day and Artist of the Week include Shuffle buttons for on-demand alternatives.
