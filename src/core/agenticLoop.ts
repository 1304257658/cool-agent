import type Anthropic from "@anthropic-ai/sdk";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages.js";
import { streamMessage } from "../services/api/streaming.js";
import { findToolByName } from "../tools/index.js";
import type { ToolContext, ToolResult } from "../tools/Tool.js";
import type { ContentBlock, ToolUseBlock, Usage } from "../types/message.js";

// Agentic Loop 最大工具调用轮次，防止无限循环
export const MAX_TOOL_TURNS = 50;


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
  | { type: "text"; text: string }
  | { type: "tool_use_start"; id: string; name: string }
//   | { type: "permission_request"; request: PermissionRequest }
  | { type: "tool_use_done"; id: string; name: string; result: ToolResult }
  | { type: "assistant_message"; message: MessageParam }
  | { type: "tool_result_message"; message: MessageParam }
  | { type: "turn_complete"; reason: LoopTerminationReason; turnCount: number }
  | { type: "error"; error: Error };




async function runTools(contentBlocks: ContentBlock[], toolContext: ToolContext) {
  // 返回 tool_result message

}

export async function* query(params: { messages: MessageParam[] }) {
  // yield 流式事件
  // return 最终状态

  let state = {
    messages: [...params.messages],
    turnCount: 0,
    aborted: false,
  };
  const totalUsage: Usage = {
    input_tokens: 0,
    output_tokens: 0
  };

  while (state.turnCount < MAX_TOOL_TURNS) {
    // 1. 检查中断
    if (params.abortSignal?.aborted) {
      state.aborted = true;
      break;
    }

    // 2. 调用 streamMessage()
    // 3. 流式 yield text/tool_use_start
    // 4. 收集完整 assistant message
    // 5. 追加到 state.messages
    // 6. 如果 stop_reason !== 'tool_use' -> completed
    // 7. 否则 runTools()
    // 8. yield tool_use_done / tool_result_message
    // 9. 继续下一轮
    state.turnCount++;
    setStreamingText("");

    const result = await runStreamingTurn(state.messages, state.aborted);
    if (!result || state.aborted) break;

    totalUsage.input_tokens += result.usage.input_tokens;
    totalUsage.output_tokens += result.usage.output_tokens;

    // 追加 assistant message
    const assistantMsg: MessageParam = {
      role: "assistant",
      content: result.assistantMessage.content as any,
    };
    loopMessages = [...loopMessages, assistantMsg];
    setMessages(loopMessages);
    messagesRef.current = loopMessages;

    // 如果 AI 想调工具 → 执行工具 → 追加 tool_result → 继续循环
    if (result.stopReason === "tool_use") {
      const contentBlocks = result.assistantMessage.content;
      if (Array.isArray(contentBlocks)) {
        const toolResultMsg = await executeTools(contentBlocks);
        state.messages = [...state.messages, toolResultMsg];
        setMessages(state.messages);
        messagesRef.current = state.messages;
        setSpinnerLabel("Thinking");
        continue;
      }
    }
    break;  // stop_reason 不是 tool_use → 对话结束
  }

  // max_turns

  
}




