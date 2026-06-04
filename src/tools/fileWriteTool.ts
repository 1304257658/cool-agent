import path from 'path';
import fs from 'fs/promises';

// 工具系统：Tool 接口定义了工具的 name/description/call 等生命周期
import type { Tool, ToolResult } from './Tool.js';

import { addLineNumbers } from '../tools/index.js';

// 写入文件内容（自动创建父目录）
export const fileWriteTool: Tool = {
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
        return {
          content: `Successfully wrote ${input.file_path}`
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: `Error writing file: ${message}`,
          isError: true
        };
      }
    },
    isReadOnly: () => false,
    isEnabled: () => true,
}