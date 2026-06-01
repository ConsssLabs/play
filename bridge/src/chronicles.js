// Read-side queries for Chronicle NFTs.
//
// getOwnedChronicles(address) returns every Chronicle the wallet currently
// owns, parsed into the shape Godot expects. The on-chain struct is
// `<package>::chronicle::Chronicle` so we filter `getOwnedObjects` by that
// MoveModule type and unwrap `data.content.fields`.
//
// Notes:
//   * mint_order and mint_timestamp_ms are u64 on-chain. The SDK serialises
//     them as strings; we coerce to Number because mint counts and ms
//     timestamps both fit in JS safe integers for any realistic usage.
//   * Paging: getOwnedObjects returns up to 50 per page. We loop on
//     hasNextPage so a power user holding many chronicles is fully covered.

const PAGE_LIMIT = 50;

export async function getOwnedChronicles(suiClient, address, config) {
  const structType = `${config.sui.chroniclePackageId}::chronicle::Chronicle`;

  const out = [];
  let cursor = null;
  for (;;) {
    const page = await suiClient.getOwnedObjects({
      owner: address,
      filter: { StructType: structType },
      options: {
        showType: true,
        showContent: true,
        showDisplay: false,
        showOwner: false,
      },
      cursor,
      limit: PAGE_LIMIT,
    });

    for (const entry of page.data ?? []) {
      const parsed = parseChronicle(entry);
      if (parsed) out.push(parsed);
    }

    if (!page.hasNextPage || !page.nextCursor) break;
    cursor = page.nextCursor;
  }

  // Most-recent first (consistent display across hero select, save records,
  // talent screen). Falls back to mint_order if timestamps tie.
  out.sort((a, b) => {
    if (b.mint_timestamp_ms !== a.mint_timestamp_ms) {
      return b.mint_timestamp_ms - a.mint_timestamp_ms;
    }
    return b.mint_order - a.mint_order;
  });

  return out;
}

function parseChronicle(entry) {
  const data = entry?.data;
  if (!data?.objectId) return null;
  const fields = data?.content?.fields;
  if (!fields) return null;
  return {
    objectId: data.objectId,
    battle_id: Number(fields.battle_id ?? 0),
    hero_id: Number(fields.hero_id ?? 0),
    title: String(fields.title ?? ''),
    inscription: String(fields.inscription ?? ''),
    rating: Number(fields.rating ?? 0),
    mint_order: Number(fields.mint_order ?? 0),
    is_first_chronicler: Boolean(fields.is_first_chronicler),
    mint_timestamp_ms: Number(fields.mint_timestamp_ms ?? 0),
    metadata_blob_id: String(fields.metadata_blob_id ?? ''),
    player: String(fields.player ?? ''),
  };
}
