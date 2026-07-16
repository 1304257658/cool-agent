import Anthropic from '@anthropic-ai/sdk';
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages.js";
import {
    getAnthropicClient,
    DEFAULT_MODEL,
    DEFAULT_MAX_TOKENS,
} from './anthropicClient.js';
import {
    ThinkingBlock,
    TextBlock,
    ContentBlock,
    Usage,
    StreamEvent,
    AssistantMessage,
} from '../../types/message.js';
import { createEmptyUsage } from '../../utils/usage.js';



// ─── Request Parameters ────────────────────────────────────────────

export interface StreamRequestParams {
  messages: MessageParam[];
  model?: string;
  maxTokens?: number;
  system?: string;
  tools?: Anthropic.Tool[];
  signal?: AbortSignal;
}

// ─── Streaming Result ──────────────────────────────────────────────

export interface StreamResult {
  assistantMessage: AssistantMessage;
  usage: Usage;
  stopReason: string;
}


export async function* streamMessage(
    params: StreamRequestParams,
): AsyncGenerator<StreamEvent, StreamResult> {
    const client = getAnthropicClient();
    const model = params.model ?? DEFAULT_MODEL;
    const maxTokens = params.maxTokens ?? DEFAULT_MAX_TOKENS;

    // Build the API request
    const requestParams: Anthropic.MessageCreateParamsStreaming = {
        model: model,
        max_tokens: maxTokens,
        messages: params.messages,
        stream: true,
        ...(params.system && { system: params.system }),
        ...(params.tools && params.tools.length > 0 && { tools: params.tools }),
    };

    // Initiate the stream
    const stream = client.messages.stream(requestParams, {
        signal: params.signal,
    });

    const contentBlocks: ContentBlock[] = [];
    let currentToolInputJson = "";
    const usage: Usage = createEmptyUsage();
    let stopReason = "";

    for await (const event of stream) {
        // // 调试输出
        // const { createWriteStream } = await import("fs");
        // const { join } = await import("path");

        // // 定义文件路径和要写入的内容
        // const filePath = join('./src', 'test', 'stream1.txt');

        // // 创建一个可写文件流 (Writable Stream)
        // const fileWriteStream = createWriteStream(filePath, { encoding: 'utf-8', flags: 'a' });

        // try {
        //     // 写入文件（默认采用 UTF-8 编码，如果文件存在会直接覆盖）
        //     fileWriteStream.write(JSON.stringify(event) + '\n');
        // } catch (error) {
        //     console.error('写入文件时出错:', error);
        // }

        switch (event.type) {
            case "message_start": {
                // Capture initial usage (input token count + cache tokens)
                if (event.message.usage) {
                    usage.input_tokens = event.message.usage.input_tokens;
                    usage.output_tokens = event.message.usage.output_tokens;
                    const u = event.message.usage as unknown as Record<string, unknown>;
                    if (typeof u.cache_creation_input_tokens === "number") {
                        usage.cache_creation_input_tokens = u.cache_creation_input_tokens;
                    }
                    if (typeof u.cache_read_input_tokens === "number") {
                        usage.cache_read_input_tokens = u.cache_read_input_tokens;
                    }
                }
                yield {
                    type: "message_start",
                    messageId: event.message.id
                };
                break;
            }

            case "content_block_start":
                if (event.content_block.type === "thinking") {
                    contentBlocks[event.index] = {
                        type: "thinking",
                        text: ""
                    };
                } else if (event.content_block.type === "tool_use") {
                    const b = event.content_block;
                    contentBlocks[event.index] = {
                        type: "tool_use",
                        id: b.id,
                        name: b.name,
                        input: {},
                    };
                    currentToolInputJson = "";
                    yield {
                        type: "tool_use_start",
                        id: b.id,
                        name: b.name
                    };
                } else if (event.content_block.type === "text") {
                    contentBlocks[event.index] = {
                        type: "text",
                        text: ""
                    };
                }
                break;

            case "content_block_delta":
                if (event.delta.type === "thinking_delta") {
                    (contentBlocks[event.index] as ThinkingBlock).text += event.delta.thinking;
                    yield { 
                        type: "thinking", 
                        text: event.delta.thinking 
                    };
                } else if (event.delta.type === "input_json_delta") {
                    currentToolInputJson += event.delta.partial_json;
                } else if (event.delta.type === "text_delta") {
                    (contentBlocks[event.index] as TextBlock).text += event.delta.text;
                    yield { 
                        type: "text", 
                        text: event.delta.text 
                    };
                }
                break;

            case "content_block_stop":
                // 工具参数的 JSON 是碎片化到达的，在 block 结束时才能 parse
                const block = contentBlocks[event.index];
                if (block?.type === "tool_use" && currentToolInputJson) {
                    block.input = JSON.parse(currentToolInputJson);
                    currentToolInputJson = "";
                }
                break;

            case "message_delta": {
                if (event.usage) {
                    usage.output_tokens = event.usage.output_tokens;
                    // Some providers (e.g. MiniMax) report input_tokens in message_delta
                    // rather than message_start — pick it up as a fallback.
                    const du = event.usage as unknown as Record<string, unknown>;
                    if (typeof du.input_tokens === "number" && du.input_tokens > 0) {
                        usage.input_tokens = du.input_tokens;
                    }
                    if (typeof du.cache_creation_input_tokens === "number") {
                        usage.cache_creation_input_tokens = du.cache_creation_input_tokens;
                    }
                    if (typeof du.cache_read_input_tokens === "number") {
                        usage.cache_read_input_tokens = du.cache_read_input_tokens;
                    }
                }
                stopReason = event.delta.stop_reason ?? "";
                break;
            }

            case "message_stop":
                yield {
                    type: "message_done",
                    stopReason, usage
                };
                break;
        }
    }

    return {
        assistantMessage: {
            role: "assistant",
            content: contentBlocks,
        },
        usage,
        stopReason,
    };
}


// ─── Convenience: Non-streaming single-shot ────────────────────────

/**
 * Simple non-streaming call for quick one-off requests.
 * Useful for internal tasks (compaction, classification) where
 * we don't need incremental output.
 */

export async function createMessage(
    params: Omit<StreamRequestParams, "signal">,
): Promise<{
    content: ContentBlock[];
    usage: Usage;
    stopReason: string;
}> {
    const client = getAnthropicClient();
    const model = params.model ?? DEFAULT_MODEL;
    const maxTokens = params.maxTokens ?? DEFAULT_MAX_TOKENS;

    const response = await client.messages.create({
        model,
        max_tokens: maxTokens,
        messages: params.messages,
        ...(params.system && { system: params.system }),
        ...(params.tools && params.tools.length > 0 && { tools: params.tools }),
    });

    const contentBlocks: ContentBlock[] = response.content.map((block) => {
        if (block.type === "text") {
            return {
                type: "text" as const,
                text: block.text,
            };
        } else if (block.type === "tool_use") {
            return {
                type: "tool_use" as const,
                id: block.id,
                name: block.name,
                input: block.input as Record<string, unknown>,
            };
        }
        return {
            type: "text" as const,
            text: "",
        };
    });

    return {
        content: contentBlocks,
        usage: {
            input_tokens: response.usage.input_tokens,
            output_tokens: response.usage.output_tokens,
        },
        stopReason: response.stop_reason ?? "",
    };
}