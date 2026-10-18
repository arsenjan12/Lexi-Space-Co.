// /api/neo — околоземные астероиды на сегодня из NASA NeoWs, подписанные ML-DSA-65.
// Ключ NASA берётся из переменной NASA_API_KEY (без неё — общий DEMO_KEY с жёстким лимитом).

import { signedResponse, errorResponse } from '../lib/signed.mjs';

export default async () => {
  const day = new Date().toISOString().slice(0, 10);
  const key = process.env.NASA_API_KEY || 'DEMO_KEY';
  const res = await fetch(`https://api.nasa.gov/neo/rest/v1/feed?start_date=${day}&end_date=${day}&api_key=${key}`);
  if (!res.ok) return errorResponse(502, `nasa ${res.status}`);
  const data = await res.json();
  const objects = Object.values(data.near_earth_objects || {}).flat().map(n => {
    const ca = n.close_approach_data?.[0] || {};
    return {
      id: n.id,
      name: n.name.replace(/[()]/g, ''),
      approachMs: ca.epoch_date_close_approach,
      missKm: Number(ca.miss_distance?.kilometers),
      velKms: Number(ca.relative_velocity?.kilometers_per_second),
      dMin: n.estimated_diameter?.meters?.estimated_diameter_min,
      dMax: n.estimated_diameter?.meters?.estimated_diameter_max,
      hazardous: n.is_potentially_hazardous_asteroid,
    };
  });
  return signedResponse({ day, source: 'api.nasa.gov/neo', fetchedAt: new Date().toISOString(), objects }, { cdnSeconds: 3600 });
};

export const config = { path: '/api/neo' };
