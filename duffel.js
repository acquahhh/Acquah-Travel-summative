const { ApiError } = require('./validate');

const fail = (status, error, message) => new ApiError(status, error, message);
const expired = () => fail(410, 'offer_expired', 'This fare is no longer available. Please search again for current prices.');

async function call(path, method = 'GET', body) {
  const token = process.env.DUFFEL_TOKEN;
  if (!token) throw fail(503, 'missing_token', 'Flight search is not configured: the server has no DUFFEL_TOKEN.');
  const headers = { Authorization: `Bearer ${token}`, 'Duffel-Version': 'v2', Accept: 'application/json', 'Content-Type': 'application/json' };
  const res = await fetch(`https://api.duffel.com${path}`, {
    method, headers, body: body && JSON.stringify({ data: body }), signal: AbortSignal.timeout(10_000),
  }).catch((err) => {
    throw err.name === 'TimeoutError'
      ? fail(504, 'timeout', 'The airline system took longer than 10 seconds to answer. Please try again.')
      : fail(502, 'network_error', 'Could not reach Duffel. Please try again in a moment.');
  });
  const json = await res.json().catch(() => ({}));
  if (res.ok) return json.data;
  const e = json.errors?.[0] || {};
  if (/expired|no_longer_available/.test(e.code || '')) throw expired();
  if (res.status === 401 || res.status === 403) throw fail(502, 'duffel_auth', 'Duffel rejected the server token. Check DUFFEL_TOKEN.');
  if (res.status >= 500) throw fail(502, 'duffel_unavailable', 'Duffel is having problems right now. Please try again shortly.');
  throw fail(res.status, 'duffel_error', e.message || e.title || 'Duffel could not process this request.');
}

const minutes = (iso) => {
  const m = /P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?/.exec(iso || '') || [];
  return (+m[1] || 0) * 1440 + (+m[2] || 0) * 60 + (+m[3] || 0);
};
const ends = (s) => ({
  from: s.origin.iata_code, from_city: s.origin.city_name || s.origin.name,
  to: s.destination.iata_code, to_city: s.destination.city_name || s.destination.name,
  depart: s.segments[0].departing_at, arrive: s.segments.at(-1).arriving_at,
});

function simplifyOffer(o) {
  const pax = o.slices[0]?.segments[0]?.passengers?.[0] || {};
  const bags = (type) => (pax.baggages || []).filter((b) => b.type === type).reduce((n, b) => n + b.quantity, 0);
  const slices = o.slices.map((s) => ({
    ...ends(s),
    duration: minutes(s.duration) || s.segments.reduce((n, x) => n + minutes(x.duration), 0),
    stops: s.segments.length - 1,
    flights: s.segments.map((x) => `${x.marketing_carrier.iata_code} ${x.marketing_carrier_flight_number}`),
  }));
  return {
    id: o.id, total: o.total_amount, currency: o.total_currency, expires_at: o.expires_at,
    airline: { name: o.owner.name, logo: o.owner.logo_symbol_url },
    cabin: pax.cabin_class_marketing_name || pax.cabin_class || 'Economy',
    baggage: { checked: bags('checked'), carry_on: bags('carry_on') },
    stops: Math.max(...slices.map((s) => s.stops)),
    duration: slices.reduce((n, s) => n + s.duration, 0),
    slices,
    passengers: o.passengers.map((p) => ({ id: p.id, type: p.type })),
  };
}

const simplifyOrder = (o) => ({
  id: o.id, reference: o.booking_reference, created_at: o.created_at, total: o.total_amount,
  currency: o.total_currency, airline: o.owner.name, slices: o.slices.map(ends),
  passengers: o.passengers.map((p) => `${p.given_name} ${p.family_name}`),
});

const airports = async (q) => (await call(`/places/suggestions?query=${encodeURIComponent(q)}`))
  .filter((p) => p.iata_code)
  .map((p) => ({ iata: p.iata_code, name: p.name, city: p.city_name || p.city?.name || p.name, country: p.iata_country_code }));

async function search(q) {
  const slices = [{ origin: q.from, destination: q.to, departure_date: q.depart }];
  if (q.ret) slices.push({ origin: q.to, destination: q.from, departure_date: q.ret });
  const passengers = Array.from({ length: q.adults }, () => ({ type: 'adult' }));
  // supplier_timeout keeps Duffel's answer inside our own 10s timeout.
  const data = await call('/air/offer_requests?return_offers=true&supplier_timeout=8000', 'POST', { slices, passengers, cabin_class: q.cabin });
  return { fetched_at: new Date().toISOString(), offers: data.offers.map(simplifyOffer).sort((a, b) => a.total - b.total).slice(0, 60) };
}

async function offer(id) {
  const o = simplifyOffer(await call(`/air/offers/${id}`));
  if (new Date(o.expires_at) <= new Date()) throw expired();
  return o;
}

async function book({ offerId, passengers }) {
  const o = await offer(offerId);
  const ids = o.passengers.map((p) => p.id);
  if (passengers.length !== ids.length || passengers.some((p) => !ids.includes(p.id))) {
    throw fail(400, 'invalid_input', 'Passenger details do not match this fare. Please start the booking again.');
  }
  const payments = [{ type: 'balance', currency: o.currency, amount: o.total }];
  return simplifyOrder(await call('/air/orders', 'POST', { type: 'instant', selected_offers: [offerId], passengers, payments }));
}

async function order(ref) {
  if (ref.startsWith('ord_')) return simplifyOrder(await call(`/air/orders/${ref}`));
  const [found] = await call(`/air/orders?booking_reference=${ref}&limit=1`);
  if (!found) throw fail(404, 'not_found', `No booking found with reference ${ref}.`);
  return simplifyOrder(found);
}

module.exports = { airports, search, offer, book, order };
