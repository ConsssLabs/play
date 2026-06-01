// Public, committable bridge config for play.conssswars.com.
//
// Everything here is PUBLIC on-chain / public-endpoint data — safe to commit.
// The ONLY secret, the Tatum API key, is NOT here: it is injected at build
// time from the TATUM_API_KEY environment variable (a Cloudflare Pages
// secret) via the `__TATUM_API_KEY__` placeholder, which scripts/build.mjs
// replaces with esbuild `define`. If TATUM_API_KEY is unset the key is empty
// and sui-client.js falls back to the public RPC (sui.publicRpcUrl), so the
// game still works — just without the Tatum gateway.
//
// IDs below come from the 2026-05-30 testnet Chronicle deploy.

export const CONSSS_CONFIG = {
  network: 'testnet',

  tatum: {
    apiKey: __TATUM_API_KEY__,
    suiRpcUrl: 'https://sui-testnet.gateway.tatum.io',
  },

  sui: {
    chroniclePackageId: '0xe2615442e222c8e05aab163fb065a3a08941ac309734dd465eab8753f23a52ed',
    chronicleRegistryId: '0x62a73974beefcaca4eb752b4b91918b8bce1d9f4f38d2757ffc9e0bbbddbf21c',
    witnessRegistryId: '0x58c6cec4efa842518f6c074f7ed9308f0956062f63bf1c56fae6482a19bcaac4',
    publicRpcUrl: 'https://fullnode.testnet.sui.io:443',
  },

  walrus: {
    publisherUrl: 'https://publisher.walrus-testnet.walrus.space',
    aggregatorUrl: 'https://aggregator.walrus-testnet.walrus.space',
    storageEpochs: 5,
  },
};
