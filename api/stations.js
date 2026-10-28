// Server-Funktion (Vercel): holt echte Spritpreise von Tankerkönig.
export default async function handler(req, res) {
  const lat = parseFloat(req.query.lat);
  const lng = parseFloat(req.query.lng);
  const rad = Math.min(Math.max(parseFloat(req.query.rad) || 5, 1), 25);

  if (!isFinite(lat) || !isFinite(lng) || lat < 47 || lat > 56 || lng < 5 || lng > 16) {
    return res.status(400).json({ ok: false, message: 'Standort fehlt oder liegt nicht in Deutschland.' });
  }
  const key = process.env.TANKERKOENIG_KEY;
  if (!key) {
    return res.status(500).json({ ok: false, message: 'TANKERKOENIG_KEY ist nicht eingerichtet.' });
  }

  const la = lat.toFixed(2);
  const ln = lng.toFixed(2);
  const url = `https://creativecommons.tankerkoenig.de/json/list.php?lat=${la}&lng=${ln}&rad=${rad}&sort=dist&type=all&apikey=${encodeURIComponent(key)}`;

  try {
    const r = await fetch(url);
    const data = await r.json();
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=120');
    return res.status(200).json(data);
  } catch (e) {
    return res.status(502).json({ ok: false, message: 'Tankerkönig ist gerade nicht erreichbar.' });
  }
}
