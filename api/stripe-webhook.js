// Stripe meldet hier, wenn jemand Premium abschließt, verlängert oder kündigt.
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';

export const config = { api: { bodyParser: false } };

const SUPABASE_URL = 'https://ejnhcduokkjfubgildyy.supabase.co';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function readRaw(req) {
  const chunks = [];
  for await (const c of req) chunks.push(typeof c === 'string' ? Buffer.from(c) : c);
  if (chunks.length) return Buffer.concat(chunks);
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') return Buffer.from(req.body);
  return null;
}

const VAPID_PUBLIC = 'BLLNu7AkOUtEwNouUgIEQsaz2tS4cCBgFrFefBz1mp2Ku4E9qvl4dlSxE2wq4rREBP7KrElu4MIGVlsrKhBZF0k';
const UUID_OWNER = () => { const id = (process.env.OWNER_USER_ID || '').trim(); return UUID.test(id) ? id : null; };

// Schickt dir (dem Betreiber) eine Push-Nachricht, wenn sich bei den Abos etwas tut.
async function notifyOwner(db, title, body) {
  const owner = UUID_OWNER();
  if (!owner || !process.env.VAPID_PRIVATE_KEY) return;
  try {
    webpush.setVapidDetails('mailto:fastumsonst.app@gmx.de', VAPID_PUBLIC, process.env.VAPID_PRIVATE_KEY);
    const { data: subs } = await db.from('push_subscriptions').select('*').eq('user_id', owner);
    const payload = JSON.stringify({ title, body, tag: 'owner-' + Date.now(), url: '/admin.html' });
    await Promise.all((subs || []).map(s => webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 24 * 3600 }).catch(() => {})));
  } catch (e) { console.error('owner push', e.message); }
}

const isActive = s => ['trialing', 'active', 'past_due'].includes(s.status);
function premiumUntil(sub) {
  const item = sub.items && sub.items.data && sub.items.data[0];
  const end = (item && item.current_period_end) || sub.current_period_end || sub.trial_end;
  // einen Tag Puffer, falls die Verlängerung etwas später gemeldet wird
  return end ? new Date((end + 86400) * 1000).toISOString() : new Date(Date.now() + 8 * 864e5).toISOString();
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false });
  const missing = ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'SUPABASE_SECRET_KEY'].filter(k => !process.env[k]);
  if (missing.length) return res.status(500).json({ ok: false, missing });

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  let event;
  try {
    const raw = await readRaw(req);
    event = stripe.webhooks.constructEvent(raw, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET);
  } catch (e) {
    return res.status(400).json({ ok: false, message: 'Signatur ungültig' });
  }

  const db = createClient(SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });

  async function apply(sub, userId) {
    const customer = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
    const fields = {
      stripe_customer_id: customer,
      stripe_subscription_id: sub.id,
      plan: isActive(sub) ? 'premium' : 'free',
      premium_until: isActive(sub) ? premiumUntil(sub) : new Date().toISOString()
    };
    if (userId) return db.from('profiles').upsert({ user_id: userId, ...fields });
    return db.from('profiles').update(fields).eq('stripe_customer_id', customer);
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const s = event.data.object;
        if (s.mode !== 'subscription' || !s.subscription) break;
        const uid = s.client_reference_id;
        if (!uid || !UUID.test(uid)) break;
        const sub = await stripe.subscriptions.retrieve(typeof s.subscription === 'string' ? s.subscription : s.subscription.id);
        const r = await apply(sub, uid);
        if (r.error) console.error('profile upsert', r.error.message);
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        const r = await apply(sub, null);
        if (r.error) console.error('profile update', r.error.message);
        const prev = (event.data.previous_attributes) || {};
        if (event.type === 'customer.subscription.created') {
          await notifyOwner(db, sub.status === 'trialing' ? '🎉 Neues Probeabo!' : '🎉 Neues Abo!', sub.status === 'trialing' ? 'Jemand testet FastUmsonst Premium 7 Tage gratis.' : 'Jemand hat FastUmsonst Premium abgeschlossen.');
        } else if (event.type === 'customer.subscription.deleted') {
          await notifyOwner(db, 'Abo beendet', 'Ein Premium-Abo ist ausgelaufen.');
        } else if (prev.status === 'trialing' && sub.status === 'active') {
          await notifyOwner(db, '💶 Erste Zahlung!', 'Ein Probeabo wurde zum bezahlten Abo (4,99 €).');
        } else if (prev.cancel_at_period_end === false && sub.cancel_at_period_end) {
          await notifyOwner(db, 'Kündigung vorgemerkt', 'Ein Kunde hat gekündigt. Das Abo läuft bis zum Periodenende weiter.');
        }
        break;
      }
      default:
        break;
    }
  } catch (e) {
    console.error('webhook', e.message);
    return res.status(500).json({ ok: false });
  }
  return res.status(200).json({ ok: true, type: event.type });
}
