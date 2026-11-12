// -----------------------------------------------------------
//  [*] Tests — walletInstall, the note of an install started
//
//  What the install step remembers across its own reloads:
//  one localStorage entry per wallet with the time the student
//  set off, counting for a quarter of an hour, dropped once
//  the wallet is found — and nothing at all in a browser that
//  blocks storage, without a throw.
// -----------------------------------------------------------

import { describe, it, expect, vi } from 'vitest';
import { noteInstallStarted, installUnderWay, forgetInstall } from '@/utils/walletInstall';


// The moment every test's clock starts at
const NOW = new Date('2026-11-12T10:00:00Z');

// How long a note counts: a quarter of an hour
const WAIT_MS = 15 * 60 * 1000;







// -----------------------------------------------------------
// The note
// -----------------------------------------------------------
//
// Written on the press, read on the student's return, dropped
// when the wallet shows up.
// -----------------------------------------------------------

describe('the note of an install started', () => {

  it('is kept under walletInstall:<wallet> as the time of the press', () => {
    vi.useFakeTimers({ now: NOW });
    noteInstallStarted('MetaMask');
    expect(localStorage.getItem('walletInstall:MetaMask')).toBe(String(NOW.getTime()));
  });


  it('counts from the press on', () => {
    vi.useFakeTimers({ now: NOW });
    expect(installUnderWay('MetaMask')).toBe(false);
    noteInstallStarted('MetaMask');
    expect(installUnderWay('MetaMask')).toBe(true);
  });


  it('still counts just under a quarter of an hour later, and no longer at a quarter of an hour', () => {
    vi.useFakeTimers({ now: NOW });
    noteInstallStarted('MetaMask');
    vi.setSystemTime(NOW.getTime() + WAIT_MS - 1);
    expect(installUnderWay('MetaMask')).toBe(true);
    vi.setSystemTime(NOW.getTime() + WAIT_MS);
    expect(installUnderWay('MetaMask')).toBe(false);
  });


  it('starts the wait over with a later press', () => {
    vi.useFakeTimers({ now: NOW });
    noteInstallStarted('MetaMask');
    vi.setSystemTime(NOW.getTime() + WAIT_MS - 1000);
    noteInstallStarted('MetaMask');
    vi.setSystemTime(NOW.getTime() + WAIT_MS + 60_000);
    expect(installUnderWay('MetaMask')).toBe(true);
  });


  it('is one per wallet — Phantom on its way says nothing about MetaMask', () => {
    vi.useFakeTimers({ now: NOW });
    noteInstallStarted('Phantom');
    expect(installUnderWay('Phantom')).toBe(true);
    expect(installUnderWay('MetaMask')).toBe(false);
  });


  it('is dropped by forgetInstall, that wallet\'s alone', () => {
    vi.useFakeTimers({ now: NOW });
    noteInstallStarted('MetaMask');
    noteInstallStarted('Phantom');
    forgetInstall('MetaMask');
    expect(localStorage.getItem('walletInstall:MetaMask')).toBeNull();
    expect(installUnderWay('MetaMask')).toBe(false);
    expect(installUnderWay('Phantom')).toBe(true);
  });


  it.each([
    ['a time in the future (the clock was set back)', String(NOW.getTime() + 60_000)],
    ['something that is no time', 'vakar'],
    ['an empty entry', ''],
    ['zero', '0'],
    ['a negative time', '-5'],
  ])('does not count when the entry holds %s', (_, value) => {
    vi.useFakeTimers({ now: NOW });
    localStorage.setItem('walletInstall:MetaMask', value);
    expect(installUnderWay('MetaMask')).toBe(false);
  });
});







// -----------------------------------------------------------
// A browser that blocks storage
// -----------------------------------------------------------
//
// Private modes and locked-down profiles throw on every
// access: nothing is remembered, nothing breaks.
// -----------------------------------------------------------

describe('with storage blocked', () => {

  const blockStorage = () => {
    const refuse = () => { throw new DOMException('The operation is insecure.', 'SecurityError'); };
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(refuse);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(refuse);
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(refuse);
  };


  it('notes nothing, awaits nothing and forgets nothing — without throwing', () => {
    blockStorage();
    expect(() => noteInstallStarted('MetaMask')).not.toThrow();
    expect(installUnderWay('MetaMask')).toBe(false);
    expect(() => forgetInstall('MetaMask')).not.toThrow();
  });
});
