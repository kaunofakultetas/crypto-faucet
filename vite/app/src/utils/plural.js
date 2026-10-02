// -----------------------------------------------------------
//  [*] plural — a Lithuanian noun that agrees with its count
//
//  Lithuanian declines a counted noun by the last digits of
//  the number, not by "one or more": a count ending in one
//  takes the nominative singular, a count ending in two to
//  nine the nominative plural, and the rest — zero, the round
//  tens and every number ending in eleven to nineteen — the
//  genitive plural. A counter that glues one fixed form after
//  its number is wrong for most numbers, so the counters ask
//  this module for the form instead.
//
//  The rule itself is the browser's: Intl.PluralRules for
//  Lithuanian sorts a whole count into the categories "one",
//  "few" and "other", and the caller names its noun's form
//  for each of them.
// -----------------------------------------------------------

// The Lithuanian plural rules, built once — the simulator asks
// on every animation frame while it mines
const LITHUANIAN_RULES = new Intl.PluralRules('lt');







// -----------------------------------------------------------
// pluralForm
// -----------------------------------------------------------
//
// The form of a noun that agrees with a whole count: the
// caller passes its noun's forms for the categories "one",
// "few" and "other" and gets back the one the count asks for.
// Only the noun comes back — printing the number is left to
// the caller, so each page keeps its own number formatting.
// A count with a fraction falls into the fourth category,
// "many", which no counter on the site produces; it gets a
// "many" form when the caller gives one, the "other" form
// otherwise.
//
// Used by:
//   - BlockchainSimulator/Page.jsx — BlockCard, the tries
//     counted on the stop button
//   - Graph/components/CryptoFlowGraph.jsx — the transfer
//     count in the canvas's accessible name
// -----------------------------------------------------------

export function pluralForm(count, forms) {
  return forms[LITHUANIAN_RULES.select(count)] ?? forms.other;
}
