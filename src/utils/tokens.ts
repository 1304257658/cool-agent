import type { MessageParam } from "@anthropic-ai/sdk/resources/messages.js";
import type { Usage } from "../types/message.js";


export const MODEL_CONTEXT_WINDOW = 200_000;
export const AUTOCOMPACT_BUFFER_TOKENS = 13_000;
export const MANUAL_COMPACT_BUFFER_TOKENS = 3_000;

const TEXT_CHARS_PER_TOKEN = 4;    // 普通文本，约 4 个字符 = 1 token
const JSON_CHARS_PER_TOKEN = 2;    // JSON 结构体，符号密度高，约 2 字符 = 1 token
const MESSAGE_OVERHEAD_TOKENS = 12; // 每条消息的固定开销（角色标记、分隔符等）
const TOOL_BLOCK_OVERHEAD_TOKENS = 24;
const FIXED_BINARY_BLOCK_TOKENS = 2_000;


function roughTokenCountEstimation(content: string | unknown, charsPerToken = TEXT_CHARS_PER_TOKEN): number {
    if (typeof content === "string") {
        return Math.max(1, Math.round(content.length / charsPerToken));
    } else if (typeof content === "object") {
        return Math.max(1, Math.round(JSON.stringify(content).length / charsPerToken));
    } else {
        return 0;
    }
}

function estimateUnknownObjectTokens(obj: unknown): number {
    return roughTokenCountEstimation(JSON.stringify(obj ?? ""), JSON_CHARS_PER_TOKEN);
}

function estimateContentBlockTokens(content: MessageParam["content"]): number {
    if (typeof content === "string") {
        return roughTokenCountEstimation(content);
    }

    if (!Array.isArray(content)) {
        return 0;
    }

    return content.reduce((total, block) => {
        switch (block.type) {
            case "text":
                return total + roughTokenCountEstimation(block.text);
            case "tool_use":
                return (
                    total + TOOL_BLOCK_OVERHEAD_TOKENS + roughTokenCountEstimation(block.name) + roughTokenCountEstimation(block.input)
                );
            case "tool_result": {
                const serialized = typeof block.content === "string" ? block.content : JSON.stringify(block.content);
                return total + TOOL_BLOCK_OVERHEAD_TOKENS + roughTokenCountEstimation(serialized, JSON_CHARS_PER_TOKEN);
            }
            case "image":
            case "document": 
                return total + FIXED_BINARY_BLOCK_TOKENS;
            default:
                return total + estimateUnknownObjectTokens(block);
        }
    }, 0);
}

function estimateMessageTokens(message: MessageParam): number {
    return MESSAGE_OVERHEAD_TOKENS + estimateContentBlockTokens(message.content);
}

function roughTokenCountEstimationForMessages(messages: readonly MessageParam[]): number {
    const rawEstimate = messages.reduce((sum, message) => sum + estimateMessageTokens(message), 0);
    return Math.ceil((rawEstimate * 4) / 3);
}

function getTokenCountFromUsage(usage: Usage): number {
    return (
        usage.input_tokens + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + usage.output_tokens
    );
}

function estimateSystemPromptTokens(systemPrompt: string): number {
    return roughTokenCountEstimation(systemPrompt) + MESSAGE_OVERHEAD_TOKENS;
}

function tokenCountWithEstimation(
    messages: readonly MessageParam[],
    options?: {
        usage: Usage;
        usageAnchorIndex?: number;
        systemPrompt?: string
    },
): number {
    const systemPromptTokens = options?.systemPrompt ? estimateSystemPromptTokens(options.systemPrompt) : 0;

    if (options?.usage && options.usageAnchorIndex !== undefined && options.usageAnchorIndex >= 0) {
        const suffix = messages.slice(options.usageAnchorIndex + 1);
        return getTokenCountFromUsage(options.usage) + roughTokenCountEstimationForMessages(suffix) + systemPromptTokens;
    }

    return roughTokenCountEstimationForMessages(messages) + systemPromptTokens;
}

interface TokenBudgetSnapshot {
    estimatedConversationTokens: number;
    contextWindow: number;
    effectiveContextWindow: number;
    autoCompactThreshold: number;
    manualCompactThreshold: number;
}

export function buildTokenBudgetSnapshot(
    messages: readonly MessageParam[],
    options?: {
        usage: Usage;
        usageAnchorIndex?: number;
        systemPrompt?: string
    },
): TokenBudgetSnapshot {
    const estimatedConversationTokens = tokenCountWithEstimation(messages, options);
    const contextWindow = MODEL_CONTEXT_WINDOW;
    const effectiveContextWindow = contextWindow - 20_000;
    return {
        estimatedConversationTokens,
        contextWindow,
        effectiveContextWindow,
        autoCompactThreshold: effectiveContextWindow - AUTOCOMPACT_BUFFER_TOKENS,
        manualCompactThreshold: effectiveContextWindow - MANUAL_COMPACT_BUFFER_TOKENS,
    }
}