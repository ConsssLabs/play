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
    chroniclePackageId: '0x5efb10426a8929e88510dbc80711e2bf371aca08b179167b3037e20d097f6980',
    chronicleRegistryId: '0x19b9f0fe18ea27a56f75b6d6302e00e80a9bf1656c81f87eecbb82a4bc3109ee',
    witnessRegistryId: '0x7359529def5f8a225e6e7c460ff44ee4f276bdd5ce50c0c7b1e10faaa3e831d0',
  },

  walrus: {
    publisherUrl: 'https://publisher.walrus-testnet.walrus.space',
    aggregatorUrl: 'https://aggregator.walrus-testnet.walrus.space',
    storageEpochs: 5,
  },
};
