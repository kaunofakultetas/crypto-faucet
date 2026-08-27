// -----------------------------------------------------------
//  [*] AssetIcon — the identity mark of a network or token
//
//  Renders the crypto asset's icon when the backend
//  advertises one (a file the operator dropped into the
//  mounted _CONFIG/icons folder — the catalog payloads carry
//  the /api/icons/... URL); otherwise, or if the image fails
//  to load, a stable coloured hash-dot derived from the
//  asset's key — so assets without an icon file stay
//  recognizable instead of broken, and every place in the app
//  shows the SAME mark for the same asset.
//
//  `inline` is for page TITLES: the mark becomes an inline
//  element riding the first line of text, so a long title
//  wraps underneath it at full width — as a flex sibling the
//  icon would reserve a column and squeeze every wrapped
//  line.
//
//  Split into (root component last):
//
//    colorFromString — stable per-key fallback colour
//    AssetIcon       — icon with dot fallback (default
//                      export)
//
//  Used by:
//    - components/FaucetPicker.jsx — menu rows + trigger
//    - pages/Faucet_ERC20/Page.jsx — token title, chain
//      cards, gas notice rows
//    - pages/Faucet_EVM/Page.jsx — page title
//    - pages/Faucet_SVM/Page.jsx — page title
//    - pages/Faucet_MOVE/Page.jsx — page title
//    - pages/Faucet_UTXO/Page.jsx — page title
// -----------------------------------------------------------

import { useEffect, useState } from 'react';

import { Box } from '@mui/material';







// -----------------------------------------------------------
// colorFromString
// -----------------------------------------------------------
//
// A stable HSL colour from any string — every network and
// every token gets its own recognizable fallback dot without
// anyone maintaining a palette.
//
// Used by:
//   - AssetIcon (below)
// -----------------------------------------------------------

function colorFromString(input) {
  if (!input) return 'grey.500';

  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0; // keep it a 32bit integer
  }

  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 65%, 55%)`;
}







// -----------------------------------------------------------
// AssetIcon (default export)
// -----------------------------------------------------------
//
//   <AssetIcon assetKey="sepolia" icon={payload.icon}
//              size={24} inline />
//
// icon is the backend-advertised URL or null; assetKey seeds
// the fallback colour, so it must be the CATALOG key, not a
// display name.
//
// Used by:
//   - see the file header
// -----------------------------------------------------------

export default function AssetIcon({ assetKey, icon = null, size = 10, inline = false }) {

  const [broken, setBroken] = useState(false);


  // The latch is per INSTANCE, and a page title keeps its
  // instance across network switches — without this reset one
  // failed fetch would show the dot for every asset after it
  useEffect(() => {
    setBroken(false);
  }, [icon]);


  // vertical-align: middle centres on the x-height, which sits
  // a hair LOW beside a title's capital letters — the translate
  // lifts the mark onto the cap-height centre instead, scaling
  // with the title's font size (em) and never touching layout
  const placementSx = inline
    ? {
        display: 'inline-block',
        verticalAlign: 'middle',
        transform: 'translateY(-0.1em)',
        mr: 1.5,
      }
    : { flex: '0 0 auto' };

  if (icon && !broken) {
    return (
      <Box
        component="img"
        src={icon}
        alt=""
        onError={() => setBroken(true)}
        sx={{
          width: size,
          height: size,
          objectFit: 'contain',
          ...placementSx,
        }}
      />
    );
  }

  return (
    <Box
      sx={{
        width: size,
        height: size,
        borderRadius: '50%',
        bgcolor: colorFromString(assetKey),
        ...placementSx,
      }}
    />
  );
}
