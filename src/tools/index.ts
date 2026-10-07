/**
 * Tool Registry — Central registry for all available tools.
 *
 * MCP tools are registered at startup via `registerMcpTools()`.
 * Built-in tools live in BUILTIN_TOOLS (compile-time list); MCP tools are
 * collected separately so they can be reset/refreshed independently when
 * the user runs `/mcp reconnect`.
 */

// Anthropic SDK 顶层类型，用于 toolsApiParams 的类型标注
import type Anthropic from "@anthropic-ai/sdk";
// 工具系统：Tool 接口定义了工具的 name/description/call 等生命周期
import type { Tool } from '../tools/Tool.js';
import { toolToApiParam } from '../tools/Tool.js';
import { fileReadTool } from './fileReadTool.js';
import { fileWriteTool } from './fileWriteTool.js';
import { fileEditTool } from "./fileEditTool.js";
import { listFilesTool } from './listFilesTool.js';
import { bashTool } from './bashTool.js';
import { grepTool } from './grepTool.js';
import { globTool } from "./globTool.js";
import { memoryWriteTool } from "./memoryWriteTool.js";
import { enterPlanModeTool } from "./enterPlanModeTool.js";
import { exitPlanModeTool } from "./exitPlanModeTool.js";
import { todoWriteTool } from "./todoWriteTool.js";
import { taskCreateTool } from "./taskCreateTool.js";
import { taskUpdateTool } from "./taskUpdateTool.js";
import { taskGetTool } from "./taskGetTool.js";
import { taskListTool } from "./taskListTool.js";
import { skillTool } from "./skillTool.js";
import type { PermissionMode } from "../permissions/permissions.js";


// 为文本内容添加行号
// 用于调试和显示代码时，行号可以方便定位错误
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
    fileEditTool,
    listFilesTool,
    bashTool,
    grepTool,
    globTool,
    memoryWriteTool,
    todoWriteTool,
    taskCreateTool,
    taskUpdateTool,
    taskGetTool,
    taskListTool,
    enterPlanModeTool,
    exitPlanModeTool,
    skillTool,
];

let mcpTools: Tool[] = [];

/**
 * Replace the registry of MCP-provided tools. Called once at startup after
 * connecting to all MCP servers, and again after `/mcp reconnect`.
 */
export function registerMcpTools(tools: Tool[]): void {
    mcpTools = [...tools];
}

/** Drop the MCP-provided tools — used before re-registering after reconnect. */
export function clearMcpTools(): void {
    mcpTools = [];
}

// 获取所有启用的工具
// 过滤掉所有 disabled 状态的工具
export function getAllTools(): Tool[] {
    return [...BUILT_IN_TOOLS, ...mcpTools].filter((tool) => tool.isEnabled());
}

export function findToolByName(name: string): Tool | undefined {
    return [...BUILT_IN_TOOLS, ...mcpTools].find((tool) => tool.name === name);
}

// 将内置工具列表转换为 Anthropic API 接受的 Tool 格式
// getToolsApiParams 负责将 Tool 接口的 inputSchema 映射为 Anthropic 的 input_schema
/**
 * Get tool API params with mode-aware Enter/Exit visibility.
 *
 * The model always sees all tools (Write, Edit, Bash, etc.) regardless
 * of mode. Enforcement happens in checkPermission at execution time.
 * Only the plan mode transition tools are toggled:
 * - In plan mode: hide EnterPlanMode, show ExitPlanMode
 * - Outside plan mode: show EnterPlanMode, hide ExitPlanMode
 * 
 * MCP tools are always included; their visibility-in-plan is handled by
 * `checkPermission()` reading `tool.isReadOnly()` (which maps to MCP's
 * `annotations.readOnlyHint`).
 */
export function getToolsApiParams(mode?: PermissionMode): Anthropic.Tool[] {
    const tools = getAllTools();
    if (mode === "plan") {
        return tools.filter((t) => t.name !== "EnterPlanMode").map(toolToApiParam);
    }
    return tools.filter((t) => t.name !== "ExitPlanMode").map(toolToApiParam);
}