// Öffnet das Stripe-Kundenportal, in dem Kunden ihr Abo verwalten und kündigen.
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://ejnhcduokkjfubgildyy.supabase.co';
const RETURN_URL = 'https://fastumsonst.vercel.app/#angebote';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false });
  const fallback = process.env.PORTAL_LOGIN_URL || null;
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ ok: false, message: 'Nicht angemeldet.' });
  if (!process.env.STRIPE_SECRET_KEY || !process.env.SUPABASE_SECRET_KEY) {
    return fallback ? res.status(200).json({ ok: true, url: fallback }) : res.status(500).json({ ok: false, message: 'Server nicht eingerichtet.' });
  }

  const db = createClient(SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
  const { data: u, error } = await db.auth.getUser(token);
  if (error || !u || !u.user) return res.status(401).json({ ok: false, message: 'Nicht angemeldet.' });

  const { data: p } = await db.from('profiles').select('stripe_customer_id').eq('user_id', u.user.id).maybeSingle();
  if (!p || !p.stripe_customer_id) {
    return fallback ? res.status(200).json({ ok: true, url: fallback }) : res.status(404).json({ ok: false, message: 'Auf diesem Gerät ist kein Abo hinterlegt.' });
  }
  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const s = await stripe.billingPortal.sessions.create({ customer: p.stripe_customer_id, return_url: RETURN_URL });
    return res.status(200).json({ ok: true, url: s.url });
  } catch (e) {
    console.error('portal', e.message);
    return fallback ? res.status(200).json({ ok: true, url: fallback }) : res.status(500).json({ ok: false, message: 'Das Kundenportal ist gerade nicht erreichbar.' });
  }
}
