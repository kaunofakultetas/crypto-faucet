// -----------------------------------------------------------
//  [*] Tests — clipboardFailure, why a copy failed
//
//  The one wording every copy button uses: no clipboard at
//  all outside a secure page, the browser refusing the write,
//  or the browser's own words for anything else — its name
//  and message kept in parentheses whenever it gave them.
// -----------------------------------------------------------

import { afterEach, describe, it, expect, vi } from 'vitest';
import { clipboardFailure } from '@/utils/clipboardError';


// A browser that offers a clipboard — the failure is then the
// write's own
const withClipboard = () => vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn() } });

afterEach(() => {
  vi.unstubAllGlobals();
});







// -----------------------------------------------------------
// clipboardFailure
// -----------------------------------------------------------
//
// Each cause, told in its own words.
// -----------------------------------------------------------

describe('clipboardFailure', () => {

  it('says the clipboard needs a secure (HTTPS) page when the browser offers none', () => {
    vi.stubGlobal('navigator', {});
    expect(clipboardFailure(new TypeError("Cannot read properties of undefined (reading 'writeText')")))
      .toBe('naršyklė šiame puslapyje iškarpinės nepasiekia — ji veikia tik saugiu (HTTPS) ryšiu');
  });

  it("says the browser refused the write, in the browser's words", () => {
    withClipboard();
    expect(clipboardFailure(new DOMException('Write permission denied.', 'NotAllowedError')))
      .toBe('naršyklė neleido įrašyti į iškarpinę (NotAllowedError: Write permission denied.)');
  });

  it("tells any other failure in the browser's words, and without them when it gave none", () => {
    withClipboard();
    expect(clipboardFailure(new Error('Document is not focused.'))).toBe('naršyklei nepavyko įrašyti į iškarpinę (Error: Document is not focused.)');
    expect(clipboardFailure(undefined)).toBe('naršyklei nepavyko įrašyti į iškarpinę');
  });
});
