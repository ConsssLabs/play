// installBridge — wires window.consss = { connect, mint, uploadToWalrus,
// readFromWalrus } so the Godot HTML5 shell can call into Sui + Walrus via
// JavaScriptBridge.create_callback().
//
// Every entry point follows the same shape:
//   window.consss.<fn>(arg, callback)
// where `callback` is a Godot JavaScriptObject invoked with a single Array
// containing a result dict: { ...fields, error: string | null }. We never
// throw across the bridge — failures are surfaced via `error`.

import { createSuiClient } from './sui-client.js';
import { connect as walletConnect, signAndExecute, getConnected } from './wallet.js';
import { uploadString, fetchString, blobUrl } from './walrus.js';
import { buildMintTransaction, extractChronicleId } from './mint.js';
import { getOwnedChronicles } from './chronicles.js';

export function installBridge(config) {
  const suiClient = createSuiClient(config);
  const chain = `sui:${config.network}`;

  function invoke(cb, result) {
    try {
      cb([result]);
    } catch (e) {
      console.error('[consss] callback invocation failed', e);
    }
  }

  async function safe(cb, fn) {
    try {
      const result = await fn();
      invoke(cb, { ...result, error: null });
    } catch (e) {
      console.error('[consss] bridge error', e);
      invoke(cb, { error: e?.message ?? String(e) });
    }
  }

  window.consss = {
    config,
    suiClient,

    connect(cb) {
      safe(cb, async () => {
        const { address, walletName } = await walletConnect();
        return { address, walletName };
      });
    },

    uploadToWalrus(jsonString, cb) {
      safe(cb, async () => {
        const { blobId, status } = await uploadString(jsonString, config);
        return { blobId, status, url: blobUrl(blobId, config) };
      });
    },

    readFromWalrus(blobId, cb) {
      safe(cb, async () => {
        const data = await fetchString(blobId, config);
        return { data };
      });
    },

    mint(payloadJson, cb) {
      safe(cb, async () => {
        const payload = JSON.parse(payloadJson);
        const { account } = getConnected();
        if (!account) throw new Error('Wallet not connected — call connect() first.');

        const tx = buildMintTransaction(payload, config);
        const result = await signAndExecute({ transaction: tx, chain });

        const objectId = extractChronicleId(result, account.address);
        return {
          digest: result.digest,
          objectId,
        };
      });
    },

    getOwnedChronicles(address, cb) {
      safe(cb, async () => {
        const owner = address || getConnected()?.account?.address;
        if (!owner) throw new Error('No wallet address provided — connect first or pass address.');
        const chronicles = await getOwnedChronicles(suiClient, owner, config);
        return { address: owner, chroniclesJson: JSON.stringify(chronicles) };
      });
    },
  };
}
