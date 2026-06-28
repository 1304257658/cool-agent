import type Anthropic from "@anthropic-ai/sdk";

import type { MessageParam } from "@anthropic-ai/sdk/resources/messages.js";
import { streamMessage } from "../services/api/streaming.js";
import { findToolByName } from "../tools/index.js";
import type { ToolContext, ToolResult } from "../tools/Tool.js";
import type { ContentBlock, ToolUseBlock, Usage } from "../types/message.js";

// Agentic Loop 最大工具调用轮次，防止无限循环
export const MAX_TOOL_TURNS = Number(process.env.MAX_TOOL_TURNS) || 50;

type LoopState = {
  messages: MessageParam[];
  turnCount: number;
  aborted: boolean;
}

export type LoopTerminationReason =
  | "completed"
  | "aborted"
  | "model_error"
  | "max_turns";

export type AgenticLoopEvent =
  | {
    type: "text";
    text: string;
  }
  | {
    type: "tool_use_start";
    id: string;
    name: string;
  }
//   | { type: "permission_request"; request: PermissionRequest }
  | {
    type: "tool_use_done";
    id: string;
    name: string;
    result: ToolResult;
  }
  | {
    type: "assistant_message";
    message: MessageParam;
  }
  | {
    type: "tool_result_message";
    message: MessageParam;
  }
  | {
    type: "turn_complete";
    reason: LoopTerminationReason;
    turnCount: number;
  }
  | {
    type: "error";
    error: Error;
  };

export interface AgenticLoopResult {
  state: LoopState;
  usage: Usage;
  reason: LoopTerminationReason;
}

export interface QueryParams {
  messages: MessageParam[];
  systemPrompt?: string;
  tools?: Anthropic.Tool[];
  model: string;
  maxTokens?: number;
  abortSignal?: AbortSignal;
  toolContext: ToolContext;
  maxTurns?: number;
  // permissionMode?: PermissionMode;
  // permissionSettings?: PermissionSettings;
  // sessionPermissionRules?: PermissionRuleSet;
  // onPermissionRequest?: (request: PermissionRequest) => Promise<PermissionDecision>;
}

export interface RunToolsOptions {
  // permissionMode?: PermissionMode;
  // permissionSettings?: PermissionSettings;
  // sessionPermissionRules?: PermissionRuleSet;
  // onPermissionRequest?: (request: PermissionRequest) => Promise<PermissionDecision>;
}

export interface ToolExecutionResult {
  toolUseId: string;
  toolName: string;
  result: ToolResult;
}

// 执行 AI 请求的工具调用
async function runTools(
  contentBlocks: ContentBlock[], 
  context: ToolContext,
  options: RunToolsOptions = {},
): Promise<{
  toolResultsMessage: MessageParam;
  executions: ToolExecutionResult[];
  // permissionRequests: PermissionRequest[];
}> {
  // 遍历 ContentBlock 中的 tool_use 块，在 BUILT_IN_TOOLS 中查找并执行对应工具
  const toolUseBlocks = contentBlocks.filter(
    (block): block is ToolUseBlock => block.type === "tool_use",
  );

  const toolResults: Array<{
    type: "tool_result";
    tool_use_id: string;
    content: string;
    is_error: boolean;
  }> = [];
  const executions: ToolExecutionResult[] = [];
  
  for (const block of toolUseBlocks) {
    const tool = findToolByName(block.name);
    if (!tool) {
      const result: ToolResult = {
        content: `Tool ${block.name} not found`,
        isError: true,
      }
      toolResults.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: result.content,
        is_error: true,
      });
      executions.push({
        toolUseId: block.id,
        toolName: block.name,
        result: result,
      })
      continue;
    };

    try {
      const result = await tool.call(block.input as Record<string, any>, context);
      toolResults.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: result.content,
        is_error: result.isError ? true : false,
      });
      executions.push({
        toolUseId: block.id,
        toolName: block.name,
        result: result,
      })
    } catch (error: unknown) {
      const result: ToolResult = {
        content: `Error: ${error instanceof Error ? error.message : String(error)}`,
        isError: true,
      }
      toolResults.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: result.content,
        is_error: true,
      })
      executions.push({
        toolUseId: block.id,
        toolName: block.name,
        result: result,
      })
    }
  }

  // 收集执行结果为 toolResults[]，包装成 user 角色的 MessageParam 喂回下一轮对话
  return {
    toolResultsMessage: {
      role: "user",
      content: toolResults,
    },
    executions: executions,
  };
}

