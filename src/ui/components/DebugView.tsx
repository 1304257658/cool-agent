// React 是必须导入的，因为 JSX 编译后依赖 React
import React from 'react';
// Ink 终端 UI 框架核心组件
import { Box, Text } from 'ink';
// Anthropic Messages API 的类型定义
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages.js";
import { buildSystemPrompt, renderSystemPrompt } from "../../context/systemPrompt.js";

// ─────────────────────────────────────────────────────────────────────
// DebugView：调试渲染块
//
// 作用：当用户发送一个问题后，把「实际向模型发送了什么」以及
//      「模型回复的全部内容」原样铺开打印出来，方便排查 Agentic Loop
//      每一轮到底传了什么、收了什么。
//
// 这是一个纯展示组件，不持有任何状态，也不修改任何外部逻辑。
// 只需要把 App 里已有的 messages / system / model / tools 传进来即可。
// ─────────────────────────────────────────────────────────────────────

// 组件接收的属性
interface DebugViewProps {
  model: string;                 // 使用的模型名称
  systemPrompt: string;          // 系统提示词
  messages: MessageParam[];      // 完整消息历史（即 messages 数组 = 真正发给模型的对话内容）
  // tools 用 any[]：这里只做展示，不关心其精确类型，避免和工具系统耦合
  tools?: any[];                 // 本轮请求携带的工具定义（getToolsApiParams() 的结果）
  visible?: boolean;             // 是否显示，默认 true；方便用开关控制
}

// 把任意 content（string 或 ContentBlock[]）转成可读的多行结构
// 返回 React 节点数组，每个块单独一行/一段，按类型用不同颜色区分
function renderContent(content: MessageParam["content"]): React.ReactNode {
  // 情况一：content 直接是字符串（最常见的纯文本 user / assistant 消息）
  if (typeof content === "string") {
    return <Text>{content || "(空字符串)"}</Text>;
  }

  // 情况二：content 是 ContentBlock[]，逐块渲染
  return (
    <Box flexDirection="column">
      {content.map((block: any, i: number) => {
        // 文本块
        if (block.type === "text") {
          return (
            <Box key={`b${i}`} flexDirection="column">
              <Text color="gray">{`[text]`}</Text>
              <Text>{block.text}</Text>
            </Box>
          );
        }

        // 工具调用块（模型请求调用工具）
        if (block.type === "tool_use") {
          return (
            <Box key={`b${i}`} flexDirection="column">
              <Text color="yellow">{`[tool_use] ${block.name}  (id: ${block.id})`}</Text>
              <Text dimColor>{`  input: ${JSON.stringify(block.input)}`}</Text>
            </Box>
          );
        }

        // 工具结果块（喂回给模型的工具执行结果）
        if (block.type === "tool_result") {
          // content 本身也可能是字符串或嵌套数组
          const inner =
            typeof block.content === "string"
              ? block.content
              : JSON.stringify(block.content);
          // 将内容按行分割，逐行渲染以保留换行格式
          const lines = inner.split(/\r?\n/);
          return (
            <Box key={`b${i}`} flexDirection="column">
              <Text color={block.is_error ? "red" : "cyan"}>
                {`[tool_result]${block.is_error ? " (error)" : ""}  (for: ${block.tool_use_id})`}
              </Text>
              {lines.map((line: string, idx: number) => (
                <Text key={`tr${idx}`} dimColor>{`  ${line}`}</Text>
              ))}
            </Box>
          );
        }

        // 兜底：未知块类型，直接 JSON 打出来
        return (
          <Box key={`b${i}`} flexDirection="column">
            <Text color="gray">{`[${block.type ?? "unknown"}]`}</Text>
            <Text dimColor>{JSON.stringify(block)}</Text>
          </Box>
        );
      })}
    </Box>
  );
}

export function DebugView({
  model,
  systemPrompt,
  messages,
  tools,
  visible = true,
}: DebugViewProps): React.ReactNode {
  if (!visible) return null;

  const cwd = process.cwd();

  return (
    <Box flexDirection="column" marginTop={1} borderStyle="round" borderColor="gray" paddingX={1}>
      {/* ── 标题 ── */}
      <Text bold color="gray">{"── DEBUG: 本次请求的输入 / 输出 ──"}</Text>

      {/* ── 1. 请求级元信息：模型 / system / tools ── */}
      <Box flexDirection="column" marginTop={1}>
        <Text bold color="cyan">{"▶ 发送给模型的请求参数"}</Text>
        <Text>{`  model:  ${model}`}</Text>

        <Text>{`  system:`}</Text>
        <Text dimColor>{`    ${systemPrompt || "(空)"}`}</Text>

        <Text>
          {`  tools:  `}
          {tools && tools.length > 0
            ? tools.map((t: any) => t.name).join(", ")
            : "(无)"}
        </Text>
      </Box>

      {/* ── 2. messages 数组：真正发给模型的完整对话内容 ── */}
      <Box flexDirection="column" marginTop={1}>
        <Text bold color="cyan">{`▶ messages（共 ${messages.length} 条，按顺序全部发给模型）`}</Text>
        {messages.length === 0 && <Text dimColor>{"  (暂无消息)"}</Text>}
        {messages.map((msg, i) => (
          <Box key={`m${i}`} flexDirection="column" marginTop={1} marginLeft={2}>
            {/* 每条消息标注序号和角色：user=用户发送，assistant=模型回复 */}
            <Text bold color={msg.role === "user" ? "green" : "magenta"}>
              {`#${i} [${msg.role}]${msg.role === "user" ? "  ← 发送" : "  ← 模型回复"}`}
            </Text>
            <Box marginLeft={2}>{renderContent(msg.content)}</Box>
          </Box>
        ))}
      </Box>
    </Box>
  );
}
