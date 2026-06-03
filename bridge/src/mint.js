// Transaction builder for chronicle::chronicle::mint_chronicle (voucher-gated).
//
// Flow (driven by bridge.js mint()):
//   1. fetchVoucher() — POST the clear report to the same-origin /mint-voucher
//      Pages Function, which signs an authority ed25519 voucher attesting hp_pct
//      (anti-cheat: the contract rejects any mint without a valid voucher).
//   2. buildMintTransaction() — moveCall mint_chronicle with the report + voucher.
//      Tier (gold/silver/bronze/normal) is computed ON-CHAIN from per-battle rank
//      + hp_pct; we don't pass a tier.

import { Transaction } from '@mysten/sui/transactions';

const SUI_CLOCK_OBJECT_ID = '0x6';
const DEFAULT_VOUCHER_PATH = '/mint-voucher';

function hexToBytes(h) {
  const s = String(h).replace(/^0x/, '');
  const a = new Uint8Array(s.length / 2);
  for (let i = 0; i < a.length; i++) a[i] = parseInt(s.substr(i * 2, 2), 16);
  return a;
}

/** POST the clear report to the same-origin voucher endpoint. */
export async function fetchVoucher(report, config) {
  const path = config.voucherPath || DEFAULT_VOUCHER_PATH;
  const url =
    typeof location !== 'undefined' && location.origin
      ? new URL(path, location.origin).toString()
      : path;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(report),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || data.error) {
    throw new Error(`voucher request failed: ${data.error || resp.status}`);
  }
  return data; // { player, battle_id, hero_id, hp_pct, nonce, expiry_ms, signature }
}

export function buildMintTransaction(payload, voucher, config) {
  const { battleId, heroId, title, inscription, hpPct, metadataBlobId } = payload;

  if (typeof battleId !== 'number') throw new Error('payload.battleId must be number');
  if (typeof heroId !== 'number') throw new Error('payload.heroId must be number');
  if (typeof hpPct !== 'number') throw new Error('payload.hpPct must be number');
  if (!title || typeof title !== 'string') throw new Error('payload.title must be non-empty string');
  if (typeof inscription !== 'string') throw new Error('payload.inscription must be string');
  if (!metadataBlobId || typeof metadataBlobId !== 'string') {
    throw new Error('payload.metadataBlobId must be non-empty string');
  }
  if (!voucher || !voucher.signature) throw new Error('missing voucher');

  const enc = new TextEncoder();
  const tx = new Transaction();

  tx.moveCall({
    target: `${config.sui.chroniclePackageId}::chronicle::mint_chronicle`,
    arguments: [
      tx.object(config.sui.chronicleRegistryId),
      tx.pure.u8(battleId),
      tx.pure.u8(heroId),
      tx.pure.vector('u8', Array.from(enc.encode(title))),
      tx.pure.vector('u8', Array.from(enc.encode(inscription))),
      tx.pure.u8(hpPct),
      tx.pure.vector('u8', Array.from(enc.encode(metadataBlobId))),
      tx.pure.u64(voucher.nonce),       // string -> u64 (precision-safe)
      tx.pure.u64(voucher.expiry_ms),   // string -> u64
      tx.pure.vector('u8', Array.from(hexToBytes(voucher.signature))),
      tx.object(SUI_CLOCK_OBJECT_ID),
    ],
  });

  return tx;
}

/**
 * Pull the minted Chronicle object id out of a sign-and-execute result.
 * Looks for the first created object owned by the player.
 */
export function extractChronicleId(result, playerAddress) {
  const created = result.effects?.created ?? result.objectChanges ?? [];
  for (const entry of created) {
    if (entry.type === 'created' && entry.objectId) {
      const owner = entry.owner?.AddressOwner ?? entry.owner;
      if (typeof owner === 'string' && owner === playerAddress) {
        return entry.objectId;
      }
      if (!playerAddress) return entry.objectId;
    }
    if (entry.reference?.objectId) {
      return entry.reference.objectId;
    }
  }
  return null;
}
