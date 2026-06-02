import path from 'path';
import fs from 'fs/promises';

// 工具系统：Tool 接口定义了工具的 name/description/call 等生命周期
import type { Tool, ToolResult } from './Tool.js';

import { addLineNumbers } from '../tools/index.js';


// 读取文件内容
export const fileReadTool: Tool = {
    name: "read",
    description: "Read the contents of a file at the given path",
    inputSchema: {
      type: "object",
      properties: {
        file_path: { type: "string", description: "文件路径" },
        offset:    { type: "number", description: "起始行号（1-indexed）" },
        limit:     { type: "number", description: "读取行数" },
      },
      required: ["file_path"],
    },
    async call(rawInput, context): Promise<ToolResult> {
        const file_path = String(rawInput.file_path);
        const offset = Number(rawInput.offset) || 0;
        const limit = Number(rawInput.limit) || 100;

      try {
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
      }
      catch (err) {
        // Node.js 的文件系统错误有 code 属性（如 ENOENT）
        if (err instanceof Error && (err as NodeJS.ErrnoException).code === "ENOENT") {
          return {
            content: `Error: File not found: ${file_path}`, 
            isError: true
          };
        }
        // 其他错误
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: `Error reading file: ${message}`,
          isError: true
        };
      }
    },
    isReadOnly: () => true,
    isEnabled: () => true,
  }