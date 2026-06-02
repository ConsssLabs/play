// Public, committable bridge config for play.conssswars.com.
//
// NO secrets here. Sui RPC goes through the same-origin /rpc Cloudflare Pages
// Function (functions/[[path]].js), which holds the Tatum API key as a
// server-side secret (CF Pages env var TATUM_API_KEY) and falls back to the
// public Sui fullnode — so the key is never shipped to the browser.
//
// IDs below are public on-chain data (2026-05-30 testnet Chronicle deploy).

export const CONSSS_CONFIG = {
  network: 'testnet',

  // Same-origin RPC proxy path; resolved against the page origin by
  // sui-client.js. The Tatum key + public fallback live in the Function.
  rpcProxyPath: '/rpc',

  sui: {
    chroniclePackageId: '0xe2615442e222c8e05aab163fb065a3a08941ac309734dd465eab8753f23a52ed',
    chronicleRegistryId: '0x62a73974beefcaca4eb752b4b91918b8bce1d9f4f38d2757ffc9e0bbbddbf21c',
    witnessRegistryId: '0x58c6cec4efa842518f6c074f7ed9308f0956062f63bf1c56fae6482a19bcaac4',
  },

  walrus: {
    publisherUrl: 'https://publisher.walrus-testnet.walrus.space',
    aggregatorUrl: 'https://aggregator.walrus-testnet.walrus.space',
    storageEpochs: 5,
  },
};
