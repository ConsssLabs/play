// Transaction builder for chronicle::chronicle::mint_chronicle.
//
// Caller supplies a payload built by Godot's chronicle_mint_request.gd; we
// translate it into a Sui Transaction calling the on-chain entry function,
// then hand it to wallet.js to be signed + executed.

import { Transaction } from '@mysten/sui/transactions';

const SUI_CLOCK_OBJECT_ID = '0x6';

export function buildMintTransaction(payload, config) {
  const {
    battleId,
    heroId,
    title,
    inscription,
    rating,
    metadataBlobId,
  } = payload;

  if (typeof battleId !== 'number') throw new Error('payload.battleId must be number');
  if (typeof heroId !== 'number') throw new Error('payload.heroId must be number');
  if (typeof rating !== 'number') throw new Error('payload.rating must be number');
  if (!title || typeof title !== 'string') throw new Error('payload.title must be non-empty string');
  if (typeof inscription !== 'string') throw new Error('payload.inscription must be string');
  if (!metadataBlobId || typeof metadataBlobId !== 'string') {
    throw new Error('payload.metadataBlobId must be non-empty string');
  }

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
      tx.pure.u8(rating),
      tx.pure.vector('u8', Array.from(enc.encode(metadataBlobId))),
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
    // objectChanges shape: { type: 'created', sender, owner: { AddressOwner }, objectId, ... }
    if (entry.type === 'created' && entry.objectId) {
      const owner = entry.owner?.AddressOwner ?? entry.owner;
      if (typeof owner === 'string' && owner === playerAddress) {
        return entry.objectId;
      }
      if (!playerAddress) return entry.objectId;
    }
    // effects.created shape: { owner: { AddressOwner }, reference: { objectId } }
    if (entry.reference?.objectId) {
      return entry.reference.objectId;
    }
  }
  return null;
}
