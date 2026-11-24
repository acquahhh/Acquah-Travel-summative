const test = require('node:test');
const assert = require('node:assert/strict');
const v = require('./validate');

const inDays = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const rejects = (fn, message) => assert.throws(fn, { status: 400, error: 'invalid_input', message });
const search = (overrides) => v.search({ from: 'KGL', to: 'NBO', depart: inDays(14), adults: 1, ...overrides });
const traveller = {
  id: 'pas_0000AbCdEf123', title: 'ms', given_name: 'Adjoa', family_name: 'Mensah',
  gender: 'f', born_on: '1990-04-12', email: 'adjoa@example.com', phone_number: '+233 24 123 4567',
};
const book = (...passengers) => v.booking({ offer_id: 'off_0000XyZ987', passengers });

test('search: accepts a one-way trip and normalises it', () => {
  assert.deepEqual(search({ from: ' kgl ', adults: '2' }), {
    from: 'KGL', to: 'NBO', depart: inDays(14), ret: null, adults: 2, cabin: 'economy',
  });
});

test('search: accepts a return trip with a cabin class', () => {
  const q = search({ depart: inDays(0), return: inDays(7), adults: 9, cabin: 'business' });
  assert.equal(q.ret, inDays(7));
  assert.equal(q.adults, 9);
  assert.equal(q.cabin, 'business');
});

test('search: rejects bad airport codes', () => {
  rejects(() => search({ from: 'KG' }), /From must be a 3-letter airport code/);
  rejects(() => search({ to: 'N8O' }), /To must be a 3-letter airport code/);
  rejects(() => search({ to: 'kgl' }), /must be different/);
  rejects(() => v.search(), /From must be/);
});

test('search: rejects bad dates', () => {
  const nextYear = new Date().getUTCFullYear() + 1;
  rejects(() => search({ depart: inDays(-1) }), /cannot be in the past/);
  rejects(() => search({ depart: `${nextYear}-02-30` }), /valid date/);
  rejects(() => search({ depart: '14/12/2030' }), /valid date/);
  rejects(() => search({ return: inDays(14) }), /Return date must be after/);
  rejects(() => search({ return: inDays(3) }), /Return date must be after/);
});

test('search: rejects passenger counts outside 1-9 and unknown cabins', () => {
  for (const adults of [0, 10, 1.5, 'two', undefined]) rejects(() => search({ adults }), /between 1 and 9/);
  rejects(() => search({ cabin: 'sleeper' }), /Unknown cabin class/);
});

test('passengers: accepts valid details and cleans them up', () => {
  const { offerId, passengers } = book({ ...traveller, given_name: '  Adjoa ' });
  assert.equal(offerId, 'off_0000XyZ987');
  assert.deepEqual(passengers[0], { ...traveller, phone_number: '+233241234567' });
});

test('passengers: allows accents, hyphens, apostrophes and spaces in names', () => {
  for (const name of ['Zoë', "N'Dri", 'Ama-Serwaa', 'Mukamana Uwase', 'Nkosazana Dlamini’Zuma']) {
    assert.equal(book({ ...traveller, family_name: name }).passengers[0].family_name, name);
  }
});

test('passengers: rejects invalid names, title and gender', () => {
  rejects(() => book({ ...traveller, given_name: 'Adjoa2' }), /names may only contain letters/);
  rejects(() => book({ ...traveller, family_name: '' }), /names may only contain letters/);
  rejects(() => book({ ...traveller, family_name: '<script>' }), /names may only contain letters/);
  rejects(() => book({ ...traveller, title: 'sir' }), /choose a title/);
  rejects(() => book({ ...traveller, gender: 'x' }), /choose the gender/);
});

test('passengers: rejects a date of birth that is not in the past', () => {
  rejects(() => book({ ...traveller, born_on: inDays(0) }), /date of birth must be in the past/);
  rejects(() => book({ ...traveller, born_on: inDays(30) }), /date of birth must be in the past/);
  rejects(() => book({ ...traveller, born_on: '1990-13-01' }), /date of birth must be a valid date/);
});

test('passengers: rejects bad contact details', () => {
  rejects(() => book({ ...traveller, email: 'adjoa@example' }), /valid email address/);
  rejects(() => book({ ...traveller, email: 'adjoa example.com' }), /valid email address/);
  rejects(() => book({ ...traveller, phone_number: '024 123 4567' }), /include the country code/);
  rejects(() => book({ ...traveller, phone_number: '+0 24 123 4567' }), /include the country code/);
});

test('passengers: names which passenger is wrong', () => {
  rejects(() => book(traveller, { ...traveller, id: 'pas_0000ZzZz999', email: '' }), /^Passenger 2: /);
});

test('passengers: rejects bad passenger lists and ids', () => {
  rejects(() => v.booking({ offer_id: 'off_0000XyZ987', passengers: [] }), /every passenger/);
  rejects(() => v.booking({ offer_id: 'off_0000XyZ987' }), /every passenger/);
  rejects(() => book(...Array(10).fill(traveller)), /every passenger/);
  rejects(() => book({ ...traveller, id: 'abc' }), /does not look right/);
  rejects(() => v.booking({ offer_id: 'ord_0000XyZ987', passengers: [traveller] }), /does not look right/);
});
