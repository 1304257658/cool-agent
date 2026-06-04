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
import type { AgenticLoopEvent } from '../core/agenticLoop.js';
import { DebugView } from './components/DebugView.js';





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
        if (msg.role === "user" && typeof msg.content === "object") {
          return (
            <Box key={ `u${i}` } marginTop={1}>
              <Text color="green" bold>{"❯ "}</Text>
              <Text>{JSON.stringify(msg.content)}</Text>
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
        if (msg.role === "assistant" && typeof msg.content === "object") {
          return (
            <Box key={ `u${i}` } marginTop={1}>
              <Text color="green" bold>{"❯ "}</Text>
              <Text>{JSON.stringify(msg.content)}</Text>
            </Box>
          );
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
      
      {/* ── 显示调试信息 ── */}
      <DebugView
        model={model}
        system={system}
        messages={messages}
        tools={getToolsApiParams()}
      />

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