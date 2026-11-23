export const $ = (sel, root = document) => root.querySelector(sel);

// Every node is built with textContent / text nodes, so API strings are never parsed as HTML.
export function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.filter((c) => c != null && c !== false));
  return node;
}

export async function api(path, body) {
  let res;
  try {
    res = await fetch(path, body
      ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      : undefined);
  } catch {
    throw new Error('Could not reach the Acquah Travel server. Check your connection and try again.');
  }
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
export const day = (iso) => new Date(`${iso.slice(0, 10)}T00:00Z`)
  .toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
export const duration = (m) => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
export const stops = (n) => (n === 0 ? 'Direct' : n === 1 ? '1 stop' : `${n} stops`);
export const money = (amount, currency) =>
  new Intl.NumberFormat('en', { style: 'currency', currency }).format(amount);
export const isoDate = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60e3).toISOString().slice(0, 10);

export function orderCard(o) {
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
