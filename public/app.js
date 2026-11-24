import { startBooking, showTrips } from './booking.js';

// A hoisted declaration, because booking.js calls it while this module is still loading (circular import).
export function $(sel, root = document) { return root.querySelector(sel); }

// Every node is built with textContent / text nodes, so API strings are never parsed as HTML.
export function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.filter((c) => c != null && c !== false));
  return node;
}
export async function api(path, body) {
  const init = body && { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
  const res = await fetch(path, init).catch(() => { throw new Error('Could not reach the Acquah Travel server. Check your connection and try again.'); });
  const served = res.headers.get('X-Served-By');
  if (served) $('#served-by').textContent = served;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.message || `Request failed (${res.status}).`), { code: data.error });
  return data;
}
export function status(container, kind, text, retry) {
  const box = el('div', { className: `state state-${kind}`, role: kind === 'error' ? 'alert' : 'status' }, el('p', { textContent: text }));
  if (retry) box.append(el('button', { type: 'button', className: 'btn', textContent: 'Retry', onclick: retry }));
  container.replaceChildren(box);
}
export function show(view) {
  document.querySelectorAll('[data-view]').forEach((s) => { s.hidden = s.dataset.view !== view; });
  window.scrollTo(0, 0);
}

// Duffel times are local to each airport, so read them as written rather than converting zones.
export const time = (iso) => iso.slice(11, 16);
export const day = (iso) => new Date(`${iso.slice(0, 10)}T00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
export const money = (amount, currency) => new Intl.NumberFormat('en', { style: 'currency', currency }).format(amount);
export const isoDate = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60e3).toISOString().slice(0, 10);
export const plural = (n, word) => `${n} ${word}${n > 1 ? 's' : ''}`;
const duration = (m) => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
const stops = (n) => (n === 0 ? 'Direct' : plural(n, 'stop'));
const addDays = (n) => isoDate(new Date(Date.now() + n * 864e5));
const checked = (name) => [...document.querySelectorAll(`[name="${name}"]:checked`)].map((c) => c.value);
const period = (iso) => ['night', 'morning', 'afternoon', 'evening'][[5, 12, 18, 24].findIndex((h) => +iso.slice(11, 13) < h)];
const SORTS = { cheapest: (a, b) => a.total - b.total, fastest: (a, b) => a.duration - b.duration,
  earliest: (a, b) => a.slices[0].depart.localeCompare(b.slices[0].depart) };

const [form, list, meta, fromIn, toIn, departIn, returnIn] =
  ['#search-form', '#result-list', '#result-meta', '#from', '#to', '#depart', '#return'].map((s) => $(s));
let offers = [], fetchedAt;
const ago = () => { const m = Math.floor((Date.now() - new Date(fetchedAt)) / 60e3); return m < 1 ? 'just now' : `${m} min ago`; };

async function load(query) {
  show('home');
  $('#results').hidden = false;
  meta.textContent = '';
  status(list, 'loading', 'Searching fares… this can take a few seconds.');
  const data = await api('/api/search', query).catch((err) => status(list, 'error', err.message, () => load(query)));
  ({ offers, fetched_at: fetchedAt } = data || { offers: [] });
  if (!data) return;
  $('#f-airlines').replaceChildren(el('legend', { textContent: 'Airlines' }), ...[...new Set(offers.map((o) => o.airline.name))].sort().map((name) =>
    el('label', {}, el('input', { type: 'checkbox', name: 'f-airline', value: name, checked: true }), ` ${name}`)));
  const prices = offers.map((o) => Math.ceil(o.total));
  if (prices.length) Object.assign($('#f-price'), { min: Math.min(...prices), max: Math.max(...prices), step: 1, value: Math.max(...prices) });
  render();
}
function render() {
  const [maxStops, maxPrice, airlines, times] = [+$('#f-stops').value, +$('#f-price').value, checked('f-airline'), checked('f-time')];
  const shown = offers.filter((o) => o.stops <= maxStops && +o.total <= maxPrice && airlines.includes(o.airline.name)
    && times.includes(period(o.slices[0].depart))).sort(SORTS[$('#sort').value]);
  $('#f-price-out').textContent = offers.length ? money(maxPrice, offers[0].currency) : '';
  if (!offers.length) return status(list, 'empty', 'No flights found, try other dates or a nearby airport.');
  meta.textContent = `${shown.length} of ${offers.length} flights · Prices refreshed ${ago()}`;
  if (!shown.length) return status(list, 'empty', 'No flights match these filters. Loosen a filter to see more.');
  list.replaceChildren(...shown.map(card));
}

const leg = (s) => el('div', { className: 'leg' },
  el('div', { className: 'leg-end' }, el('strong', { textContent: time(s.depart) }), el('span', { textContent: `${s.from} · ${day(s.depart)}` })),
  el('div', { className: 'leg-mid' }, el('span', { textContent: duration(s.duration) }), el('span', { className: 'line' }),
    el('span', { textContent: `${stops(s.stops)} · ${s.flights.join(', ')}` })),
  el('div', { className: 'leg-end' }, el('strong', { textContent: time(s.arrive) }, s.arrive.slice(0, 10) !== s.depart.slice(0, 10) && el('sup', { textContent: '+1' })),
    el('span', { textContent: s.to })));
function card(o) {
  const bags = [o.baggage.checked ? `${o.baggage.checked} checked bag` : 'No checked bag', o.baggage.carry_on && `${o.baggage.carry_on} carry-on`];
  return el('article', { className: 'panel offer' },
    el('div', { className: 'offer-airline' }, o.airline.logo && el('img', { src: o.airline.logo, alt: '', width: 28, height: 28 }), el('span', { textContent: o.airline.name })),
    el('div', { className: 'offer-legs' }, ...o.slices.map(leg)),
    el('div', { className: 'offer-side' },
      el('p', { className: 'price', textContent: money(o.total, o.currency) }),
      el('p', { className: 'muted', textContent: `Total for ${plural(o.passengers.length, 'adult')} · ${o.cabin}` }),
      el('p', { className: 'muted', textContent: `${bags.filter(Boolean).join(', ')} per passenger` }),
      el('button', { type: 'button', className: 'btn btn-primary', textContent: 'Select fare', onclick: () => startBooking(o) })));
}
function autocomplete(input) {
  const menu = input.nextElementSibling;
  const close = () => { menu.hidden = true; };
  const pick = (a) => { input.value = `${a.city} (${a.iata})`; input.dataset.iata = a.iata; close(); };
  const closeOnLeave = (e) => { if (!menu.contains(e.relatedTarget)) close(); };
  let timer;
  input.addEventListener('input', () => {
    delete input.dataset.iata;
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 2) return close();
    timer = setTimeout(() => api(`/api/airports?q=${encodeURIComponent(q)}`).then((places) => {
      menu.replaceChildren(...places.slice(0, 8).map((a) => el('li', {},
        el('button', { type: 'button', onmousedown: (e) => e.preventDefault(), onclick: () => pick(a) },
          el('strong', { textContent: a.iata }), ` ${a.name}`, el('small', { textContent: ` ${a.city}, ${a.country}` })))));
      menu.hidden = !places.length;
    }, close), 250);
  });
  input.addEventListener('blur', closeOnLeave);
  menu.addEventListener('focusout', closeOnLeave);
  input.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
}

const code = (input) => input.dataset.iata || (/^[a-z]{3}$/i.test(input.value.trim()) ? input.value.trim().toUpperCase() : '');
const isReturn = () => form.trip.value === 'return';
const syncTripType = () => Object.assign(returnIn, { disabled: !isReturn(), required: isReturn() });

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const q = { from: code(fromIn), to: code(toIn), depart: departIn.value, return: isReturn() ? returnIn.value : undefined, adults: +$('#adults').value, cabin: $('#cabin').value };
  const error = !q.from || !q.to ? 'Choose both airports from the list, or type a 3-letter code such as KGL.'
    : q.from === q.to ? 'Departure and arrival airports must be different.'
    : !q.depart ? 'Choose a departure date.'
    : isReturn() && !(q.return > q.depart) ? 'Choose a return date after your departure date.' : '';
  $('#search-error').textContent = error;
  if (!error) load(q);
});
$('#swap').addEventListener('click', () => {
  [fromIn.value, toIn.value, fromIn.dataset.iata, toIn.dataset.iata] = [toIn.value, fromIn.value, toIn.dataset.iata || '', fromIn.dataset.iata || ''];
});
document.querySelectorAll('[data-route]').forEach((btn) => btn.addEventListener('click', () => {
  btn.dataset.route.split(' ').forEach((iata, i) => { const input = [fromIn, toIn][i]; input.value = input.dataset.iata = iata; });
  form.requestSubmit();
}));
document.querySelectorAll('[data-nav]').forEach((a) => a.addEventListener('click', (e) => {
  e.preventDefault();
  if (a.dataset.nav === 'trips') showTrips(); else show('home');
}));
$('#results').addEventListener('input', render);
setInterval(() => { if (offers.length && !$('#results').hidden) meta.textContent = meta.textContent.replace(/refreshed .*$/, `refreshed ${ago()}`); }, 30e3);
form.trip.forEach((r) => r.addEventListener('change', syncTripType));
departIn.addEventListener('change', () => { returnIn.min = departIn.value; });
$('#adults').append(...Array.from({ length: 9 }, (_, i) => el('option', { value: i + 1, textContent: plural(i + 1, 'adult') })));
Object.assign(departIn, { min: addDays(0), value: addDays(14) });
Object.assign(returnIn, { min: addDays(0), value: addDays(21) });
[fromIn, toIn].forEach(autocomplete);
syncTripType();
api('/health').catch(() => {});
