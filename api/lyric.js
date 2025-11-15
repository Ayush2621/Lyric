// /api/lyrics.js
// Minimal backend lyrics proxy for Vercel (Node runtime).
// This endpoint attempts a best-effort lyrics extraction.
// Note: keep it simple to avoid scraping complexity.

import fetch from "node-fetch";

export default async function handler(req, res) {
  const { artist, title } = req.query;
  if (!artist || !title) {
    return res.status(400).json({ error: "Missing artist or title" });
  }

  try {
    // We'll try lyrics.ovh first (simple)
    const ovhURL = `https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`;
    const ovhResp = await fetch(ovhURL);
    if (ovhResp.ok) {
      const ovhJson = await ovhResp.json();
      if (ovhJson && ovhJson.lyrics) {
        return res.status(200).json({ artist, title, lyrics: ovhJson.lyrics });
      }
    }

    // Fallback: search Google textise and try to extract textual content (best-effort)
    const query = encodeURIComponent(`${artist} ${title} lyrics`);
    const googleProxy = `https://textise.net/showtext.aspx?strURL=https://www.google.com/search?q=${query}+lyrics`;
    const gresp = await fetch(googleProxy);
    if (gresp.ok) {
      const html = await gresp.text();
      const cleaned = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
                          .replace(/<\/?[^>]+(>|$)/g, '')
                          .replace(/\n{2,}/g, '\n')
                          .trim();
      // Heuristic: pick large block of text after the word "lyrics"
      const lower = cleaned.toLowerCase();
      const pos = lower.indexOf('lyrics');
      let result = cleaned;
      if (pos > -1) {
        result = cleaned.substring(pos + 6).trim();
      }
      if (result && result.length > 50) {
        return res.status(200).json({ artist, title, lyrics: result });
      }
    }

    // Last fallback
    return res.status(200).json({ artist, title, lyrics: 'Lyrics not found.' });
  } catch (err) {
    console.error('lyrics api error', err);
    res.status(500).json({ error: 'Lyrics fetch failed' });
  }
}
