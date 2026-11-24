require('dotenv').config();
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const duffel = require('./duffel');
const v = require('./validate');

const app = express();
const host = os.hostname();
const PORT = process.env.PORT || 3000;

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
  const q = v.query(req.query.q);
  return cached(`places:${q}`, 24 * 3600e3, () => duffel.airports(q));
}));
app.post('/api/search', route((req) => {
  const q = v.search(req.body);
  return cached(`search:${JSON.stringify(q)}`, 5 * 60e3, () => duffel.search(q));
}));
app.get('/api/offers/:id', route((req) => duffel.offer(v.offerId(req.params.id))));
app.post('/api/bookings', route((req) => duffel.book(v.booking(req.body))));
app.get('/api/bookings/:id', route((req) => duffel.order(v.reference(req.params.id))));
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
