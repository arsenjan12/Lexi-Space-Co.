// /api/tle?group=gps-ops — орбитальные элементы из CelesTrak, подписанные ML-DSA-65.
// Группы — только из белого списка, чтобы функция не стала открытым прокси.

import { signedResponse, errorResponse } from '../lib/signed.mjs';

const GROUPS = new Set(['stations', 'gps-ops', 'glo-ops', 'galileo', 'beidou', 'weather', 'science', 'resource', 'cubesat', 'starlink', 'geo', 'visual', 'noaa']);

export default async req => {
  const group = new URL(req.url).searchParams.get('group');
  if (!GROUPS.has(group)) return errorResponse(400, 'unknown group');
  const res = await fetch(`https://celestrak.org/NORAD/elements/gp.php?FORMAT=tle&GROUP=${group}`, {
    headers: { 'user-agent': 'LEXI-Space/1.0 (+netlify)' },
  });
  if (!res.ok) return errorResponse(502, `celestrak ${res.status}`);
  const tle = await res.text();
  if (!tle.includes('\n1 ')) return errorResponse(502, 'celestrak: no data');
  // CelesTrak обновляет элементы раз в несколько часов — держим в кэше CDN 2 часа
  return signedResponse({ group, source: 'celestrak.org', fetchedAt: new Date().toISOString(), tle }, { cdnSeconds: 7200, vary: 'query=group' });
};

export const config = { path: '/api/tle' };
