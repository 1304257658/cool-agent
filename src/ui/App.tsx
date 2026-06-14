// React 是必须导入的，因为 JSX 编译后依赖 React
import React, { useState, useEffect, useRef, useCallback } from 'react';
// Ink 终端 UI 框架核心组件
import { Box, Text, useApp, useInput } from 'ink';
// Anthropic Messages API 的类型定义
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages.js";

import { useAgentSession } from './hooks/useAgentSession.js';
import { usePromptInput } from './hooks/usePromptInput.js';
import { getToolsApiParams } from "../tools/index.js";

// 组件导入
import { OpeningRemarks } from './components/OpeningRemarks.js';
import { InputPrompt } from './components/InputPrompt.js';
import { ConversationView } from './components/ConversationView.js';
import { ToolCallList } from './components/ToolCallList.js';
import { SystemPanel } from './components/SystemPanel.js';
import { StatusBar } from './components/StatusBar.js';
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

  // 中断控制（不触发重渲染，用 useRef 保持可变引用）
  const abortRef = useRef<AbortController | null>(null);
  const messagesRef = useRef<MessageParam[]>([]);

  const { state, actions } = useAgentSession({
    model,
    onExit: exit,
  })

  const { inputValue, CommandSuggestions } = usePromptInput({
    isLoading: state.isLoading,
    onSubmit: actions.submit,
    onExit: exit,
    onInterrupt: actions.interrupt,
  })
    
  return (
    // flexDirection="column" 使子元素从上到下垂直排列
    // paddingX={1} 在左右两侧添加一个空格的内边距
    <Box flexDirection="column" paddingX={1}>
      {/* ── 头部：显示应用名称和当前模型 ── */}
      <OpeningRemarks model={model} />

      {/* ── 对话历史：遍历 messages 渲染 user/assistant 消息 ── */}
      <ConversationView messages={state.messages} />

      {/* ── 工具调用指示器：展示正在调用或已完成的工具 ── */}
      <ToolCallList toolCalls={state.toolCalls} />

      {/* ── 系统提示：展示系统指令和状态信息 ── */}
      <SystemPanel notice={state.systemNotice} />

      <StatusBar
        isLoading={state.isLoading}
        // Spinner：API 请求中且尚无流式文本时显示加载动画
        spinnerLabel={state.spinnerLabel}
        // 流式文本：API 正在回复时实时显示增量文本
        streamingText={state.streamingText}
        lastUsage={state.lastUsage}
        // permissionPrompt={state.permissionPrompt}
        // permissionMode={state.permissionMode}
      />
      
      {/* ── 显示调试信息 ── */}
      <DebugView
        model={model}
        system={system}
        messages={state.messages}
        tools={getToolsApiParams()}
      />

      {/* ── 输入行：非加载状态下显示输入框和光标 ── */}
      <InputPrompt
        isLoading={state.isLoading}
        inputValue={inputValue}
      />
    </Box>
  );
}