require('dotenv').config();
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const duffel = require('./duffel');

const app = express();
const host = os.hostname();
const PORT = process.env.PORT || 3000;

const bad = (message) => { throw new duffel.ApiError(400, 'invalid_input', message); };
const today = () => new Date().toISOString().slice(0, 10);
const NAME = /^\p{L}[\p{L} '’-]{0,39}$/u;
const CABINS = ['economy', 'premium_economy', 'business', 'first'];
const TITLES = ['mr', 'ms', 'mrs', 'miss', 'dr'];

function iata(value, label) {
  const code = String(value || '').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) bad(`${label} must be a 3-letter airport code, e.g. KGL.`);
  return code;
}

function date(value, label) {
  const s = String(value || '');
  const d = new Date(s);
  // Round-tripping rejects impossible dates such as 2026-02-30.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || isNaN(d) || d.toISOString().slice(0, 10) !== s) bad(`${label} must be a valid date (YYYY-MM-DD).`);
  return s;
}

function id(value, prefix) {
  const s = String(value || '');
  if (!new RegExp(`^${prefix}_[A-Za-z0-9]{6,40}$`).test(s)) bad('That reference does not look right.');
  return s;
}

function validSearch(b = {}) {
  const from = iata(b.from, 'From');
  const to = iata(b.to, 'To');
  if (from === to) bad('Departure and arrival airports must be different.');
  const depart = date(b.depart, 'Departure date');
  if (depart < today()) bad('Departure date cannot be in the past.');
  const ret = b.return ? date(b.return, 'Return date') : null;
  if (ret && ret <= depart) bad('Return date must be after the departure date.');
  const adults = Number(b.adults);
  if (!Number.isInteger(adults) || adults < 1 || adults > 9) bad('Choose between 1 and 9 passengers.');
  const cabin = b.cabin || 'economy';
  if (!CABINS.includes(cabin)) bad('Unknown cabin class.');
  return { from, to, depart, ret, adults, cabin };
}

function validPassenger(p, i) {
  const n = `Passenger ${i + 1}`;
  const clean = (k) => String(p?.[k] || '').trim();
  const [given_name, family_name, email] = [clean('given_name'), clean('family_name'), clean('email')];
  const phone_number = clean('phone_number').replace(/[\s().-]/g, '');
  if (!NAME.test(given_name) || !NAME.test(family_name)) bad(`${n}: names may only contain letters, spaces, hyphens and apostrophes.`);
  if (!TITLES.includes(p.title)) bad(`${n}: choose a title.`);
  if (!['m', 'f'].includes(p.gender)) bad(`${n}: choose the gender shown on the passport.`);
  const born_on = date(p.born_on, `${n}: date of birth`);
  if (born_on >= today()) bad(`${n}: date of birth must be in the past.`);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) bad(`${n}: enter a valid email address.`);
  if (!/^\+[1-9]\d{6,14}$/.test(phone_number)) bad(`${n}: include the country code in the phone number, e.g. +250 788 123 456.`);
  return { id: id(p.id, 'pas'), title: p.title, given_name, family_name, gender: p.gender, born_on, email, phone_number };
}

function validReference(value) {
  const s = String(value || '').trim();
  if (s.startsWith('ord_')) return id(s, 'ord');
  if (!/^[A-Za-z0-9]{5,8}$/.test(s)) bad('Enter a booking reference such as RZPNX8 or an order ID starting with ord_.');
  return s.toUpperCase();
}

const cache = new Map();
async function cached(key, ttl, fn) {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  const value = await fn(); // a thrown error skips the cache
  if (cache.size > 500) for (const [k, e] of cache) if (e.expires <= Date.now()) cache.delete(k);
  cache.set(key, { value, expires: Date.now() + ttl });
  return value;
}

const route = (fn) => async (req, res) => {
  try {
    res.json(await fn(req));
  } catch (err) {
    if (!err.error) console.error(err);
    res.status(err.status || 500).json({
      error: err.error || 'server_error',
      message: err.error ? err.message : 'Something went wrong on our side. Please try again.',
    });
  }
};

// Production chain is HAProxy -> Nginx -> Node, so trust two proxy hops for client IPs.
app.set('trust proxy', 2);
app.use(helmet({
  // The web servers sit behind plain-HTTP HAProxy, so don't force asset requests to https.
  contentSecurityPolicy: { directives: { imgSrc: ["'self'", 'data:', 'https://assets.duffel.com'], upgradeInsecureRequests: null } },
}));
app.use((req, res, next) => { res.set('X-Served-By', host); next(); });
app.use(express.json({ limit: '20kb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/api', rateLimit({
  windowMs: 60_000,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'rate_limited', message: 'Too many requests. Please wait a minute and try again.' },
}));

app.get('/health', (req, res) => res.json({ status: 'ok', server: host }));
app.get('/api/airports', route((req) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  if (q.length < 2 || q.length > 40) bad('Type at least 2 characters to search airports.');
  return cached(`places:${q}`, 24 * 3600e3, () => duffel.airports(q));
}));
app.post('/api/search', route((req) => {
  const q = validSearch(req.body);
  return cached(`search:${JSON.stringify(q)}`, 5 * 60e3, () => duffel.search(q));
}));
app.get('/api/offers/:id', route((req) => duffel.offer(id(req.params.id, 'off'))));
app.post('/api/bookings', route(({ body = {} }) => {
  if (!Array.isArray(body.passengers) || !body.passengers.length || body.passengers.length > 9) bad('Add details for every passenger.');
  return duffel.book({ offerId: id(body.offer_id, 'off'), passengers: body.passengers.map((p, i) => validPassenger(p || {}, i)) });
}));
app.get('/api/bookings/:id', route((req) => duffel.order(validReference(req.params.id))));
app.use('/api', (req, res) => res.status(404).json({ error: 'not_found', message: 'No such API endpoint.' }));

// Body-parser failures (bad JSON, oversized body) land here.
app.use((err, req, res, next) => {
  const known = { 400: 'Request body must be valid JSON.', 413: 'Request is too large.' }[err.status];
  if (!known) console.error(err);
  res.status(known ? err.status : 500).json({
    error: known ? 'bad_request' : 'server_error',
    message: known || 'Something went wrong on our side. Please try again.',
  });
});

process.on('unhandledRejection', (err) => console.error('Unhandled rejection:', err));
app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
