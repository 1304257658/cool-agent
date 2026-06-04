import path from 'path';
import fs from 'fs/promises';

// 工具系统：Tool 接口定义了工具的 name/description/call 等生命周期
import type { Tool, ToolResult } from './Tool.js';

import { addLineNumbers } from '../tools/index.js';


// 列出目录内容
export const listFilesTool: Tool = {
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
        return {
          content: lines.join("\n")
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: `Error listing directory: ${message}`,
          isError: true
        };
      }
    },
    isReadOnly: () => true,
    isEnabled: () => true,
}