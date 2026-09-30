// -----------------------------------------------------------
//  [*] Test support — reaching a page's inner component
//
//  Some pages keep their building blocks private (not
//  exported) and feed them from a catalog hard-coded in the
//  same file — Presentations' PresentationCard is one. When
//  the catalog as shipped never takes a branch the component
//  documents (a card without a thumbnail, a button without a
//  variant), the only way to test that branch without touching
//  src/ is to take the component itself from a rendered
//  instance: every DOM node React renders carries its fiber,
//  and the fiber chain up from it leads to the component that
//  rendered it.
//
//  componentOf(element, name) → the function component called
//  `name` that rendered `element` (throws when there is none).
//  Relies on React DOM's "__reactFiber$…" node key and on the
//  function keeping its name (true for the test build — vite
//  does not minify it).
//
//  Used by:
//    - tests/pages/presentations.test.jsx
// -----------------------------------------------------------

export function componentOf(element, name) {
  const fiberKey = Object.keys(element).find((key) => key.startsWith('__reactFiber$'));
  let fiber = fiberKey ? element[fiberKey] : null;
  while (fiber) {
    if (typeof fiber.type === 'function' && fiber.type.name === name) return fiber.type;
    fiber = fiber.return;
  }
  throw new Error(`no component named ${name} rendered this element`);
}
