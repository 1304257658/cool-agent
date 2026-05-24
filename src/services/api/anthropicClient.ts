import Anthropic from "@anthropic-ai/sdk";

export const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL || "sonnet-4.6";
export const DEAFULT_MAX_TOKENS = 8096;

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














