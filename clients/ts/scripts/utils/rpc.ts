/**
 * RPC configuration utilities for scripts
 *
 * Loads configuration from .env file and creates RPC clients.
 */

import {
  createDefaultRpcTransport,
  createSolanaRpcFromTransport,
  createSolanaRpcSubscriptionsFromTransport,
  createDefaultRpcSubscriptionsTransport,
  type Rpc,
  type RpcSubscriptions,
} from "@solana/kit";
import { config } from "dotenv";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env from clients/ts directory
config({ path: join(__dirname, "../../.env") });

// Default to public devnet if no env configured
const DEFAULT_RPC_URL = "https://api.devnet.solana.com";
const DEFAULT_WS_URL = "wss://api.devnet.solana.com";

/**
 * Get RPC URL from environment
 */
export function getRpcUrl(): string {
  return process.env.SOLANA_RPC_URL || DEFAULT_RPC_URL;
}

/**
 * Get WebSocket URL from environment
 */
export function getWsUrl(): string {
  if (process.env.SOLANA_WS_URL) {
    return process.env.SOLANA_WS_URL;
  }
  // Derive from HTTP URL if not set
  const httpUrl = getRpcUrl();
  return httpUrl.replace("https://", "wss://").replace("http://", "ws://");
}

/**
 * Create an RPC client using environment configuration
 */
export function createRpc(): Rpc<any> {
  const url = getRpcUrl();
  const transport = createDefaultRpcTransport({ url });
  return createSolanaRpcFromTransport(transport);
}

/**
 * Create an RPC subscriptions client using environment configuration
 */
export function createRpcSubscriptions(): RpcSubscriptions<any> {
  const url = getWsUrl();
  const transport = createDefaultRpcSubscriptionsTransport({ url });
  return createSolanaRpcSubscriptionsFromTransport(transport);
}

/**
 * Log RPC configuration (for debugging)
 */
export function logRpcConfig(): void {
  console.log(`RPC: ${getRpcUrl()}`);
  console.log(`WS:  ${getWsUrl()}`);
}
