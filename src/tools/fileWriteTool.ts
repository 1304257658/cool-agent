import { dirname } from 'path';
import {
  writeFile,
  mkdir,
  access
} from 'fs/promises';

// 工具系统：Tool 接口定义了工具的 name/description/call 等生命周期
import type {
  Tool,
  ToolResult,
  ToolContext
} from './Tool.js';
import { resolveWorkspacePath } from './pathUtils.js';



interface FileWriteInput {
    file_path: string;
    content: string;
}

// 写入文件内容（自动创建父目录）
export const fileWriteTool: Tool = {
    name: "Write",
    description: "Create a file or overwrite an existing file with the provided content.",
    inputSchema: {
      type: "object" as const,
      properties: {
        file_path: {
          type: "string",
          description: "File path to write."
        },
        content: {
          type: "string",
          description: "Full file content to write."
        },
      },
      required: ["file_path", "content"],
    },
    async call(rawInput: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
      const input = rawInput as unknown as FileWriteInput;
      if (!input.file_path || !input.content) {
        return {
          content: "Error: file_path and content must be required",
          isError: true
        };
      }
      if (typeof input.content !== "string" || input.content.length === 0) {
        return {
          content: "Error: content must be a non-empty string",
          isError: true
        };
      }

      let resolvedPath: string;
      try {
        resolvedPath = resolveWorkspacePath(input.file_path, context.cwd);
      } catch (error: unknown) {
        return {
          content: error instanceof Error 
          ? `Error: ${error.message}` 
          : `Error: ${String(error)}`,
          isError: true
        };
      }

      try {
        let existed = true;
        try {
          await access(resolvedPath);
        } catch (err) {
          existed = false;
        }

        await mkdir(dirname(String(resolvedPath)), { recursive: true });
        await writeFile(resolvedPath, String(input.content), "utf-8");

        return {
          content: `Successfully ${existed ? "overwrote" : "created"} ${input.file_path}`
        };
      } catch (error: unknown) {
        return {
          content: `Error writing file: ${error instanceof Error ? error.message : String(error)}`,
          isError: true
        };
      }
    },
    isReadOnly: () => false,
    isEnabled: () => true,
}