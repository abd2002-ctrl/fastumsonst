// Automatische Prüfung (wird von Supabase alle 30 Minuten aufgerufen):
// prüft Tank-Alarme und Sprit-Preisalarme und schickt Push-Benachrichtigungen.
import webpush from 'web-push';
import { createClient } from '@supabase/supabase-js';

export const config = { maxDuration: 60 };

const SUPABASE_URL = 'https://ejnhcduokkjfubgildyy.supabase.co';
const VAPID_PUBLIC = 'BLLNu7AkOUtEwNouUgIEQsaz2tS4cCBgFrFefBz1mp2Ku4E9qvl4dlSxE2wq4rREBP7KrElu4MIGVlsrKhBZF0k';
const FUEL_NAME = { e5: 'Super E5', e10: 'Super E10', diesel: 'Diesel' };
const HOUR = 3600e3;

const berlinHour = () => Number(new Intl.DateTimeFormat('de-DE', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Europe/Berlin' }).format(new Date()));
const price = p => p.toFixed(3).replace('.', ',');

export default async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ ok: false });
  }
  const missing = ['SUPABASE_SECRET_KEY', 'VAPID_PRIVATE_KEY', 'TANKERKOENIG_KEY', 'CRON_SECRET'].filter(k => !process.env[k]);
  if (missing.length) return res.status(500).json({ ok: false, missing });

  webpush.setVapidDetails('mailto:fastumsonst.app@gmx.de', VAPID_PUBLIC, process.env.VAPID_PRIVATE_KEY);
  const db = createClient(SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
  const now = Date.now();
  const hour = berlinHour();
  const stats = { tank: 0, price: 0, sent: 0, removed: 0 };

  // Tankerkönig nur einmal pro Ort und Lauf abfragen
  const cache = new Map();
  async function stationsNear(lat, lng, rad = 5) {
    const key = `${(+lat).toFixed(2)},${(+lng).toFixed(2)},${rad}`;
    if (!cache.has(key)) {
      cache.set(key, (async () => {
        const url = `https://creativecommons.tankerkoenig.de/json/list.php?lat=${(+lat).toFixed(2)}&lng=${(+lng).toFixed(2)}&rad=${rad}&sort=dist&type=all&apikey=${encodeURIComponent(process.env.TANKERKOENIG_KEY)}`;
        try { const j = await (await fetch(url)).json(); return j.ok ? j.stations : []; } catch { return []; }
      })());
    }
    return cache.get(key);
  }
  function cheapest(list, fuel) {
    return list.filter(s => s.isOpen && typeof s[fuel] === 'number' && s[fuel] > 0).sort((a, b) => a[fuel] - b[fuel])[0];
  }
  const stationName = s => [s.brand, s.street].filter(Boolean).join(' ') || s.name;

  async function send(userId, payload) {
    const { data: subs } = await db.from('push_subscriptions').select('*').eq('user_id', userId);
    let delivered = false;
    for (const s of subs || []) {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { TTL: 6 * 3600 });
        delivered = true; stats.sent++;
      } catch (e) {
        if (e.statusCode === 404 || e.statusCode === 410) {
          await db.from('push_subscriptions').delete().eq('endpoint', s.endpoint); stats.removed++;
        }
      }
    }
    return delivered;
  }

  // 1) Tank-Alarm: nachmittags/abends, damit man noch am selben Abend günstig tanken kann
  if (hour >= 16 && hour < 19) {
    const { data: rows } = await db.from('settings').select('*').eq('tank_alarm', true).not('tank_at', 'is', null).not('home_lat', 'is', null);
    for (const r of rows || []) {
      const days = (now - new Date(r.tank_at).getTime()) / (24 * HOUR);
      const liters = Math.max(0, r.tank_liters - days * (r.week_km / 7) * r.cons / 100);
      const reach = liters / r.cons * 100;
      const pct = liters / r.tank_l * 100;
      if (!(pct < 25 || reach < 120)) continue;
      const last = r.tank_notified_at ? new Date(r.tank_notified_at).getTime() : 0;
      // nur einmal pro Tankfüllung, bei Bedarf alle 2 Tage erinnern
      if (last > new Date(r.tank_at).getTime() && now - last < 48 * HOUR) continue;
      const best = cheapest(await stationsNear(r.home_lat, r.home_lng), r.fuel);
      const body = best
        ? `Noch ca. ${Math.round(reach)} km im Tank. Am günstigsten gerade: ${stationName(best)}, ${price(best[r.fuel])} €/l (${best.dist.toFixed(1).replace('.', ',')} km). Abends ist es meist am billigsten.`
        : `Noch ca. ${Math.round(reach)} km im Tank. Tank am besten heute Abend, dann sind die Preise meist am niedrigsten.`;
      if (await send(r.user_id, { title: 'Zeit zum Tanken', body, url: '/#tanken', tag: 'tank' })) {
        await db.from('settings').update({ tank_notified_at: new Date().toISOString() }).eq('user_id', r.user_id);
        stats.tank++;
      }
    }
  }

  // 2) Sprit-Preisalarm: tagsüber, höchstens alle 12 Stunden pro Alarm
  if (hour >= 7 && hour < 22) {
    const since = new Date(now - 12 * HOUR).toISOString();
    const { data: alerts } = await db.from('price_alerts').select('*').eq('active', true).or(`last_notified_at.is.null,last_notified_at.lt."${since}"`);
    for (const a of alerts || []) {
      const best = cheapest(await stationsNear(a.lat, a.lng, a.radius), a.fuel);
      if (!best || best[a.fuel] > Number(a.max_price)) continue;
      const body = `${FUEL_NAME[a.fuel]} für ${price(best[a.fuel])} €/l bei ${stationName(best)} (${best.dist.toFixed(1).replace('.', ',')} km). Dein Wunschpreis: ${Number(a.max_price).toFixed(2).replace('.', ',')} €.`;
      if (await send(a.user_id, { title: 'Wunschpreis erreicht', body, url: '/#tanken', tag: 'price-' + a.id })) {
        await db.from('price_alerts').update({ last_notified_at: new Date().toISOString() }).eq('id', a.id);
        stats.price++;
      }
    }
  }

  return res.status(200).json({ ok: true, hour, ...stats });
}
