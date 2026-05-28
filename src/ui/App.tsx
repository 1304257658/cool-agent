// React 是必须导入的，因为 JSX 编译后依赖 React
import React, { useState, useEffect, useRef, useCallback } from 'react';
// Ink 终端 UI 框架核心组件
import { Box, Text, useApp, useInput } from 'ink';
// 自定义加载动画组件
import { Spinner } from './components/Spinner.js';
// Anthropic Messages API 的类型定义
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages.js";
// 本地类型定义：工具调用信息和 token 用量汇总
import type { ToolCallInfo, UsageSummary } from './types.js';
// 流式消息 API
import { streamMessage } from '../services/api/streaming.js';
import type { StreamResult } from '../services/api/streaming.js';
// 消息相关类型定义
import {
    TextBlock,
    ContentBlock,
    ToolResultBlock,
    Usage,
    StreamEvent,
    AssistantMessage,
} from '../types/message.js';
// 工具系统：工具上下文类型定义
import type { ToolContext } from "../tools/Tool.js";
import { getAllTools, findToolByName, getToolsApiParams } from '../tools/index.js';

// Agentic Loop 最大工具调用轮次，防止无限循环
export const MAX_TOOL_TURNS = 50;


// App 组件接收的参数
interface AppProps {
  model: string;  // 使用的 AI 模型名称（如 claude-sonnet-4-20250514）
  system: string;  // system prompt 指令文本
  // permissionMode?: PermissionMode;  // 预留：权限确认模式（未来功能）
}

// 从 assistant 消息中提取纯文本内容
// MessageParam.content 可能是 string 或 ContentBlock[] 数组，
// 需要过滤出 type === "text" 的 block 并拼接文本
function extractAssistantText(msg: MessageParam): string | null {
  if (msg.role !== "assistant") return null;

  if (typeof msg.content === "string") {
    return msg.content || null;
  }

  // msg.content is ContentBlock[] when it's not a string
  // Each block has a `type` property, and text blocks have `text` property
  const texts = msg.content
    // 过滤掉非文本块
    .filter((block) => block.type === "text")
    // 从每个数据块中提取文本
    .map((block) => (block as { type: "text"; text: string }).text)
    // 过滤掉空字符串
    .filter(Boolean);

  return texts.length > 0 ? texts.join("") : null;
}

// 执行 AI 请求的工具调用
// 遍历 ContentBlock 中的 tool_use 块，在 BUILT_IN_TOOLS 中查找并执行对应工具
// 收集执行结果为 ToolResultBlock[]，包装成 user 角色的 MessageParam 喂回下一轮对话
async function executeTools(contentBlocks: ContentBlock[]): Promise<MessageParam> {
  // 过滤出所有的 tool_use 块
  const toolUseBlocks = contentBlocks.filter((block) => block.type === "tool_use");

  const results = [];
  for (const block of toolUseBlocks) {
    const tool = findToolByName(block.name);

    if (!tool) {
      results.push({
        type: "tool_result" as const,
        tool_use_id: block.id,
        content: `Unknown tool: ${block.name}`,
        is_error: true,
      });
      continue;
    }

    const toolContext = {
      "cwd": "",
      "env": {},
    };

    const result = await tool.call(block.input, toolContext);

    const toolResult: { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean } = {
      type: "tool_result",
      tool_use_id: block.id,
      content: result.content,
    };
    if (result.isError) {
      toolResult.is_error = true;
    }
    results.push(toolResult);
  }
  return { role: "user", content: results }
}


