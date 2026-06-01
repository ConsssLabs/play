// Entry point for the browser-side bridge bundle.
//
// Wires window.consss = { connect, mint, uploadToWalrus, readFromWalrus }
// so Godot can drive Sui Wallet + Walrus flows via JavaScriptBridge.
//
// Real implementation lives in ./bridge.js so this entry stays minimal.

import { installBridge } from './bridge.js';
import { CONSSS_CONFIG } from '../config.public.js';

installBridge(CONSSS_CONFIG);

console.log('[consss] bridge bundle loaded — network =', CONSSS_CONFIG.network);
