// Server-Funktion (Vercel): erkennt, ob am Standort Aldi Nord oder Aldi Süd gilt.
// Grundlage: die nächstgelegenen Aldi-Filialen in OpenStreetMap (© OpenStreetMap-Mitwirkende, ODbL).
// Es werden nur auf ca. 1 km gerundete Koordinaten weitergegeben.
const NORD = 'Q41171373', SUED = 'Q41171672';

function zoneOf(t) {
  const wd = t['brand:wikidata'] || '';
  if (wd.includes(NORD)) return 'nord';
  if (wd.includes(SUED)) return 'sued';
  const s = [t.brand, t.name, t.operator, t.website, t['brand:website']].filter(Boolean).join(' ').toLowerCase();
  if (/aldi[\s-]*nord|aldi-nord\.de/.test(s)) return 'nord';
  if (/aldi[\s-]*s(ü|ue|u)d|aldi-sued\.de/.test(s)) return 'sued';
  return null;
}

// Grobe Schätzung, falls OpenStreetMap nicht erreichbar ist. In der Grenzregion: unbekannt.
function rough(lat, lng) {
  if (lat >= 51.9) return 'nord';
  if (lng >= 10.4 && lat >= 50.3) return 'nord';   // Thüringen, Sachsen, Sachsen-Anhalt, Brandenburg, Berlin
  if (lat <= 50.3) return 'sued';
  return null;
}

function km(a, b, c, d) {
  const r = Math.PI / 180, x = (d - b) * r * Math.cos(((a + c) / 2) * r), y = (c - a) * r;
  return Math.sqrt(x * x + y * y) * 6371;
}

export default async function handler(req, res) {
  const lat = parseFloat(req.query.lat), lng = parseFloat(req.query.lng);
  if (!isFinite(lat) || !isFinite(lng) || lat < 47 || lat > 56 || lng < 5 || lng > 16) {
    return res.status(400).json({ ok: false, message: 'Standort fehlt oder liegt nicht in Deutschland.' });
  }
  const la = +lat.toFixed(2), ln = +lng.toFixed(2);
  const q = `[out:json][timeout:20];nwr["shop"="supermarket"]["brand"~"aldi",i](around:25000,${la},${ln});out center tags 60;`;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    const r = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'FastUmsonst/1.0 (fastumsonst.vercel.app)' },
      body: 'data=' + encodeURIComponent(q),
      signal: ctrl.signal
    });
    clearTimeout(timer);
    if (!r.ok) throw new Error('overpass ' + r.status);
    const j = await r.json();
    const found = (j.elements || []).map(e => {
      const p = e.center || e;
      return { zone: zoneOf(e.tags || {}), d: km(la, ln, p.lat, p.lon) };
    }).filter(x => x.zone && isFinite(x.d)).sort((a, b) => a.d - b.d);
    if (found.length) {
      // Die nächsten drei Filialen entscheiden (Mehrheit), damit ein falscher Eintrag nicht stört.
      const top = found.slice(0, 3);
      const n = top.filter(x => x.zone === 'nord').length;
      const zone = n * 2 > top.length ? 'nord' : 'sued';
      res.setHeader('Cache-Control', 's-maxage=604800, stale-while-revalidate=86400');
      return res.status(200).json({ ok: true, zone, source: 'osm', nearestKm: Math.round(found[0].d * 10) / 10 });
    }
    throw new Error('keine Filiale gefunden');
  } catch (e) {
    const zone = rough(la, ln);
    res.setHeader('Cache-Control', 's-maxage=3600');
    return res.status(200).json({ ok: true, zone, source: 'grob' });
  }
}
