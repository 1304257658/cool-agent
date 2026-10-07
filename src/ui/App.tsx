// React 是必须导入的，因为 JSX 编译后依赖 React
import React from 'react';
// Ink 终端 UI 框架核心组件
import { Box, useApp } from 'ink';

import type { PermissionMode } from "../permissions/permissions.js";
import { useAgentSession } from './hooks/useAgentSession.js';
import { usePromptInput } from './hooks/usePromptInput.js';
import { getToolsApiParams } from "../tools/index.js";
import { getAllUserInvocableSkills } from "../services/skills/registry.js";
import type { CommandSuggestion } from "./types.js";

// 组件导入
import { OpeningRemarks } from './components/OpeningRemarks.js';
import { InputPrompt } from './components/InputPrompt.js';
import { ConversationView } from './components/ConversationView.js';
import { ToolCallList } from './components/ToolCallList.js';
import { SystemPanel } from './components/SystemPanel.js';
import { TodoList } from "./components/TodoList.js";
import { TaskList } from "./components/TaskList.js";
import { ModeSelector } from "./components/ModeSelector.js";
import { StatusBar } from './components/StatusBar.js';
import { DebugView } from './components/DebugView.js';
import { CommandSuggestions } from './components/CommandSuggestions.js';


// App 组件接收的参数
interface AppProps {
  model: string;  // 使用的 AI 模型名称（如 claude-sonnet-4-20250514）
  systemPrompt: string;  // 系统提示词
  permissionMode?: PermissionMode;  // 预留：权限确认模式（未来功能）
  shouldResume?: boolean;  // 是否恢复会话
  resumeSessionId?: string;  // 恢复会话 ID
}

export function App({ model, systemPrompt, permissionMode, shouldResume, resumeSessionId }: AppProps): React.ReactNode {
  // useApp().exit() 用于退出整个 Ink 应用程序
  const { exit } = useApp();

  const { state, actions } = useAgentSession({
    model,
    onExit: exit,
    permissionMode: permissionMode,
    shouldResume: shouldResume,
    resumeSessionId: resumeSessionId,
  })
  const isPlanExitActive = Boolean(state.permissionPrompt?.isPlanExit);

  // Surface the current in-progress item's activeForm via the global
  // StatusBar spinner. This mirrors source code behavior (Spinner.tsx:
  // `leaderVerb = currentTodo?.activeForm ?? randomVerb`) and keeps the
  // entire app at exactly ONE animation source — adding per-row spinners
  // caused severe flicker because every additional setInterval forces
  // another full terminal repaint cycle on top of streaming text.
  //
  // In task mode we read from the Task graph; in todo mode we keep the
  // V1 source. Either way, the spinner label comes from exactly one
  // place at a time.
  const inProgressTodo = state.todos.find((t) => t.status === "in_progress");
  const inProgressTask = state.tasks.find((t) => t.status === "in_progress");
  const effectiveSpinnerLabel = state.taskMode === "task"
    ? (inProgressTask?.activeForm ?? inProgressTask?.subject ?? state.spinnerLabel)
    : (inProgressTodo?.activeForm ?? state.spinnerLabel);

  // Pull skill `/<name>` commands from the live registry on every render
  // so newly activated conditional skills (e.g. test-reviewer after the
  // model reads a *.test.ts file) appear in the suggestion list without
  // the user having to restart. Computing inline is fine — the registry
  // is an in-memory Map and we only render on existing state changes.
  const skillCommands: CommandSuggestion[] = React.useMemo(
    () =>
      getAllUserInvocableSkills().map((skill) => ({
        name: `/${skill.name}`,
        description:
          skill.description.length > 80
            ? `${skill.description.slice(0, 77)}…`
            : skill.description,
      })),
    // Re-derive whenever the message log grows — that's our cheap proxy
    // for "something happened that may have activated a skill". The list
    // is tiny so the cost is negligible.
    [state.messages.length, state.toolCalls.length],
  );
  const { inputValue, commandSuggestions, modeSuggestions, taskModeSuggestions } = usePromptInput({
    isLoading: state.isLoading,
    hasPermissionPrompt: Boolean(state.permissionPrompt) && !isPlanExitActive,
    isPlanExitPrompt: false,
    permissionMode: state.permissionMode,
    taskMode: state.taskMode,
    extraCommands: skillCommands,
    onSubmit: actions.submit,
    onExit: exit,
    onInterrupt: actions.interrupt,
    onPermissionDecision: actions.resolvePermission,
  })
    
  return (
    // flexDirection="column" 使子元素从上到下垂直排列
    // paddingX={1} 在左右两侧添加一个空格的内边距
    <Box flexDirection="column" paddingX={1}>
      {/* ── 头部：显示应用名称和当前模型 ── */}
      <OpeningRemarks model={model} />

      {/* ── 对话历史：遍历 messages 渲染 user/assistant 消息 ── */}
      <ConversationView messages={state.messages} />

      {/* ── 待办事项列表：展示当前任务状态 ── */}
      {state.taskMode === "task"
        ? <TaskList tasks={state.tasks} />
        : <TodoList todos={state.todos} />}
      
      {/* ── 工具调用指示器：展示正在调用或已完成的工具 ── */}
      <ToolCallList toolCalls={state.toolCalls} />

      {/* ── 系统提示：展示系统指令和状态信息 ── */}
      <SystemPanel notice={state.systemNotice} />

      <StatusBar
        isLoading={state.isLoading}
        // Spinner：API 请求中且尚无流式文本时显示加载动画
        spinnerLabel={effectiveSpinnerLabel}
        // 流式文本：API 正在回复时实时显示增量文本
        streamingText={state.streamingText}
        lastUsage={state.lastUsage}
        permissionPrompt={state.permissionPrompt}
        permissionMode={state.permissionMode}
        onPlanDecision={actions.resolvePermission}
      />
      
      {/* ── 显示调试信息 ── */}
      <DebugView
        model={model}
        systemPrompt={systemPrompt}
        messages={state.messages}
        tools={getToolsApiParams()}
      />

      {/* ── 输入行：非加载状态下显示输入框和光标 ── */}
      <InputPrompt
        isLoading={state.isLoading}
        inputValue={inputValue}
      />
      
      {/* ── 命令建议：展示可用命令 ── */}
      <CommandSuggestions items={commandSuggestions} />
      <ModeSelector items={modeSuggestions} />
      <ModeSelector
        items={taskModeSuggestions}
        title={`select task system (↑↓ navigate, Enter confirm, 1-${taskModeSuggestions.length || 2} shortcut)`}
      />
    </Box>
  );
}