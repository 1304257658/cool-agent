import type { MessageParam } from "@anthropic-ai/sdk/resources/messages.js";
import { Usage } from "../types/message.js";
import {
    AUTO_COMPACT_BUFFER_TOKENS,
    getEffectiveContextWindowSize,
    scaleBuffer,
    tokenCountWithEstimation,
    getContextWindowForModel,
    WARNING_THRESHOLD_BUFFER_TOKENS
} from "../utils/tokens.js"
import { debugLog } from "../utils/log.js";
import { compactMessages, CompactionResult } from "./compaction.js";



export const MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES = 3;

export type TokenWarningState = "normal" | "warning" | "error" | "blocking";

let consecutiveAutoCompactFailures = 0;



function getAutoCompactThreshold(model: string): number {
    const effective = getEffectiveContextWindowSize(model);
    return Math.max(0, effective - scaleBuffer(AUTO_COMPACT_BUFFER_TOKENS, effective));
}

function shouldAutoCompact(
    estimatedTokens: number,
    model: string,
    querySource?: string,
): boolean {
    if (querySource === "compact" || querySource === "session_memory") {
        return false;
    }
    if (consecutiveAutoCompactFailures >= MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES) {
        debugLog("autoCompact", "circuit_breaker", {
            consecutiveFailures: consecutiveAutoCompactFailures,
        });
        return false;
    }
    return estimatedTokens >= getAutoCompactThreshold(model);
}

export async function autoCompactIfNeeded(
    messages: MessageParam[],
    model: string,
    options: {
        usage?: Usage;
        usageAnchorIndex?: number;
        systemPrompt?: string;
        querySource?: string;
    },
): Promise<{
    result: CompactionResult;
    didAutoCompact: boolean
}> {
    const estimatedTokens = tokenCountWithEstimation(messages, options);
    if (!shouldAutoCompact(estimatedTokens, model, options.querySource)) {
        return {
            result: {
                messages,
                didCompact: false,
                didMicroCompact: false,
            },
            didAutoCompact: false,
        };
    }

    debugLog("autoCompact", "triggering", {
        estimatedTokens,
        threshold: getAutoCompactThreshold(model),
        consecutiveFailures: consecutiveAutoCompactFailures,
    });
    
    try {
        const result = await compactMessages(messages, undefined, {
            usage: options.usage,
            usageAnchorIndex: options.usageAnchorIndex,
            systemPrompt: options.systemPrompt,
            force: true,
        });
        consecutiveAutoCompactFailures = 0;
        return {
            result,
            didAutoCompact: result.didCompact,
        };
    } catch (error) {
        consecutiveAutoCompactFailures ++;
        debugLog("autoCompact", "failure", {
            error: error instanceof Error ? error.message : String(error),
            consecutiveFailures: consecutiveAutoCompactFailures,
        });
        return {
            result: {
                messages,
                didCompact: false,
                didMicroCompact: false
            },
            didAutoCompact: false,
        };
    }
}


function getBlockingLimit(model: string): number {
    const effective = getEffectiveContextWindowSize(model);
    return Math.max(0, effective - scaleBuffer(AUTO_COMPACT_BUFFER_TOKENS, effective));
}

export interface TokenWarningResult {
    state: TokenWarningState;
    estimatedTokens: number;
    threshold: number;
    blockingLimit: number;
    contextWindow: number;
}

export function calculateTokenWarningState(
    estimatedTokens: number,
    model: string,
): TokenWarningResult {
    const contextWindow = getContextWindowForModel(model);
    const effective = getEffectiveContextWindowSize(model);
    const blockingLimit = getBlockingLimit(model);
    const autoCompactThreshold = getAutoCompactThreshold(model);
    const warningThreshold = Math.max(0, effective - scaleBuffer(WARNING_THRESHOLD_BUFFER_TOKENS, effective));

    let state: TokenWarningState = "normal";
    if (estimatedTokens >= blockingLimit) {
        state = "blocking";
    } else if (estimatedTokens >= autoCompactThreshold) {
        state = "error";
    } else if (estimatedTokens >= warningThreshold) {
        state = "warning";
    }

    return {
        state,
        estimatedTokens,
        threshold: autoCompactThreshold,
        blockingLimit,
        contextWindow,
    };
}


