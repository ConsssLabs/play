// SuiClient factory — talks to a SAME-ORIGIN RPC proxy (/rpc), never to Tatum
// directly. The Tatum API key lives only in the Cloudflare Pages Function
// (functions/[[path]].js, /rpc branch) as a server-side secret, so it is NEVER
// shipped to the browser. That Function adds the x-api-key header, forwards to
// Tatum, and falls back to the public Sui fullnode on failure. mint() goes
// through the player's wallet and doesn't use this client.

import {
  SuiJsonRpcClient,
  JsonRpcHTTPTransport,
} from '@mysten/sui/jsonRpc';

const DEFAULT_PROXY_PATH = '/rpc';

export function createSuiClient(config) {
  const path = config.rpcProxyPath || DEFAULT_PROXY_PATH;
  // Resolve against the page origin so JSON-RPC POSTs hit our own Pages
  // Function (same-origin → no CORS, no exposed key).
  const url =
    typeof location !== 'undefined' && location.origin
      ? new URL(path, location.origin).toString()
      : path;

  return new SuiJsonRpcClient({
    transport: new JsonRpcHTTPTransport({ url }),
  });
}
