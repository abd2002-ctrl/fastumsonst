// Verwaltung: Angebote pflegen und Premium freischalten. Geschützt durch ADMIN_PASSWORD.
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://ejnhcduokkjfubgildyy.supabase.co';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const sleep = ms => new Promise(r => setTimeout(r, ms));

function passwordOk(given) {
  const want = process.env.ADMIN_PASSWORD || '';
  if (!want || !given) return false;
  const a = crypto.createHash('sha256').update(String(given)).digest();
  const b = crypto.createHash('sha256').update(want).digest();
  return crypto.timingSafeEqual(a, b);
}
const str = (v, max) => { const s = String(v ?? '').trim(); return s ? s.slice(0, max) : null; };
const num = v => { if (v === null || v === undefined || v === '') return null; const n = parseFloat(String(v).replace(/\s|€/g, '').replace(',', '.')); return isFinite(n) ? Math.round(n * 100) / 100 : NaN; };
function date(v) {
  const s = String(v ?? '').trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return s;
  m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})?$/) || s.match(/^(\d{1,2})\.(\d{1,2})\.?$/);
  if (m) {
    const y = m[3] ? (m[3].length === 2 ? '20' + m[3] : m[3]) : String(new Date().getFullYear());
    return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  return 'invalid';
}
const https = u => { const s = str(u, 500); return s && /^https:\/\/[^\s]+$/.test(s) ? s : null; };

function cleanOffer(o) {
  const out = {
    title: str(o.title, 120), keyword: str(o.keyword, 40), store: str(o.store, 40),
    price: num(o.price), old_price: num(o.old_price), unit: str(o.unit, 40), category: str(o.category, 40),
    region: str(o.region, 40) || 'bundesweit', valid_from: date(o.valid_from), valid_until: date(o.valid_until),
    source_url: https(o.source_url), is_teaser: !!o.is_teaser,
    recipe_links: (Array.isArray(o.recipe_links) ? o.recipe_links : []).slice(0, 3)
      .map(l => ({ title: str(l && l.title, 60) || 'Rezept-Idee', url: https(l && l.url) })).filter(l => l.url)
  };
  if (o.id && UUID.test(o.id)) out.id = o.id;
  if (!out.title || out.title.length < 2) return { error: 'Produkt fehlt.' };
  if (!out.store) return { error: `Laden fehlt bei „${out.title}“.` };
  if (!(out.price > 0)) return { error: `Preis fehlt oder ist ungültig bei „${out.title}“.` };
  if (Number.isNaN(out.old_price)) return { error: `Statt-Preis ist ungültig bei „${out.title}“.` };
  if (!out.valid_until || out.valid_until === 'invalid') return { error: `„Gültig bis“ fehlt oder ist ungültig bei „${out.title}“ (z. B. 07.11.2026).` };
  if (out.valid_from === 'invalid') return { error: `„Gültig ab“ ist ungültig bei „${out.title}“.` };
  return { offer: out };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false });
  if (!process.env.SUPABASE_SECRET_KEY) return res.status(500).json({ ok: false, message: 'SUPABASE_SECRET_KEY fehlt.' });
  if (!process.env.ADMIN_PASSWORD) return res.status(500).json({ ok: false, message: 'ADMIN_PASSWORD ist bei Vercel nicht eingetragen.' });
  if (!passwordOk(req.headers['x-admin-password'])) { await sleep(800); return res.status(401).json({ ok: false, message: 'Passwort falsch.' }); }

  const db = createClient(SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
  const body = typeof req.body === 'object' && req.body ? req.body : {};
  try {
    switch (body.action) {
      case 'login':
        return res.status(200).json({ ok: true });
      case 'list': {
        const { data, error } = await db.from('offers').select('*').order('valid_until', { ascending: false }).order('created_at', { ascending: false }).limit(300);
        if (error) throw error;
        const { count } = await db.from('profiles').select('user_id', { count: 'exact', head: true }).eq('plan', 'premium').gt('premium_until', new Date().toISOString());
        return res.status(200).json({ ok: true, offers: data, premiumCount: count || 0 });
      }
      case 'save': {
        const c = cleanOffer(body.offer || {});
        if (c.error) return res.status(400).json({ ok: false, message: c.error });
        const { data, error } = await db.from('offers').upsert(c.offer).select().single();
        if (error) throw error;
        return res.status(200).json({ ok: true, offer: data });
      }
      case 'import': {
        const rows = Array.isArray(body.offers) ? body.offers.slice(0, 200) : [];
        const clean = [];
        for (const r of rows) { const c = cleanOffer(r); if (c.error) return res.status(400).json({ ok: false, message: c.error }); clean.push(c.offer); }
        if (!clean.length) return res.status(400).json({ ok: false, message: 'Keine Angebote erkannt.' });
        const { error } = await db.from('offers').insert(clean);
        if (error) throw error;
        return res.status(200).json({ ok: true, count: clean.length });
      }
      case 'delete': {
        if (!UUID.test(body.id || '')) return res.status(400).json({ ok: false, message: 'Ungültige ID.' });
        const { error } = await db.from('offers').delete().eq('id', body.id);
        if (error) throw error;
        return res.status(200).json({ ok: true });
      }
      case 'cleanup': {
        const before = new Date(Date.now() - 14 * 864e5).toISOString().slice(0, 10);
        const { error, count } = await db.from('offers').delete({ count: 'exact' }).lt('valid_until', before);
        if (error) throw error;
        return res.status(200).json({ ok: true, count: count || 0 });
      }
      case 'grant': {
        const uid = String(body.userId || '').trim();
        if (!UUID.test(uid)) return res.status(400).json({ ok: false, message: 'Die Geräte-ID ist ungültig.' });
        const days = Math.max(0, Math.min(3650, parseInt(body.days, 10) || 0));
        const fields = days > 0
          ? { plan: 'premium', premium_until: new Date(Date.now() + days * 864e5).toISOString() }
          : { plan: 'free', premium_until: new Date().toISOString() };
        const { data, error } = await db.from('profiles').update(fields).eq('user_id', uid).select('user_id');
        if (error) throw error;
        if (!data || !data.length) return res.status(404).json({ ok: false, message: 'Zu dieser Geräte-ID gibt es kein Konto.' });
        return res.status(200).json({ ok: true, ...fields });
      }
      default:
        return res.status(400).json({ ok: false, message: 'Unbekannte Aktion.' });
    }
  } catch (e) {
    return res.status(500).json({ ok: false, message: 'Datenbankfehler: ' + (e.message || e) });
  }
}
