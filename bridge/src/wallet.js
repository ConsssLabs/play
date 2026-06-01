// Wallet discovery + connect + sign via @mysten/wallet-standard.
//
// No React, no dapp-kit. The Wallet Standard is a vanilla-JS API every Sui
// wallet (Sui Wallet, Suiet, Phantom, etc.) implements; we discover the
// installed wallets and prefer Sui-native ones over multi-chain wallets
// that happen to also support Sui (Binance, OKX, Phantom).

import { getWallets } from '@mysten/wallet-standard';

let _wallet = null;
let _account = null;

// Lower index = higher preference. Matched against wallet.name (case-insensitive
// substring). Sui-native wallets come first; multi-chain wallets last so they
// only get picked when nothing else is installed.
const WALLET_PREFERENCE = [
  'slush',          // Slush — current Mysten Labs official Sui wallet (2025+)
  'sui wallet',     // Sui Wallet — legacy Mysten Labs name
  'suiet',          // Suiet — popular community Sui wallet
  'surf',           // Surf Wallet
  'martian',        // Martian Wallet (also supports Aptos)
  'okx',            // OKX Wallet (multi-chain, prefers their own chains)
  'phantom',        // Phantom (primarily Solana)
  'binance',        // Binance Wallet (multi-chain, Sui as one of many)
];

function findSuiWallet() {
  const all = getWallets().get();
  const suiCapable = all.filter((w) =>
    (w.chains || []).some((c) => typeof c === 'string' && c.startsWith('sui:')),
  );
  if (suiCapable.length === 0) return null;
  if (suiCapable.length === 1) return suiCapable[0];

  // Rank by preference. Wallets matching a preference entry sort earlier;
  // unmatched (unknown) wallets go after all matched ones but before the
  // multi-chain fallbacks if we explicitly listed them.
  function rank(wallet) {
    const name = (wallet.name || '').toLowerCase();
    for (let i = 0; i < WALLET_PREFERENCE.length; i++) {
      if (name.includes(WALLET_PREFERENCE[i])) return i;
    }
    return WALLET_PREFERENCE.length; // unknown wallets: tied at the end of known
  }
  const sorted = [...suiCapable].sort((a, b) => rank(a) - rank(b));
  console.log(
    '[consss] %d Sui-capable wallets detected; picked %s. Detection order: %s',
    suiCapable.length,
    sorted[0].name,
    suiCapable.map((w) => w.name).join(', '),
  );
  return sorted[0];
}

export async function connect() {
  const wallet = findSuiWallet();
  if (!wallet) {
    throw new Error(
      'No Sui wallet detected. Install Sui Wallet, Suiet, or another Wallet-Standard-compatible Sui wallet.',
    );
  }

  const connectFeature = wallet.features['standard:connect'];
  if (!connectFeature) {
    throw new Error(`Wallet "${wallet.name}" does not implement standard:connect.`);
  }

  const { accounts } = await connectFeature.connect();
  if (!accounts || accounts.length === 0) {
    throw new Error('Wallet returned no accounts.');
  }

  _wallet = wallet;
  _account = accounts[0];
  return { address: _account.address, walletName: wallet.name };
}

export function getConnected() {
  return { wallet: _wallet, account: _account };
}

export async function signAndExecute({ transaction, chain }) {
  if (!_wallet || !_account) {
    throw new Error('Wallet not connected — call connect() first.');
  }
  const feature = _wallet.features['sui:signAndExecuteTransaction'];
  if (!feature) {
    throw new Error(
      `Wallet "${_wallet.name}" does not implement sui:signAndExecuteTransaction.`,
    );
  }
  return feature.signAndExecuteTransaction({
    transaction,
    account: _account,
    chain,
  });
}
