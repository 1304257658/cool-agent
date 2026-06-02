// Anthropic SDK 顶层类型，用于 toolsApiParams 的类型标注
import type Anthropic from "@anthropic-ai/sdk";
// 工具系统：Tool 接口定义了工具的 name/description/call 等生命周期
import type { Tool } from '../tools/Tool.js';
import { toolToApiParam } from '../tools/Tool.js';
import { fileReadTool } from './fileReadTool.js';
import { fileWriteTool } from './fileWriteTool.js';
import { listFilesTool } from './listFilesTool.js';
import { runCommandTool } from './runCommandTool.js';
import { grepSearchTool } from './grepSearchTool.js';


export function addLineNumbers(content: string, startLine: number): string {
  const lines = content.split("\n");
  const padWidth = String(startLine - 1 + lines.length).length;

  return lines
    .map((line, i) => {
      const num = String(startLine + i).padStart(padWidth, " ");
      return `${num}\t${line}`;
    })
    .join("\n");
}

// 内置工具注册表
// 每个工具实现 Tool 接口，包含名称、描述、JSON Schema 参数声明和 call 执行函数
// 工具在 Agentic Loop 中被 AI 调用：AI 返回 tool_use → executeTools 执行 → 结果喂回 AI
const BUILT_IN_TOOLS: Tool[] = [
  fileReadTool,
  fileWriteTool,
  listFilesTool,
  runCommandTool,
  grepSearchTool,
];

// 获取所有启用的工具
// 过滤掉所有 disabled 状态的工具
export function getAllTools(): Tool[] {
  return BUILT_IN_TOOLS.filter(t => t.isEnabled());
}

export function findToolByName(name: string): Tool | undefined {
  return BUILT_IN_TOOLS.find(t => t.name === name);
}

// 将内置工具列表转换为 Anthropic API 接受的 Tool 格式
// getToolsApiParams 负责将 Tool 接口的 inputSchema 映射为 Anthropic 的 input_schema
export function getToolsApiParams(): Anthropic.Tool[] {
  return getAllTools().map(toolToApiParam);
}