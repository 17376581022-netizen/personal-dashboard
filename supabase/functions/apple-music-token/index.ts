import { importPKCS8, SignJWT } from 'npm:jose@5.9.6';

const DEFAULT_ORIGINS = [
  'https://17376581022-netizen.github.io',
  'http://127.0.0.1:8000',
  'http://localhost:8000'
];

function allowedOrigins() {
  const configured = (Deno.env.get('APPLE_MUSIC_ALLOWED_ORIGINS') || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
  return configured.length ? configured : DEFAULT_ORIGINS;
}

function corsHeaders(origin: string | null) {
  const allowed = allowedOrigins();
  const responseOrigin = origin && allowed.includes(origin) ? origin : allowed[0];
  return {
    'Access-Control-Allow-Origin': responseOrigin,
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'Vary': 'Origin'
  };
}

Deno.serve(async request => {
  const origin = request.headers.get('origin');
  const headers = corsHeaders(origin);

  if (request.method === 'OPTIONS') return new Response('ok', { headers });
  if (request.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });
  }
  if (origin && !allowedOrigins().includes(origin)) {
    return new Response(JSON.stringify({ error: 'Origin not allowed' }), { status: 403, headers });
  }

  const teamId = Deno.env.get('APPLE_MUSIC_TEAM_ID')?.trim();
  const keyId = Deno.env.get('APPLE_MUSIC_KEY_ID')?.trim();
  const rawPrivateKey = Deno.env.get('APPLE_MUSIC_PRIVATE_KEY')?.trim();
  if (!teamId || !keyId || !rawPrivateKey) {
    return new Response(JSON.stringify({ error: 'Apple Music secrets are not configured' }), { status: 503, headers });
  }

  try {
    const privateKey = rawPrivateKey.replace(/\\n/g, '\n');
    const key = await importPKCS8(privateKey, 'ES256');
    const now = Math.floor(Date.now() / 1000);
    const token = await new SignJWT({ origin: allowedOrigins() })
      .setProtectedHeader({ alg: 'ES256', kid: keyId, typ: 'JWT' })
      .setIssuer(teamId)
      .setIssuedAt(now)
      .setExpirationTime(now + 60 * 60 * 12)
      .sign(key);
    return new Response(JSON.stringify({ token, expiresIn: 43200 }), { headers });
  } catch (error) {
    console.error('Unable to sign Apple Music developer token', error);
    return new Response(JSON.stringify({ error: 'Unable to sign Apple Music token' }), { status: 500, headers });
  }
});
