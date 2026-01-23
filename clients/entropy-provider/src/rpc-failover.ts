import {
  createDefaultRpcTransport,
  createSolanaRpcFromTransport,
} from "@solana/kit";

export type RpcTransport = ReturnType<typeof createDefaultRpcTransport>;

export interface RpcFailoverOptions {
  baseDelayMs?: number;
  maxDelayMs?: number;
  failureThreshold?: number;
  cooldownMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  initialIndex?: number;
}

interface EndpointState {
  failures: number;
  circuitOpenUntil: number;
}

const DEFAULT_BASE_DELAY_MS = 250;
const DEFAULT_MAX_DELAY_MS = 5_000;
const DEFAULT_FAILURE_THRESHOLD = 3;
const DEFAULT_COOLDOWN_MS = 10_000;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function normalizeRpcUrls(urls: string[]): string[] {
  const cleaned = urls.map((url) => url.trim()).filter((url) => url.length > 0);
  return [...new Set(cleaned)];
}

export function resolveRpcUrls(config: { rpcUrl: string; rpcUrls?: string[] }): string[] {
  return normalizeRpcUrls([config.rpcUrl, ...(config.rpcUrls ?? [])]);
}

/** Transport function type for testing - accepts simplified mock transports */
type TransportFn = (request: { payload: unknown; signal?: AbortSignal }) => Promise<unknown>;

export function createFailoverTransport(
  transports: TransportFn[],
  options: RpcFailoverOptions = {}
): RpcTransport {
  if (transports.length === 0) {
    throw new Error("No RPC transports configured");
  }

  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const failureThreshold = options.failureThreshold ?? DEFAULT_FAILURE_THRESHOLD;
  const cooldownMs = options.cooldownMs ?? DEFAULT_COOLDOWN_MS;
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? (() => Date.now());

  const states: EndpointState[] = transports.map(() => ({
    failures: 0,
    circuitOpenUntil: 0,
  }));

  let currentIndex =
    options.initialIndex !== undefined
      ? Math.abs(options.initialIndex) % transports.length
      : 0;

  const failoverTransport = async <TResponse>(
    request: { payload: unknown; signal?: AbortSignal }
  ): Promise<TResponse> => {
    let lastError: unknown;
    const startIndex = currentIndex;

    for (let attempt = 0; attempt < transports.length; attempt += 1) {
      const index = (startIndex + attempt) % transports.length;
      const state = states[index];

      if (state.circuitOpenUntil > now()) {
        continue;
      }

      try {
        const result = await transports[index](request);
        state.failures = 0;
        state.circuitOpenUntil = 0;
        currentIndex = index;
        return result as TResponse;
      } catch (error) {
        lastError = error;
        state.failures += 1;
        if (state.failures >= failureThreshold) {
          state.circuitOpenUntil = now() + cooldownMs;
        }
        const delay = Math.min(
          maxDelayMs,
          baseDelayMs * Math.pow(2, state.failures - 1)
        );
        if (delay > 0) {
          await sleep(delay);
        }
      }
    }

    throw lastError ?? new Error("All RPC endpoints failed");
  };

  return failoverTransport as RpcTransport;
}

export function createFailoverRpc(urls: string[], options?: RpcFailoverOptions) {
  const normalized = normalizeRpcUrls(urls);
  if (normalized.length === 0) {
    throw new Error("No RPC URLs provided");
  }
  const transports = normalized.map((url) => createDefaultRpcTransport({ url }));
  const transport = createFailoverTransport(transports, options);
  return createSolanaRpcFromTransport(transport);
}
