import path from 'path';
import fs from 'fs/promises';

// 工具系统：Tool 接口定义了工具的 name/description/call 等生命周期
import type { Tool, ToolResult } from './Tool.js';

import { addLineNumbers } from './index.js';


// 使用 ripgrep 搜索文件内容
export const grepSearchTool: Tool = {
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
        return {
          content: output || "(no matches found)"
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: `Error searching: ${message}`,
          isError: true
        };
      }
    },
    isReadOnly: () => true,
    isEnabled: () => true,
}