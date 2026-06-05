// Public, committable bridge config for play.conssswars.com.
//
// NO secrets here. Sui RPC goes through the same-origin /rpc Cloudflare Pages
// Function (functions/[[path]].js), which holds the Tatum API key as a
// server-side secret (CF Pages env var TATUM_API_KEY) and falls back to the
// public Sui fullnode — so the key is never shipped to the browser.
//
// IDs below are public on-chain data (2026-06-05 MAINNET launch of the
// restructured chronicle package: chronicle + echoes_of_chainoa modules).

export const CONSSS_CONFIG = {
  network: 'mainnet',

  // Same-origin RPC proxy path; resolved against the page origin by
  // sui-client.js. The Tatum key + public fallback live in the Function.
  rpcProxyPath: '/rpc',

  sui: {
    chroniclePackageId: '0x5760b2685d41bd45e2991dedc242e866b1aca9ff3c3a5e193445751c2b8dfe4b',
    chronicleRegistryId: '0x9ff1d9e50e8feca77ccddf5901bd774d3baa4732dac37ae261ca36b2352ced8b',
    finaleRegistryId: '0x2c752d82144701e2b476cd35fd8c5482c9f3aabfe27e155729b657b369493d19',
  },

  walrus: {
    publisherUrl: 'https://publisher.walrus-mainnet.walrus.space',
    aggregatorUrl: 'https://aggregator.walrus-mainnet.walrus.space',
    storageEpochs: 5,
  },
};
