import Anthropic from '@anthropic-ai/sdk';
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages.js";
import {
    getAnthropicClient,
    DEFAULT_MODEL,
    DEAFULT_MAX_TOKENS,
} from './anthropicClient.js';
import {
    ThinkingBlock,
    TextBlock,
    ContentBlock,
    Usage,
    StreamEvent,
    AssistantMessage,
} from '../../types/message.js';


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
    const maxTokens = params.maxTokens ?? DEAFULT_MAX_TOKENS;

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
    const usage: Usage = {
        input_tokens: 0,
        output_tokens: 0
    };
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
            case "message_start":
                usage.input_tokens = event.message.usage.input_tokens;
                yield {
                    type: "message_start",
                    messageId: event.message.id
                };
                break;
            
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

            case "message_delta":
                usage.output_tokens = event.usage.output_tokens;
                stopReason = event.delta.stop_reason ?? "";
                break;

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