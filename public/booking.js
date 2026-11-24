import { $, el, api, status, show, money, day, time, isoDate, plural } from './app.js';

const form = $('#passenger-form');
const review = $('#review');
const STORE = 'acquah-travel.bookings';
let offer;
let passengers;

const saved = () => JSON.parse(localStorage.getItem(STORE) || '[]');
const route = (o) => o.slices.map((s) => `${s.from} → ${s.to}`).join(', ');

function orderCard(o) {
  const rows = [
    ['Route', o.slices.map((s) => `${s.from} → ${s.to}, ${day(s.depart)} at ${time(s.depart)}`).join('; ')],
    ['Airline', o.airline],
    ['Passengers', o.passengers.join(', ')],
    ['Total paid', money(o.total, o.currency)],
    ['Order ID', o.id],
  ];
  return el('article', { className: 'panel order' },
    el('p', { className: 'order-ref' }, 'Booking reference ', el('strong', { textContent: o.reference })),
    el('dl', {}, ...rows.flatMap(([k, v]) => [el('dt', { textContent: k }), el('dd', { textContent: v })])));
}

export async function startBooking(selected) {
  show('booking');
  form.hidden = review.hidden = true;
  const check = $('#fare-check');
  status(check, 'loading', 'Re-checking this fare with the airline…');
  try {
    offer = await api(`/api/offers/${selected.id}`);
  } catch (err) {
    return status(check, 'error', err.message, err.code === 'offer_expired' ? null : () => startBooking(selected));
  }
  const changed = offer.total !== selected.total;
  check.replaceChildren(el('div', { className: `panel fare ${changed ? 'fare-changed' : ''}` },
    el('p', { textContent: `${offer.airline.name} · ${route(offer)} · ${day(offer.slices[0].depart)} at ${time(offer.slices[0].depart)}` }),
    el('p', { className: 'price', textContent: money(offer.total, offer.currency) }),
    el('p', { className: 'muted', textContent: changed
      ? `The price changed from ${money(selected.total, selected.currency)} since your search.`
      : `Price confirmed for ${plural(offer.passengers.length, 'passenger')}. Hold expires at ${new Date(offer.expires_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.` })));
  const tpl = $('#tpl-passenger').content.firstElementChild;
  $('#passenger-list').replaceChildren(...offer.passengers.map((p, i) => {
    const fs = tpl.cloneNode(true);
    fs.dataset.id = p.id;
    fs.querySelector('legend').textContent = `Passenger ${i + 1} (adult)`;
    fs.querySelector('[name="born_on"]').max = isoDate(new Date(Date.now() - 864e5));
    return fs;
  }));
  form.hidden = false;
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  passengers = [...form.querySelectorAll('fieldset.passenger')].map((fs) => ({
    id: fs.dataset.id,
    ...Object.fromEntries([...fs.querySelectorAll('[name]')].map((f) => [f.name, f.value.trim()])),
  }));
  form.hidden = true;
  review.hidden = false;
  review.replaceChildren(
    el('h2', { textContent: 'Check your details' }),
    el('ul', { className: 'review-list' }, ...passengers.map((p) =>
      el('li', { textContent: `${p.title.toUpperCase()} ${p.given_name} ${p.family_name} · born ${p.born_on} · ${p.email} · ${p.phone_number}` }))),
    el('p', { textContent: `${route(offer)} · Total ${money(offer.total, offer.currency)} (test balance, no card charged)` }),
    el('div', { className: 'actions' },
      el('button', { type: 'button', className: 'btn', textContent: 'Edit details', onclick: () => { review.hidden = true; form.hidden = false; } }),
      el('button', { type: 'button', className: 'btn btn-primary', textContent: 'Confirm booking', onclick: confirm })),
    el('div', { id: 'confirm-status' }));
});

async function confirm(e) {
  e.target.disabled = true;
  status($('#confirm-status'), 'loading', 'Creating your booking…');
  try {
    const order = await api('/api/bookings', { offer_id: offer.id, passengers });
    const trip = { id: order.id, reference: order.reference, route: route(order), depart: order.slices[0].depart };
    localStorage.setItem(STORE, JSON.stringify([trip, ...saved()].slice(0, 20)));
    show('confirmation');
    $('#confirmation-detail').replaceChildren(orderCard(order));
  } catch (err) {
    e.target.disabled = err.code === 'offer_expired';
    status($('#confirm-status'), 'error', err.message, err.code === 'offer_expired' ? null : () => confirm(e));
  }
}

async function lookup(ref) {
  const out = $('#lookup-result');
  status(out, 'loading', `Looking up ${ref}…`);
  try {
    out.replaceChildren(orderCard(await api(`/api/bookings/${encodeURIComponent(ref)}`)));
  } catch (err) {
    status(out, 'error', err.message, () => lookup(ref));
  }
}

export function showTrips() {
  show('trips');
  const trips = saved();
  if (!trips.length) return status($('#saved-trips'), 'empty', 'No bookings made on this device yet.');
  $('#saved-trips').replaceChildren(el('ul', { className: 'trip-list' }, ...trips.map((t) => el('li', {},
    el('strong', { textContent: t.reference }), el('span', { textContent: ` ${t.route} · ${day(t.depart)}` }),
    el('button', { type: 'button', className: 'link', textContent: 'View', onclick: () => lookup(t.id) })))));
}

$('#lookup-form').addEventListener('submit', (e) => {
  e.preventDefault();
  lookup($('#lookup-ref').value.trim());
});
