import path from 'path';
import fs from 'fs/promises';
// Anthropic SDK 顶层类型，用于 toolsApiParams 的类型标注
import type Anthropic from "@anthropic-ai/sdk";
// 工具系统：Tool 接口定义了工具的 name/description/call 等生命周期
import type { Tool, ToolResult } from '../tools/Tool.js';
import { toolToApiParam } from '../tools/Tool.js';



function addLineNumbers(content: string, startLine: number): string {
  const lines = content.split("\n");
  const padWidth = String(startLine + lines.length - 1).length;

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
  // 读取文件内容
  {
    name: "read",
    description: "Read the contents of a file at the given path",
    inputSchema: {
      type: "object",
      properties: {
        file_path: { type: "string", description: "文件路径" },
        offset:    { type: "number", description: "起始行号（1-indexed）" },
        limit:     { type: "number", description: "读取行数" },
      },
      required: ["file_path", "offset", "limit"],
    },
    async call(rawInput, context): Promise<ToolResult> {
      const file_path = String(rawInput.file_path);
      const offset = Number(rawInput.offset) || 0;
      const limit = Number(rawInput.limit) || 100;

      // 1. 路径解析：相对路径 → 绝对路径
      const resolved = path.resolve(context.cwd, file_path);

      // 2. 读文件
      const raw = await fs.readFile(resolved, "utf-8");
      const allLines = raw.split("\n");

      // 3. 切片
      const startIdx = offset - 1;
      const endIdx = limit ? startIdx + limit : allLines.length;
      const selected = allLines.slice(startIdx, endIdx);

      // 4. 加行号（cat -n 格式）
      const numbered = addLineNumbers(selected.join("\n"), startIdx + 1);

      return { content: `${resolved} (${allLines.length} lines)\n${numbered}` };
    },
    isReadOnly: () => true,
    isEnabled: () => true,
  },
  // 写入文件内容（自动创建父目录）
  {
    name: "write",
    description: "Write content to a file, creating directories if needed",
    inputSchema: {
      type: "object",
      properties: {
        file_path: { type: "string", description: "Absolute path to the file" },
        content: { type: "string", description: "Content to write to the file" },
      },
      required: ["file_path", "content"],
    },
    async call(input) {
      try {
        const { writeFile, mkdir } = await import("fs/promises");
        const { dirname } = await import("path");
        await mkdir(dirname(String(input.file_path)), { recursive: true });
        await writeFile(String(input.file_path), String(input.content), "utf-8");
        return { content: `Successfully wrote ${input.file_path}` };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: `Error writing file: ${message}`, isError: true };
      }
    },
    isReadOnly: () => false,
    isEnabled: () => true,
  },
  // 列出目录内容
  {
    name: "list_files",
    description: "List files and directories in a given path",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute path to the directory" },
      },
      required: ["path"],
    },
    async call(input) {
      try {
        const { readdir } = await import("fs/promises");
        const entries = await readdir(String(input.path), { withFileTypes: true });
        const lines = entries.map((e) => `${e.isDirectory() ? "📁" : "📄"} ${e.name}`);
        return { content: lines.join("\n") };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: `Error listing directory: ${message}`, isError: true };
      }
    },
    isReadOnly: () => true,
    isEnabled: () => true,
  },
  // 执行 shell 命令并返回输出
  {
    name: "run_command",
    description: "Run a shell command and return its output",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string", description: "Shell command to execute" },
        cwd: { type: "string", description: "Working directory (default: project root)" },
      },
      required: ["command"],
    },
    async call(input) {
      try {
        const { execSync } = await import("child_process");
        const output = execSync(String(input.command), {
          cwd: input.cwd ? String(input.cwd) : process.cwd(),
          encoding: "utf-8",
          maxBuffer: 10 * 1024 * 1024,
        });
        return { content: output || "(command completed with no output)" };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: `Error running command: ${message}`, isError: true };
      }
    },
    isReadOnly: () => false,
    isEnabled: () => true,
  },
  // 使用 ripgrep 搜索文件内容
  {
    name: "grep_search",
    description: "Search for a pattern in files using ripgrep",
    inputSchema: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Search pattern (regex)" },
        path: { type: "string", description: "Directory to search in" },
        glob: { type: "string", description: "Optional glob filter (e.g. *.ts)" },
      },
      required: ["pattern"],
    },
    async call(input) {
      try {
        const { execSync } = await import("child_process");
        let cmd = `rg "${String(input.pattern).replace(/"/g, '\\"')}"`;
        if (input.path) cmd += ` "${String(input.path)}"`;
        if (input.glob) cmd += ` --glob "${String(input.glob)}"`;
        const output = execSync(cmd, {
          encoding: "utf-8",
          maxBuffer: 10 * 1024 * 1024,
        });
        return { content: output || "(no matches found)" };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: `Error searching: ${message}`, isError: true };
      }
    },
    isReadOnly: () => true,
    isEnabled: () => true,
  },
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