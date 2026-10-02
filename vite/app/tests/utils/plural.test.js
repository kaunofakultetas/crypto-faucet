// -----------------------------------------------------------
//  [*] Tests — pluralForm, a Lithuanian noun that agrees with
//      its count
//
//  The helper behind the counters of the blockchain simulator
//  and the EVM graph: for every whole count it hands back the
//  form of the noun Lithuanian grammar asks for — the singular
//  after a count ending in one, the plural after one ending in
//  two to nine, the genitive plural after zero, the round tens
//  and eleven to nineteen — the last two digits deciding,
//  however large the number. A count with a fraction takes the
//  "many" form when the caller gives one, the "other" form
//  otherwise.
// -----------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { pluralForm } from '@/utils/plural';


// The two nouns the site counts, as their pages name them
const TRIES = { one: 'bandymas', few: 'bandymai', other: 'bandymų' };
const TRANSFERS = { one: 'pervedimas', few: 'pervedimai', other: 'pervedimų' };







// -----------------------------------------------------------
// Whole counts
// -----------------------------------------------------------
//
// The three forms, chosen by the count's last two digits.
// -----------------------------------------------------------

describe('pluralForm — whole counts', () => {

  it.each([1, 21, 31, 101, 1001, 1021])('%i takes the singular — "bandymas"', (count) => {
    expect(pluralForm(count, TRIES)).toBe('bandymas');
  });


  it.each([2, 3, 9, 22, 29, 102, 1023])('%i takes the plural — "bandymai"', (count) => {
    expect(pluralForm(count, TRIES)).toBe('bandymai');
  });


  it.each([0, 10, 11, 12, 15, 19, 20, 30, 100, 111, 112, 1000, 1011])('%i takes the genitive plural — "bandymų"', (count) => {
    expect(pluralForm(count, TRIES)).toBe('bandymų');
  });


  it('declines whatever noun the caller names — the graph\'s transfers', () => {
    expect([0, 1, 2, 10, 21].map((count) => pluralForm(count, TRANSFERS)))
      .toEqual(['pervedimų', 'pervedimas', 'pervedimai', 'pervedimų', 'pervedimas']);
  });
});







// -----------------------------------------------------------
// Counts with a fraction
// -----------------------------------------------------------
//
// No counter on the site produces one, but the helper still
// answers with a form the caller gave it.
// -----------------------------------------------------------

describe('pluralForm — counts with a fraction', () => {

  it('takes the "many" form when the caller gives one', () => {
    expect(pluralForm(1.5, { ...TRIES, many: 'bandymo' })).toBe('bandymo');
  });


  it('falls back to the "other" form without one', () => {
    expect(pluralForm(1.5, TRIES)).toBe('bandymų');
  });
});
