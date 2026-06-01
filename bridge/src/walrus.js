// Walrus HTTP wrappers — publisher for writes, aggregator for reads.
//
// We use the public Walrus HTTP API instead of the @mysten/walrus client SDK
// because the publisher pays for storage (no client-side encoding / no extra
// wallet tx). This is the canonical Walrus integration pattern documented at
// https://docs.walrus.site/usage/web-api.html and satisfies the hackathon's
// "Walrus is core functionality" criterion identically.

/**
 * Upload a UTF-8 string (the chronicle JSON payload) to Walrus.
 * Returns the blob ID — caller stores it in the on-chain Chronicle.
 */
export async function uploadString(jsonString, config) {
  const { publisherUrl, storageEpochs } = config.walrus;
  const url = `${publisherUrl}/v1/blobs?epochs=${storageEpochs}`;

  const res = await fetch(url, {
    method: 'PUT',
    body: new Blob([jsonString], { type: 'application/json' }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Walrus publisher PUT failed: ${res.status} ${res.statusText} ${body}`);
  }

  const json = await res.json();
  // Publisher returns either { newlyCreated: { blobObject: { blobId } } } or
  // { alreadyCertified: { blobId } }. Normalise both.
  if (json.newlyCreated?.blobObject?.blobId) {
    return { blobId: json.newlyCreated.blobObject.blobId, status: 'newlyCreated' };
  }
  if (json.alreadyCertified?.blobId) {
    return { blobId: json.alreadyCertified.blobId, status: 'alreadyCertified' };
  }
  throw new Error(`Walrus publisher returned unexpected shape: ${JSON.stringify(json)}`);
}

/**
 * Fetch a Walrus blob by ID and return its contents as a UTF-8 string.
 */
export async function fetchString(blobId, config) {
  const { aggregatorUrl } = config.walrus;
  const url = `${aggregatorUrl}/v1/blobs/${encodeURIComponent(blobId)}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Walrus aggregator GET failed: ${res.status} ${res.statusText}`);
  }
  return res.text();
}

/**
 * Build the public URL for a Walrus blob — handy for Display image_url fields
 * or for opening the chronicle in a new tab.
 */
export function blobUrl(blobId, config) {
  return `${config.walrus.aggregatorUrl}/v1/blobs/${encodeURIComponent(blobId)}`;
}
