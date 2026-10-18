// /api/gp?group=gps-ops — орбитальные элементы CelesTrak в формате JSON (OMM) для портала LEXI.
//
// CelesTrak блокирует (403), если к нему часто ходят напрямую из браузеров посетителей.
// Здесь ответ кэшируется на CDN Netlify на 2 часа (столько CelesTrak и обновляет данные),
// так что к самому CelesTrak уходит один запрос на группу раз в 2 часа.
// Разрешён запрос с любого сайта (CORS), группы — только из белого списка.

const GROUPS = new Set(['stations', 'gps-ops', 'glo-ops', 'galileo', 'beidou', 'weather', 'science', 'resource', 'cubesat', 'starlink', 'geo', 'visual', 'noaa', 'active']);
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET', 'cross-origin-resource-policy': 'cross-origin' };

export default async req => {
  const group = new URL(req.url).searchParams.get('group');
  if (!GROUPS.has(group)) {
    return new Response(JSON.stringify({ error: 'unknown group' }), { status: 400, headers: { 'content-type': 'application/json', ...CORS } });
  }
  const res = await fetch(`https://celestrak.org/NORAD/elements/gp.php?FORMAT=json&GROUP=${group}`, {
    headers: { 'user-agent': 'LEXI-Space/1.0 (+https://lexi-space.netlify.app)' },
  });
  const body = await res.text();
  if (!res.ok || !body.trim().startsWith('[')) {
    return new Response(JSON.stringify({ error: `celestrak ${res.status}` }), { status: 502, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...CORS } });
  }
  return new Response(body, {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=600',
      'netlify-cdn-cache-control': 'public, durable, s-maxage=7200, stale-while-revalidate=7200',
      'netlify-vary': 'query=group',
      ...CORS,
    },
  });
};

export const config = { path: '/api/gp' };
