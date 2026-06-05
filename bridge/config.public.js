// Public, committable bridge config for play.conssswars.com.
//
// NO secrets here. Sui RPC goes through the same-origin /rpc Cloudflare Pages
// Function (functions/[[path]].js), which holds the Tatum API key as a
// server-side secret (CF Pages env var TATUM_API_KEY) and falls back to the
// public Sui fullnode — so the key is never shipped to the browser.
//
// IDs below are public on-chain data (2026-06-05 testnet redeploy of the
// restructured chronicle package: chronicle + echoes_of_chainoa modules).

export const CONSSS_CONFIG = {
  network: 'testnet',

  // Same-origin RPC proxy path; resolved against the page origin by
  // sui-client.js. The Tatum key + public fallback live in the Function.
  rpcProxyPath: '/rpc',

  sui: {
    chroniclePackageId: '0xe6d697993e777535844f7916be78e9a76de0cb14448cb6db4a34893190b87e60',
    chronicleRegistryId: '0xd2fd91abd54d954ec457af81bc86613040a9b71abde43613ec51765a230d921f',
    finaleRegistryId: '0x5962cf4322b2a288ec7ec3a448501af6ceab741f3991ff1e240bce728efe6bc3',
  },

  walrus: {
    publisherUrl: 'https://publisher.walrus-testnet.walrus.space',
    aggregatorUrl: 'https://aggregator.walrus-testnet.walrus.space',
    storageEpochs: 5,
  },
};
