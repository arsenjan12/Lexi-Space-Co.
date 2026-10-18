// /api/kp — планетарный индекс геомагнитной активности Kp от NOAA SWPC, подписанный ML-DSA-65.

import { signedResponse, errorResponse } from '../lib/signed.mjs';

export default async () => {
  const res = await fetch('https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json');
  if (!res.ok) return errorResponse(502, `noaa ${res.status}`);
  const rows = await res.json();
  return signedResponse({ source: 'services.swpc.noaa.gov', fetchedAt: new Date().toISOString(), rows: rows.slice(-24) }, { cdnSeconds: 900 });
};

export const config = { path: '/api/kp' };
