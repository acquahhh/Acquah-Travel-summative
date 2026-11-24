const { ApiError } = require('./duffel');

const bad = (message) => { throw new ApiError(400, 'invalid_input', message); };
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

function query(value) {
  const q = String(value || '').trim().toLowerCase();
  if (q.length < 2 || q.length > 40) bad('Type at least 2 characters to search airports.');
  return q;
}

function search(b = {}) {
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

function passenger(p, i) {
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

function booking(b = {}) {
  if (!Array.isArray(b.passengers) || !b.passengers.length || b.passengers.length > 9) bad('Add details for every passenger.');
  return { offerId: id(b.offer_id, 'off'), passengers: b.passengers.map((p, i) => passenger(p || {}, i)) };
}

function reference(value) {
  const s = String(value || '').trim();
  if (s.startsWith('ord_')) return id(s, 'ord');
  if (!/^[A-Za-z0-9]{5,8}$/.test(s)) bad('Enter a booking reference such as RZPNX8 or an order ID starting with ord_.');
  return s.toUpperCase();
}

module.exports = { query, search, booking, reference, offerId: (value) => id(value, 'off') };
