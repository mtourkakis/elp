// ELP Listening Practice - subscription check (K.N.V. AIR AVIATION SERVICES LTD)
// Secrets needed in Cloudflare: STRIPE_SECRET_KEY, ELP_MASTER
const ORIGIN = 'https://mtourkakis.github.io';
const enc = new TextEncoder();

function reply(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': ORIGIN,
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
    },
  });
}

async function stripe(env, path, body) {
  const r = await fetch('https://api.stripe.com/v1/' + path, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: 'Bearer ' + env.STRIPE_SECRET_KEY,
      'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  return r.json();
}

const b64 = u8 => btoa(String.fromCharCode(...u8));

// Key that unlocks one recording (its audio and its questions)
async function recKey(env, id) {
  const raw = Uint8Array.from(atob(env.ELP_MASTER), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64(new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode('elp:' + id))));
}

// The customer behind an access code, or '' if the code is not genuine
async function customerOf(env, tok) {
  const i = tok.lastIndexOf('.');
  const cus = tok.slice(0, i), sig = tok.slice(i + 1);
  if (i < 0 || !/^cus_[A-Za-z0-9]+$/.test(cus) || sig !== await sign(env, cus)) return '';
  return cus;
}

async function activeSub(env, cus) {
  const subs = await stripe(env, 'subscriptions?status=all&limit=10&customer=' + cus);
  return (subs.data || []).find(x => ['active', 'trialing', 'past_due'].includes(x.status));
}

async function sign(env, text) {
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(env.STRIPE_SECRET_KEY),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode('elp:' + text)));
  return btoa(String.fromCharCode(...sig)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return reply({});
    const url = new URL(request.url);

    // After payment: turn the Stripe checkout session into an access code
    if (url.pathname === '/verify') {
      const id = url.searchParams.get('session_id') || '';
      if (!/^cs_[A-Za-z0-9_]+$/.test(id)) return reply({ ok: false }, 400);
      const s = await stripe(env, 'checkout/sessions/' + id);
      if (s.status !== 'complete' || !s.customer) return reply({ ok: false });
      const token = s.customer + '.' + await sign(env, s.customer);
      return reply({ ok: true, token, email: (s.customer_details || {}).email || '' });
    }

    // Every visit: is the subscription behind this access code still active?
    if (url.pathname === '/check') {
      const cus = await customerOf(env, url.searchParams.get('token') || '');
      const sub = cus && await activeSub(env, cus);
      return reply({ active: !!sub, cancelAt: sub ? sub.cancel_at || null : null });
    }

    // Subscribers only: the keys that unlock the recordings
    if (url.pathname === '/keys') {
      const cus = await customerOf(env, url.searchParams.get('token') || '');
      if (!cus || !await activeSub(env, cus)) return reply({ ok: false }, 403);
      const ids = (url.searchParams.get('ids') || '').split(',').filter(x => /^a\d{1,3}$/.test(x)).slice(0, 200);
      const keys = {};
      for (const id of ids) keys[id] = await recKey(env, id);
      return reply({ ok: true, keys });
    }

    // Cancel: the subscription stays active until the end of the paid month
    if (url.pathname === '/cancel') {
      const cus = await customerOf(env, url.searchParams.get('token') || '');
      const sub = cus && await activeSub(env, cus);
      if (!sub) return reply({ ok: false });
      const s = await stripe(env, 'subscriptions/' + sub.id, 'cancel_at_period_end=true');
      return reply({ ok: !s.error, cancelAt: s.cancel_at || null });
    }

    return reply({ ok: true, service: 'elp-pay' });
  },
};
