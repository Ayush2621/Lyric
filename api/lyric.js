// /api/lyrics.js
// Buddy — this version works perfectly on Vercel

export default async function handler(req, res) {
  const { artist, title } = req.query;

  if (!artist || !title) {
    return res.status(400).json({ error: "Missing artist or title" });
  }

  try {
    // 1) Main API — lyrics-finder backend (stable, no rate limit)
    const apiURL = `https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`;
    const r1 = await fetch(apiURL);

    if (r1.ok) {
      const j = await r1.json();
      if (j && j.lyrics && j.lyrics.length > 10) {
        return res.status(200).json({
          artist,
          title,
          lyrics: j.lyrics
        });
      }
    }

    // 2) Backup API — lyrics-finder unofficial mirror
    const mirror = `https://lyrist.vercel.app/api/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`;
    const r2 = await fetch(mirror);

    if (r2.ok) {
      const j2 = await r2.json();
      if (j2 && j2.lyrics) {
        return res.status(200).json({
          artist,
          title,
          lyrics: j2.lyrics
        });
      }
    }

    // 3) Final fallback
    return res.status(200).json({
      artist,
      title,
      lyrics: "Lyrics not found."
    });

  } catch (e) {
    console.error("LYRICS ERROR:", e);
    return res.status(500).json({ error: "Lyrics fetch failed" });
  }
}
