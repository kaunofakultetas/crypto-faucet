// -----------------------------------------------------------
//  [*] MetaMask tests — fetching the extension at build time
//
//  Downloads one build of the MetaMask extension and unpacks
//  it where the tests load it from. Run once while the test
//  image is built (Dockerfile.metamask), never by a test.
//
//  Which build is the first argument. The word for the store
//  asks the Chrome Web Store for whatever it serves today —
//  the build a student who installs MetaMask this morning
//  gets, which is the point of these tests. A version number
//  takes that release from MetaMask's GitHub instead, so a
//  failure can be compared against the build before it.
//
//  The unpacked copy is given the store's public key, and
//  with it the store's extension id: Chromium derives an
//  unpacked extension's id from its folder otherwise, and the
//  faucet page looks for MetaMask under the id students have.
//  The folder the store adds for its own signatures is
//  dropped — Chromium refuses to load an unpacked extension
//  that carries it.
// -----------------------------------------------------------

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';


// The first argument that means "whatever the store serves"
const FROM_STORE = 'store';

// MetaMask's extension id in the Chrome Web Store
const STORE_ID = 'nkbihfbeogaeaoehlefnkodbefgpgknn';

// The public key the store signs MetaMask's packages with, as
// every package carries it — the extension id is derived from
// it, which main() checks before trusting the constant
const STORE_KEY = 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAlcgI4VVL4JUvo6hlSgeCZp9mGltZrzFvc2Asqzb1dDGO9baoYOe+QRoh27/YyVXugxni480Q/R147INhBOyQZVMhZOD5pFMVutia9MHMaZhgRXzrK3BHtNSkKLL1c5mhutQNwiLqLtFkMSGvka91LoMEC8WTI0wi4tACnJ5FyFZQYzvtqy5sXo3VS3gzfOBluLKi7BxYcaUJjNrhOIxl1xL2qgK5lDrDOLKcbaurDiwqofVtAFOL5sM3uJ6D8nOO9tG+T7hoobRFN+nxk43PHgCv4poicOv+NMZQEk3da1m/xfuzXV88NcE/YRbRLwAS82m3gsJZKc6mLqm4wZHzBwIDAQAB';

// The first four bytes of a store package: a zip archive
// behind a header of the store's own
const CRX_MAGIC = 'Cr24';







// -----------------------------------------------------------
// chromiumVersion
// -----------------------------------------------------------
//
// The version of the Chromium the tests run in, as Playwright
// records it — the store is asked for the build it would give
// THAT browser, since it serves a build only to browsers new
// enough for it.
//
// Used by:
//   - download (below) — the store's address
// -----------------------------------------------------------

function chromiumVersion() {
  const playwright = path.dirname(createRequire(import.meta.url).resolve('playwright-core/package.json'));
  const { browsers } = JSON.parse(fs.readFileSync(path.join(playwright, 'browsers.json'), 'utf8'));
  return browsers.find((browser) => browser.name === 'chromium').browserVersion;
}







// -----------------------------------------------------------
// download
// -----------------------------------------------------------
//
// The package's bytes: from the store's update service, which
// answers with a redirect to the newest build, or from the
// release of that version on GitHub. The store answers a
// browser too old for the newest build with nothing at all,
// not with an older build — that is said as what it is, the
// image's Chromium having fallen behind MetaMask, since the
// unpacking that follows would only complain about a broken
// archive.
//
// Used by:
//   - main (below)
// -----------------------------------------------------------

async function download(version) {
  const address = version === FROM_STORE
    ? `https://clients2.google.com/service/update2/crx?response=redirect&prodversion=${chromiumVersion()}&acceptformat=crx2,crx3&x=id%3D${STORE_ID}%26uc`
    : `https://github.com/MetaMask/metamask-extension/releases/download/v${version}/metamask-chrome-${version}.zip`;

  const response = await fetch(address, { redirect: 'follow' });
  if (!response.ok) throw new Error(`MetaMask ${version}: ${address} answered ${response.status}`);

  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length === 0 && version === FROM_STORE) {
    throw new Error(`The Chrome Web Store has no MetaMask for Chromium ${chromiumVersion()}: the newest build needs a newer browser than this image carries. Move Playwright to a newer release, in Dockerfile.metamask and in app/tests-metamask/package.json alike.`);
  }
  if (bytes.length === 0) throw new Error(`MetaMask ${version}: ${address} answered with nothing`);
  return bytes;
}







// -----------------------------------------------------------
// zipOf
// -----------------------------------------------------------
//
// The zip archive inside a package. A store package is that
// archive behind a header — the magic word, a format version
// and the header's length, then the header itself — which is
// cut off; a release from GitHub is the archive already.
//
// Used by:
//   - main (below)
// -----------------------------------------------------------

function zipOf(bytes) {
  if (bytes.subarray(0, 4).toString('latin1') !== CRX_MAGIC) return bytes;
  const headerLength = bytes.readUInt32LE(8);
  return bytes.subarray(12 + headerLength);
}







// -----------------------------------------------------------
// extensionIdOf
// -----------------------------------------------------------
//
// The id Chromium gives an extension with this public key:
// the first half of the key's SHA-256, each hex digit moved
// into the letters a to p.
//
// Used by:
//   - main (below) — the check on STORE_KEY
// -----------------------------------------------------------

function extensionIdOf(publicKey) {
  const digest = crypto.createHash('sha256').update(Buffer.from(publicKey, 'base64')).digest('hex').slice(0, 32);
  return [...digest].map((digit) => String.fromCharCode(97 + parseInt(digit, 16))).join('');
}







// -----------------------------------------------------------
// main
// -----------------------------------------------------------
//
// Fetches the build, unpacks it into the folder named by the
// second argument — with Python's zip module, which the
// browser image carries, where an unzip program is missing —
// drops the store's signature folder, writes the store's key
// into the manifest and says which version it got. Ends the
// build with an error when the download fails or the key no
// longer gives the store's id.
//
// Used by:
//   - Dockerfile.metamask — while the image is built
// -----------------------------------------------------------

async function main() {
  const [version = FROM_STORE, folder = '/work/extension'] = process.argv.slice(2);
  if (extensionIdOf(STORE_KEY) !== STORE_ID) throw new Error('STORE_KEY does not give the store\'s extension id');

  const archive = path.join(os.tmpdir(), 'metamask.zip');
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(archive, zipOf(await download(version)));
  execFileSync('python3', ['-m', 'zipfile', '-e', archive, folder], { stdio: 'inherit' });
  fs.rmSync(archive);
  fs.rmSync(path.join(folder, '_metadata'), { recursive: true, force: true });

  const manifestPath = path.join(folder, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.key = STORE_KEY;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));

  console.log(`MetaMask ${manifest.version} (${version === FROM_STORE ? 'the Chrome Web Store\'s build today' : 'GitHub release'}) unpacked into ${folder}`);
}

await main();
