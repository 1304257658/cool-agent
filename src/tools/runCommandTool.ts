import path from 'path';
import fs from 'fs/promises';

// 工具系统：Tool 接口定义了工具的 name/description/call 等生命周期
import type { Tool, ToolResult } from './Tool.js';

import { addLineNumbers } from './index.js';


// 执行 shell 命令并返回输出
export const runCommandTool: Tool = {
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
}