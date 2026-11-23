import { $, el, api, status, show, time, day, duration, stops, money } from './ui.js';
import { startBooking } from './booking.js';

const list = $('#result-list');
const meta = $('#result-meta');
let offers = [];
let fetchedAt;
let lastQuery;

const SORTS = {
  cheapest: (a, b) => a.total - b.total,
  fastest: (a, b) => a.duration - b.duration,
  earliest: (a, b) => a.slices[0].depart.localeCompare(b.slices[0].depart),
};
const period = (iso) => {
  const h = +iso.slice(11, 13);
  return h < 5 ? 'night' : h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening';
};
const ago = () => {
  const m = Math.floor((Date.now() - new Date(fetchedAt)) / 60e3);
  return m < 1 ? 'just now' : `${m} min ago`;
};
const checked = (name) => [...document.querySelectorAll(`[name="${name}"]:checked`)].map((c) => c.value);

export async function load(query) {
  lastQuery = query;
  show('home');
  $('#results').hidden = false;
  meta.textContent = '';
  status(list, 'loading', 'Searching fares… this can take a few seconds.');
  try {
    ({ offers, fetched_at: fetchedAt } = await api('/api/search', query));
    buildFilters();
    render();
  } catch (err) {
    offers = [];
    status(list, 'error', err.message, () => load(lastQuery));
  }
}

function buildFilters() {
  const airlines = [...new Set(offers.map((o) => o.airline.name))].sort();
  $('#f-airlines').replaceChildren(el('legend', { textContent: 'Airlines' }), ...airlines.map((name) =>
    el('label', {}, el('input', { type: 'checkbox', name: 'f-airline', value: name, checked: true }), ` ${name}`)));
  const prices = offers.map((o) => Math.ceil(o.total));
  if (!prices.length) return;
  const price = $('#f-price');
  Object.assign(price, { min: Math.min(...prices), max: Math.max(...prices), step: 1 });
  price.value = price.max;
}

function render() {
  const maxStops = +$('#f-stops').value;
  const maxPrice = +$('#f-price').value;
  const airlines = checked('f-airline');
  const times = checked('f-time');
  const shown = offers
    .filter((o) => o.stops <= maxStops && +o.total <= maxPrice && airlines.includes(o.airline.name)
      && times.includes(period(o.slices[0].depart)))
    .sort(SORTS[$('#sort').value]);
  $('#f-price-out').textContent = offers.length ? money(maxPrice, offers[0].currency) : '';
  if (!offers.length) return status(list, 'empty', 'No flights found, try other dates or a nearby airport.');
  meta.textContent = `${shown.length} of ${offers.length} flights · Prices refreshed ${ago()}`;
  if (!shown.length) return status(list, 'empty', 'No flights match these filters. Loosen a filter to see more.');
  list.replaceChildren(...shown.map(card));
}

function leg(s) {
  const nextDay = s.arrive.slice(0, 10) !== s.depart.slice(0, 10);
  return el('div', { className: 'leg' },
    el('div', { className: 'leg-end' }, el('strong', { textContent: time(s.depart) }), el('span', { textContent: `${s.from} · ${day(s.depart)}` })),
    el('div', { className: 'leg-mid' }, el('span', { textContent: duration(s.duration) }), el('span', { className: 'line' }),
      el('span', { textContent: `${stops(s.stops)} · ${s.flights.join(', ')}` })),
    el('div', { className: 'leg-end' }, el('strong', { textContent: time(s.arrive) }, nextDay && el('sup', { textContent: '+1' })),
      el('span', { textContent: s.to })));
}

function card(o) {
  const bags = [o.baggage.checked ? `${o.baggage.checked} checked bag` : 'No checked bag',
    o.baggage.carry_on ? `${o.baggage.carry_on} carry-on` : null].filter(Boolean).join(', ');
  return el('article', { className: 'panel offer' },
    el('div', { className: 'offer-airline' }, o.airline.logo && el('img', { src: o.airline.logo, alt: '', width: 28, height: 28 }),
      el('span', { textContent: o.airline.name })),
    el('div', { className: 'offer-legs' }, ...o.slices.map(leg)),
    el('div', { className: 'offer-side' },
      el('p', { className: 'price', textContent: money(o.total, o.currency) }),
      el('p', { className: 'muted', textContent: `Total for ${o.passengers.length} adult${o.passengers.length > 1 ? 's' : ''} · ${o.cabin}` }),
      el('p', { className: 'muted', textContent: `${bags} per passenger` }),
      el('button', { type: 'button', className: 'btn btn-primary', textContent: 'Select fare', onclick: () => startBooking(o) })));
}

$('#results').addEventListener('input', render);
setInterval(() => { if (offers.length && !$('#results').hidden) meta.textContent = meta.textContent.replace(/refreshed .*$/, `refreshed ${ago()}`); }, 30e3);
