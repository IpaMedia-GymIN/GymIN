// Worker di GymIN: serve i file statici di dist/ e genera config.js con le variabili
// Supabase dell'ambiente (produzione o test), impostate su Cloudflare e mai scritte nel repo.
// Vedi wrangler.jsonc e deploy/CLOUDFLARE.md.

const BANNER_TEST = `document.addEventListener('DOMContentLoaded', function () {
  document.title = '[TEST] ' + document.title;
  var d = document.createElement('div');
  d.textContent = 'AMBIENTE DI TEST';
  d.style.cssText = 'position:fixed;top:0;left:50%;transform:translateX(-50%);z-index:9999;background:#d97706;color:#fff;font:700 12px/1 system-ui,sans-serif;padding:5px 14px;border-radius:0 0 8px 8px;pointer-events:none';
  document.body.appendChild(d);
});
`;

function js(testo) {
  return new Response(testo, {
    headers: { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function supabase(env) {
  const url = env.SUPABASE_URL || '';
  const key = env.SUPABASE_ANON_KEY || '';
  const avviso = url && key ? '' : 'console.error("GymIN: SUPABASE_URL / SUPABASE_ANON_KEY non impostate sul Worker");\n';
  return { url, key, avviso, test: env.GYMIN_ENV === 'test' };
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);

    if (pathname === '/config.js') {
      const s = supabase(env);
      const cfg = { SUPABASE_URL: s.url, SUPABASE_ANON_KEY: s.key, ENV: s.test ? 'test' : '', MAILPIT_URL: '', MAILER_API_URL: '' };
      return js(`${s.avviso}window.GYMIN_CONFIG = ${JSON.stringify(cfg)};\n${s.test ? BANNER_TEST : ''}`);
    }

    if (pathname === '/accessi/config.js') {
      // parte dal config.js generato in build (impostazioni del terminale) e aggiunge Supabase
      const s = supabase(env);
      const base = await env.ASSETS.fetch(request);
      const testo = base.ok ? await base.text() : 'window.ACCESSI_CONFIG = {};\n';
      return js(`${testo}${s.avviso}Object.assign(window.ACCESSI_CONFIG, ${JSON.stringify({ SUPABASE_URL: s.url, SUPABASE_ANON_KEY: s.key })});\n${s.test ? BANNER_TEST : ''}`);
    }

    return env.ASSETS.fetch(request);
  },
};
