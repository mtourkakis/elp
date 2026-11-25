// ELP Listening Practice - subscription check (K.N.V. AIR AVIATION SERVICES LTD)
// Secret needed in Cloudflare: STRIPE_SECRET_KEY
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

async function stripe(env, path) {
  const r = await fetch('https://api.stripe.com/v1/' + path, {
    headers: { Authorization: 'Bearer ' + env.STRIPE_SECRET_KEY },
  });
  return r.json();
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
      const tok = url.searchParams.get('token') || '';
      const i = tok.lastIndexOf('.');
      const cus = tok.slice(0, i), sig = tok.slice(i + 1);
      if (i < 0 || !/^cus_[A-Za-z0-9]+$/.test(cus) || sig !== await sign(env, cus)) {
        return reply({ active: false });
      }
      const subs = await stripe(env, 'subscriptions?status=all&limit=10&customer=' + cus);
      const active = (subs.data || []).some(x => ['active', 'trialing', 'past_due'].includes(x.status));
      return reply({ active });
    }

    return reply({ ok: true, service: 'elp-pay' });
  },
};
