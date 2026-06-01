// Tatum-routed SuiClient factory with public-fullnode fallback.
//
// Tatum is the hackathon-required RPC gateway: requests go to api.tatum.io
// with an `x-api-key` header. We wrap that in a custom `fetch` so a Tatum
// failure (rate limit, revoked key, regional outage) silently falls over
// to the free Sui public fullnode. The fallback keeps reads — chronicles
// query, save records, hero/talent unlock detection — working when Tatum
// can't answer. mint() doesn't use this client at all (it goes through
// the player's wallet), so writes are unaffected either way.

import {
  SuiJsonRpcClient,
  JsonRpcHTTPTransport,
} from '@mysten/sui/jsonRpc';

const DEFAULT_PUBLIC_FALLBACK = 'https://fullnode.testnet.sui.io:443';

export function createSuiClient(config) {
  const { apiKey, suiRpcUrl } = config.tatum;
  const fallbackUrl = config.sui?.publicRpcUrl || DEFAULT_PUBLIC_FALLBACK;

  if (!apiKey || apiKey.startsWith('PUT_YOUR_')) {
    console.warn(
      '[consss] Tatum API key is unset — RPC calls will hit Tatum without auth and likely 401, then fall back to public fullnode.',
    );
  }

  return new SuiJsonRpcClient({
    transport: new JsonRpcHTTPTransport({
      url: suiRpcUrl,
      // Custom fetch: Tatum first, fall back on HTTP error or network exception.
      // Sui RPC reads are idempotent so retrying the same payload elsewhere
      // is safe. We log every fallback so degraded behavior is visible in
      // the browser console; if Tatum is consistently down the noise is
      // intentional (signals key/dashboard misconfiguration).
      fetch: async (_url, init) => {
        const tatumInit = withApiKey(init, apiKey);
        try {
          const resp = await fetch(suiRpcUrl, tatumInit);
          if (resp.status >= 200 && resp.status < 400) return resp;
          console.warn(
            `[consss] Tatum returned HTTP ${resp.status} — falling back to public RPC (${fallbackUrl})`,
          );
        } catch (e) {
          console.warn(
            `[consss] Tatum network error (${e?.message ?? e}) — falling back to public RPC (${fallbackUrl})`,
          );
        }
        return fetch(fallbackUrl, stripApiKey(init));
      },
    }),
  });
}

function withApiKey(init, apiKey) {
  const headers = new Headers(init?.headers);
  if (apiKey) headers.set('x-api-key', apiKey);
  return { ...init, headers };
}

function stripApiKey(init) {
  const headers = new Headers(init?.headers);
  headers.delete('x-api-key');
  return { ...init, headers };
}
