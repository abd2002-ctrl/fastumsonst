// Server-Funktion (Vercel): liefert die eigenen Produkt- und Rezeptbilder aus.
// Die Bilder liegen beim Bilddienst; wir reichen sie durch, damit Nutzer nur mit unserem Server sprechen.
// Vercel speichert die Antwort zwischen, der Bilddienst wird also kaum abgefragt.
const BASE = 'https://d8j0ntlcm91z4.cloudfront.net/user_3KgE92ztvLsVqdQHuo5XelGkY1Y/';
const OK = /^hf_\d{8}_\d{6}_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(_min\.webp|\.png)$/;

export default async function handler(req, res) {
  const f = String(req.query.f || '');
  if (!OK.test(f)) return res.status(400).send('Ungültiges Bild');
  try {
    const r = await fetch(BASE + f);
    if (!r.ok) return res.status(404).send('Bild nicht gefunden');
    const buf = Buffer.from(await r.arrayBuffer());
    res.setHeader('Content-Type', f.endsWith('.png') ? 'image/png' : 'image/webp');
    res.setHeader('Cache-Control', 'public, max-age=31536000, s-maxage=31536000, immutable');
    return res.status(200).send(buf);
  } catch (e) {
    return res.status(502).send('Bild gerade nicht erreichbar');
  }
}
