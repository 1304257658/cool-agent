import type { Tool, ToolResult } from './Tool.js'
import { writeProjectMemory } from '../context/memory/memdir.js'
import { isMemoryType } from '../context/memory/memoryTypes.js'



export const memoryWriteTool: Tool = {
    name: 'MemoryWrite',
    description: 'Save durable project memory for future conversations. Only store information that cannot be derived directly from the current repository state.',
    inputSchema: {
        type: 'object',
        properties: {
            name: {
                type: 'string',
                description: 'Short memory title.',
            },
            description: {
                type: "string",
                description: "One-line hook used in MEMORY.md.",
            },
            type: {
                type: 'string',
                enum: ["user", "feedback", "project", "reference"],
                description: 'Memory type.',
            },
            content: {
                type: "string",
                description: "Full markdown memory content.",
            },
            file_name: {
                type: "string",
                description: "Optional target file name.",
            },
        },
        required: ['name', 'description', 'type', 'content'],
        additionalProperties: false,
    },
    async call (input, context): Promise<ToolResult> {
        const name = typeof input.name === "string" ? input.name.trim() : "";
        const description = typeof input.description === "string" ? input.description.trim() : "";
        const type = typeof input.type === "string" ? input.type.trim() : "";
        const content = typeof input.content === "string" ? input.content.trim() : "";
        const file_name = typeof input.file_name === "string" ? input.file_name.trim() : undefined;

        if (!name || !description || !content || !isMemoryType(type)) {
            return {
                content: "Error: name, description, content, and a valid memory type are required.",
                isError: true,
            };
        }

        const result = await writeProjectMemory({
            cwd: context.cwd,
            name,
            description,
            type,
            content,
            ...(file_name ? { file_name } : {}),
        });

        return {
            content: result.updatedExisting
            ? `Updated ${type} memory in ${result.fileName}.`
            : `Saved ${type} memory to ${result.fileName}.`,
        };
    },
    isReadOnly(): boolean {
        return false;
    },
    isEnabled(): boolean {
        return true;
    },
}



