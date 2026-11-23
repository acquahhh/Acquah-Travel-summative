import { $, el, api, show, isoDate } from './ui.js';
import { load } from './results.js';
import { showTrips } from './booking.js';

const form = $('#search-form');
const addDays = (n) => isoDate(new Date(Date.now() + n * 864e5));

function autocomplete(input) {
  const list = input.nextElementSibling;
  let timer;
  const close = () => { list.hidden = true; };
  const pick = (a) => {
    input.value = `${a.city} (${a.iata})`;
    input.dataset.iata = a.iata;
    close();
  };
  input.addEventListener('input', () => {
    delete input.dataset.iata;
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 2) return close();
    timer = setTimeout(async () => {
      try {
        const places = await api(`/api/airports?q=${encodeURIComponent(q)}`);
        list.replaceChildren(...places.slice(0, 8).map((a) => el('li', {},
          el('button', { type: 'button', onmousedown: (e) => e.preventDefault(), onclick: () => pick(a) },
            el('strong', { textContent: a.iata }), ` ${a.name}`, el('small', { textContent: ` ${a.city}, ${a.country}` })))));
        list.hidden = !places.length;
      } catch { close(); }
    }, 250);
  });
  input.addEventListener('blur', (e) => { if (!list.contains(e.relatedTarget)) close(); });
  list.addEventListener('focusout', (e) => { if (!list.contains(e.relatedTarget)) close(); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
}

const code = (input) => input.dataset.iata || (/^[a-z]{3}$/i.test(input.value.trim()) ? input.value.trim().toUpperCase() : '');
const setPlace = (input, iata) => { input.value = iata; input.dataset.iata = iata; };
const isReturn = () => form.trip.value === 'return';

function syncTripType() {
  $('#return').disabled = !isReturn();
  $('#return').required = isReturn();
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const error = $('#search-error');
  const query = {
    from: code($('#from')), to: code($('#to')), depart: $('#depart').value,
    return: isReturn() ? $('#return').value : undefined,
    adults: Number($('#adults').value), cabin: $('#cabin').value,
  };
  if (!query.from || !query.to) error.textContent = 'Choose both airports from the list, or type a 3-letter code such as KGL.';
  else if (query.from === query.to) error.textContent = 'Departure and arrival airports must be different.';
  else if (!query.depart) error.textContent = 'Choose a departure date.';
  else if (isReturn() && !(query.return > query.depart)) error.textContent = 'Choose a return date after your departure date.';
  else {
    error.textContent = '';
    load(query);
  }
});

$('#swap').addEventListener('click', () => {
  const [a, b] = [$('#from'), $('#to')];
  [a.value, b.value] = [b.value, a.value];
  [a.dataset.iata, b.dataset.iata] = [b.dataset.iata || '', a.dataset.iata || ''];
});

document.querySelectorAll('[data-route]').forEach((btn) => btn.addEventListener('click', () => {
  const [from, to] = btn.dataset.route.split(' ');
  setPlace($('#from'), from);
  setPlace($('#to'), to);
  form.requestSubmit();
}));

document.querySelectorAll('[data-nav]').forEach((a) => a.addEventListener('click', (e) => {
  e.preventDefault();
  if (a.dataset.nav === 'trips') showTrips();
  else show('home');
}));

form.trip.forEach((r) => r.addEventListener('change', syncTripType));
$('#depart').addEventListener('change', () => { $('#return').min = $('#depart').value; });
$('#adults').append(...Array.from({ length: 9 }, (_, i) => el('option', { value: i + 1, textContent: `${i + 1} adult${i ? 's' : ''}` })));
$('#depart').min = $('#return').min = addDays(0);
$('#depart').value = addDays(14);
$('#return').value = addDays(21);
autocomplete($('#from'));
autocomplete($('#to'));
syncTripType();
api('/health').catch(() => {});
