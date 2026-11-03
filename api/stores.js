// Server-Funktion (Vercel): nächste Filiale je Supermarkt-Kette mit Adresse und Entfernung.
// Quelle: Photon (komoot) mit OpenStreetMap-Daten (© OpenStreetMap-Mitwirkende, ODbL).
// Es gehen nur auf ca. 1 km gerundete Koordinaten weiter; Ergebnisse werden 7 Tage zwischengespeichert.
const CHAINS = {
  'Lidl': { q: 'Lidl', re: /\blidl\b/i },
  'Aldi Süd': { q: 'Aldi', re: /\baldi\b/i },
  'Aldi Nord': { q: 'Aldi', re: /\baldi\b/i },
  'Kaufland': { q: 'Kaufland', re: /kaufland/i },
  'Penny': { q: 'Penny', re: /\bpenny\b/i },
  'Netto': { q: 'Netto Marken-Discount', re: /\bnetto\b/i },
  'Norma': { q: 'Norma', re: /\bnorma\b/i },
  'Rewe': { q: 'Rewe', re: /\brewe\b/i },
  'Edeka': { q: 'Edeka', re: /edeka|e center|marktkauf/i }
};

function km(a, b, c, d) {
  const r = Math.PI / 180, x = (d - b) * r * Math.cos(((a + c) / 2) * r), y = (c - a) * r;
  return Math.sqrt(x * x + y * y) * 6371;
}

async function nearest(chain, lat, lng) {
  const c = CHAINS[chain];
  // Nur Treffer im Umkreis von ca. 20 km (bbox), stark nach Nähe gewichtet; danach selbst nach Entfernung sortiert
  const bbox = [lng - 0.3, lat - 0.2, lng + 0.3, lat + 0.2].map(v => v.toFixed(3)).join(',');
  const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(c.q)}&lat=${lat}&lon=${lng}&limit=30&osm_tag=shop:supermarket&lang=de&zoom=14&location_bias_scale=0.1&bbox=${bbox}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'FastUmsonst/1.0 (https://fastumsonst.vercel.app)' }, signal: ctrl.signal });
    if (!r.ok) throw new Error('photon ' + r.status);
    const j = await r.json();
    const list = (j.features || []).map(f => {
      const p = f.properties || {}, g = (f.geometry || {}).coordinates || [];
      return { name: p.name || chain, street: p.street || '', nr: p.housenumber || '', zip: p.postcode || '', city: p.city || p.town || p.village || '', lat: g[1], lng: g[0] };
    }).filter(s => c.re.test(s.name) && isFinite(s.lat) && isFinite(s.lng))
      .map(s => Object.assign(s, { km: Math.round(km(lat, lng, s.lat, s.lng) * 10) / 10 }))
      .filter(s => s.km <= 30)
      .sort((a, b) => a.km - b.km);
    return list[0] || null;
  } finally { clearTimeout(t); }
}

export default async function handler(req, res) {
  const lat = parseFloat(req.query.lat), lng = parseFloat(req.query.lng);
  if (!isFinite(lat) || !isFinite(lng) || lat < 47 || lat > 56 || lng < 5 || lng > 16) {
    return res.status(400).json({ ok: false, message: 'Standort fehlt oder liegt nicht in Deutschland.' });
  }
  const la = +lat.toFixed(2), ln = +lng.toFixed(2);
  const wanted = String(req.query.chains || '').split(',').map(s => s.trim()).filter(s => CHAINS[s]).slice(0, 10);
  if (!wanted.length) return res.status(400).json({ ok: false, message: 'Keine Kette angegeben.' });
  const out = {}; const errors = [];
  // Höchstens 3 Anfragen gleichzeitig, bei Fehler einmal kurz warten und neu versuchen
  const queue = wanted.slice();
  const work = async () => {
    while (queue.length) {
      const ch = queue.shift();
      try { out[ch] = await nearest(ch, la, ln); }
      catch (e) {
        await new Promise(r => setTimeout(r, 700));
        try { out[ch] = await nearest(ch, la, ln); }
        catch (e2) { errors.push(ch + ': ' + (e2.name === 'AbortError' ? 'Zeitüberschreitung' : e2.message)); }
      }
    }
  };
  await Promise.all([work(), work(), work()]);
  res.setHeader('Cache-Control', errors.length ? 'no-store' : 's-maxage=604800, stale-while-revalidate=86400');
  return res.status(200).json({ ok: true, stores: out, info: errors.join('; ') || undefined });
}