export function App({ model, system }: AppProps): React.ReactNode {
  // useApp().exit() 用于退出整个 Ink 应用程序
  const { exit } = useApp();

  // 对话数据
  const [messages, setMessages] = useState<MessageParam[]>([]);  // 完整的消息历史
  const [inputValue, setInputValue] = useState("");  // 当前输入框文本

  // UI 状态
  const [isLoading, setIsLoading] = useState(false);  // 是否正在请求 API
  const [spinnerLabel, setSpinnerLabel] = useState("Thinking");  // 加载动画文本
  const [streamingText, setStreamingText] = useState("");  // 流式输出的增量文本
  const [toolCalls, setToolCalls] = useState<ToolCallInfo[]>([]);  // 当前工具调用列表
  const [lastUsage, setLastUsage] = useState<UsageSummary | null>(null);  // 上一轮的 token 用量
  const [infoMessage, setInfoMessage] = useState<String | null>(null);  // 提示信息（如 /clear 的结果）
  const [errorText, setErrorText] = useState<String | null>(null);  // 错误信息

  // 中断控制（不触发重渲染，用 useRef 保持可变引用）
  const abortRef = useRef<AbortController | null>(null);
  const messagesRef = useRef<MessageParam[]>([]);
  messagesRef.current = messages;

  // 注册 Ink 键盘事件监听
  // 所有用户键盘输入都会经过此处理函数
  useInput((input, key) => {
    // Ctrl+C：中断当前请求
    if (key.ctrl && input === "c") {
      if (abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
        setIsLoading(false);
        setStreamingText("");
        setInfoMessage("Interrupted.");
      }
      return;
    }

    // Ctrl+D：退出程序
    if (key.ctrl && input === "d") {
      exit();
      return;
    }

    // 正在加载时忽略普通输入
    if (isLoading) return;

    // 回车：提交消息
    if (key.return) {
      const text = inputValue;
      setInputValue("");
      void handleSubmit(text);
      return;
    }

    // 退格
    if (key.backspace || key.delete) {
      setInputValue((prev) => prev.slice(0, -1));
      return;
    }

    // 普通字符追加到输入框
    if (input && !key.ctrl && !key.meta) {
      setInputValue((prev) => prev + input);
    }
  });

  // 执行一轮流式消息请求
  // 调用 streamMessage 与 AI API 通信，实时处理 text/tool_use_start/error 事件
  // 返回 StreamResult（包含 assistant 回复内容、停止原因、用量统计）或 null（出错时）
  const runStreamingTurn = useCallback(
    async (
      currentMessages: MessageParam[],
      signal?: AbortSignal,
    ): Promise<StreamResult | null> => {
      const generator = streamMessage({
        messages: [...currentMessages],
        model,
        system,
        tools: getToolsApiParams().length > 0 ? getToolsApiParams() : undefined,
        signal,
      });

      let accumulatedText = "";

      while (true) {
        const { value, done } = await generator.next();
        if (done) return value ?? null;

        const event = value as StreamEvent;
        switch (event.type) {
          case "text":
            accumulatedText += event.text;
            setStreamingText(accumulatedText);  // 触发重渲染，终端实时更新
            break;
          case "tool_use_start":
            setToolCalls((prev) => [...prev, { name: event.name }]);
            break;
          case "error":
            setErrorText(event.error.message);
            return null;
        }
      }
    },
    [model, system, getToolsApiParams],
  );

  // 提交用户消息，启动 Agentic Loop
  // 流程：发送消息 → AI 回复 → 若需要调工具则执行 → 结果喂回 AI → 重复
  // 处理 slash 命令（/exit, /clear, /history）、AbortError、token 用量统计
  const handleSubmit = useCallback(
    async (text: string) => {
      if (!text.trim()) return;
      const trimmed = text.trim();

      // Slash commands 本地拦截
      if (trimmed === "/exit" || trimmed === "/quit") { exit(); return; }
      if (trimmed === "/clear") {
        setMessages([]);
        messagesRef.current = [];
        setInfoMessage("Conversation cleared.");
        return;
      }
      if (trimmed === "/history") {
        setInfoMessage(`${messagesRef.current.length} messages in conversation.`);
        return;
      }

      // 重置 UI 状态
      setStreamingText("");
      setToolCalls([]);
      setErrorText(null);
      setInfoMessage(null);
      setIsLoading(true);
      setSpinnerLabel("Thinking");

      // 追加 user message，创建本轮消息数组
      const userMsg: MessageParam = { role: "user", content: trimmed };
      let loopMessages = [...messagesRef.current, userMsg];
      setMessages(loopMessages);
      messagesRef.current = loopMessages;

      const abort = new AbortController();
      abortRef.current = abort;

      let totalIn = 0;
      let totalOut = 0;

      try {
        let turnCount = 0;
        // Agentic Loop：AI 调用工具 → 执行 → 结果喂回去 → 循环
        while (turnCount < MAX_TOOL_TURNS) {
          turnCount++;
          setStreamingText("");

          const result = await runStreamingTurn(loopMessages, abort.signal);
          if (!result || abort.signal.aborted) break;

          totalIn += result.usage.input_tokens;
          totalOut += result.usage.output_tokens;

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
              loopMessages = [...loopMessages, toolResultMsg];
              setMessages(loopMessages);
              messagesRef.current = loopMessages;
              setSpinnerLabel("Thinking");
              continue;
            }
          }
          break;  // stop_reason 不是 tool_use → 对话结束
        }

        setLastUsage({ input: totalIn, output: totalOut });
      } catch (err: unknown) {
        if (err instanceof Error && err.name === "AbortError") {
          setInfoMessage("Interrupted.");
        } else {
          setErrorText(err instanceof Error ? err.message : String(err));
        }
      } finally {
        setIsLoading(false);
        abortRef.current = null;
      }
    },
    [exit, runStreamingTurn, executeTools],
  );
    
  return (
    // flexDirection="column" 使子元素从上到下垂直排列
    // paddingX={1} 在左右两侧添加一个空格的内边距
    <Box flexDirection="column" paddingX={1}>
      {/* ── 头部：显示应用名称和当前模型 ── */}
      <Box marginBottom={1}>
        <Text bold color="cyan">Easy Agent</Text>
        <Text dimColor> ({model})</Text>
      </Box>
      <Text dimColor>Type a message to start. Ctrl+C to interrupt, Ctrl+D to exit.</Text>

      {/* ── 对话历史：遍历 messages 渲染 user/assistant 消息 ── */}
      {messages.map((msg, i) => {
        if (msg.role === "user" && typeof msg.content === "string") {
          return (
            <Box key={ `u${i}` } marginTop={1}>
              <Text color="green" bold>{"❯ "}</Text>
              <Text>{msg.content}</Text>
            </Box>
          );
        }
        if (msg.role === "assistant") {
          // 从 content blocks 中提取纯文本部分
          const text = extractAssistantText(msg);
          if (text) {
            return (
              <Box key={ `a${i}` }>
                <Text color="magenta">{"▎ "}</Text>
                <Text>{text}</Text>
              </Box>
            );
          }
        }
        return null;
      })}

      {/* ── 工具调用指示器：展示正在调用或已完成的工具 ── */}
      {toolCalls.map((tc, i) => (
        <Box key={ `tc${i}` } marginLeft={2}>
          {tc.resultLength !== undefined
            // 工具调用已完成：显示绿色勾号和返回结果长度
            ? <Text color="green">{"✓ "}{tc.name} ({tc.resultLength} chars)</Text>
            // 工具正在执行：显示黄色等待状态
            : <Text color="yellow">{"⚡ Using tool: "}{tc.name}</Text>}
        </Box>
      ))}

      {/* ── Spinner：API 请求中且尚无流式文本时显示加载动画 ── */}
      {isLoading && !streamingText && <Spinner label={spinnerLabel} />}

      {/* ── 流式文本：API 正在回复时实时显示增量文本 ── */}
      {isLoading && streamingText && (
        <Box>
          <Text color="magenta">{"▎ "}</Text>
          <Text>{streamingText}</Text>
        </Box>
      )}

      {/* ── 错误 / 信息提示 / token 用量 ── */}
      {errorText && <Text color="red">{"✗ "}{errorText}</Text>}
      {infoMessage && <Text dimColor>{"  "}{infoMessage}</Text>}
      {lastUsage && !isLoading && (
        <Text dimColor>{"  tokens: "}{lastUsage.input} in / {lastUsage.output} out</Text>
      )}

      {/* ── 输入行：非加载状态下显示输入框和光标 ── */}
      {!isLoading && (
        <Box marginTop={1}>
          <Text color="green" bold>{"❯ "}</Text>
          <Text>{inputValue}</Text>
          {/* ▋ 模拟终端闪烁光标 */}
          <Text dimColor>▋</Text>
        </Box>
      )}
    </Box>
  );
}