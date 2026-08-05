import Anthropic from "@anthropic-ai/sdk";

export const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL || "sonnet-4.6";
export const SYSTEM_PROMPT = process.env.ANTHROPIC_SYSTEM_PROMPT || "You are a helpful AI coding assistant. Be concise and direct.";

export const CAPPED_DEFAULT_MAX_TOKENS = 8_000;
export const ESCALATED_MAX_TOKENS = 64_000;
export const COMPACT_MAX_OUTPUT_TOKENS = 20_000;
export const MAX_OUTPUT_TOKENS_RECOVERY_LIMIT = 3;
export const DEFAULT_MAX_TOKENS = CAPPED_DEFAULT_MAX_TOKENS;

let clientInstance: Anthropic | null = null;

export function getAnthropicClient(options?: {
    apiKey?: string;
    baseURL?: string;
}): Anthropic {
    if (clientInstance && !options) {
        return clientInstance;
    }
    
    const client = new Anthropic({
        apiKey: options?.apiKey ?? process.env.ANTHROPIC_API_KEY,
        baseURL: options?.baseURL ?? process.env.ANTHROPIC_BASE_URL,
    });

    if (!options) {
        clientInstance = client;
    }

    return client;
}














