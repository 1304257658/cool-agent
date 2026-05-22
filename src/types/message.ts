// 三种内容块
export interface TextBlock {
    type: "text";
    text: string;
}

export interface ToolUseBlock {
    type: "tool_use";
    id: string;
    name: string;
    input: Record<string, unknown>;
}

export interface ToolResultBlock {
    type: "tool_result";
    tool_use_id: string;
    content: string | ContentBlock[];
    is_error?: boolean;
}

export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;

// 消息 = role + content blocks
export interface UserMessage {
    role: "user";
    content: string | ContentBlock[];
}

export interface AssistantMessage {
    role: "assistant";
    content: string | ContentBlock[];
}

export type StreamEvent = 
  | StreamTextEvent             // 文字增量
  | StreamToolUseStartEvent     // 工具调用开始
  | StreamToolUseInputEvent     // 工具参数 JSON 碎片
  | StreamMessageStartEvent     // 消息开始
  | StreamMessageDoneEvent      // 消息结束（含 usage）
  | StreamErrorEvent;           // 错误