export async function* query(
  params: QueryParams,
// yield 流式事件
// return 最终状态
): AsyncGenerator<AgenticLoopEvent, AgenticLoopResult> {
  // max_turns
  const maxTurns = params.maxTurns ?? MAX_TOOL_TURNS;
  let state: LoopState = {
    messages: [...params.messages],
    turnCount: 0,
    aborted: false,
  };
  const totalUsage: Usage = {
    input_tokens: 0,
    output_tokens: 0
  };

  while (state.turnCount < maxTurns) {
    // 1. 检查中断
    if (params.abortSignal?.aborted) {
      const abortedState = {
        ...state,
        aborted: true,
      }
      yield {
        type: "turn_complete",
        reason: "aborted",
        turnCount: abortedState.turnCount,
      }
      return {
        state: abortedState,
        usage: totalUsage,
        reason: "aborted",
      }
    }

    const nextTurnCount = state.turnCount + 1;
    let assistantContent: ContentBlock[] = [];
    let stopReason = ""

    // 2. 调用 streamMessage()
    const stream = streamMessage({
      messages: [...state.messages],
      model: params.model,
      maxTokens: params.maxTokens,
      system: params.systemPrompt,
      tools: params.tools,
      signal: params.abortSignal,
    });

    while (true) {
      // 3. 流式 yield text/tool_use_start
      // 4. 收集完整 assistant message

      const { value, done } = await stream.next();
      if (done) {
        const streamResult = value;
        if (!streamResult) {
          yield {
            type: "turn_complete",
            reason: "model_error",
            turnCount: nextTurnCount,
          }
          return {
            state: {
              ...state,
              turnCount: nextTurnCount,
            },
            usage: totalUsage,
            reason: "model_error",
          }
        }

        totalUsage.input_tokens += streamResult.usage.input_tokens;
        totalUsage.output_tokens += streamResult.usage.output_tokens;
        assistantContent = streamResult.assistantMessage.content as ContentBlock[];
        stopReason = streamResult.stopReason;
        break;
      }
      
      switch (value.type) {
        case "text":
          yield value;
          break;
        case "tool_use_start":
          yield value;
          break;
        // case "tool_use_input":
        //   break;
        // case "message_start":
        //   break;
        // case "message_done":
        //   break;
        case "error":
          yield {
            type: "error",
            error: value.error,
          };
          yield {
            type: "turn_complete",
            reason: "model_error",
            turnCount: nextTurnCount,
          };
          return {
            state: {
              ...state,
              turnCount: nextTurnCount,
            },
            usage: totalUsage,
            reason: "model_error",
          };
      }
    }

    const assistantMessage: MessageParam = {
      role: "assistant",
      content: assistantContent as any,
    };

    // 5. 追加到 state.messages
    const messageWithAssistant = [...state.messages, assistantMessage];
    state = {
      messages: messageWithAssistant,
      turnCount: nextTurnCount,
      aborted: false,
    };
    yield {
      type: "assistant_message",
      message: assistantMessage,
    }

    // 6. 如果 stop_reason !== 'tool_use' -> completed
    if (stopReason !== "tool_use") {
      yield {
        type: "turn_complete",
        reason: "completed",
        turnCount: state.turnCount,
      }
      return {
        state: state,
        usage: totalUsage,
        reason: "completed",
      }
    }

    // 7. 否则 runTools()
    const { toolResultsMessage, executions } = await runTools(
      assistantContent,
      {
        ...params.toolContext,
        abortSignal: params.abortSignal,
      },
      {
        
      },
    );

    // 8. yield tool_use_done / tool_result_message
    for (const execution of executions) {
      yield {
        type: "tool_use_done",
        id: execution.toolUseId,
        name: execution.toolName,
        result: execution.result,
      };
    }

    // 9. 继续下一轮
    state = {
      messages: [...state.messages, toolResultsMessage],
      turnCount: nextTurnCount,
      aborted: false,
    }
    yield {
      type: "tool_result_message",
      message: toolResultsMessage,
    }
  }

  yield {
    type: "turn_complete",
    reason: "max_turns",
    turnCount: state.turnCount,
  }
  return {
    state: state,
    usage: totalUsage,
    reason: "max_turns",
  }
}




