

export const MEMORY_TYPES = ["user", "feedback", "project", "reference"] as const;

export type MemoryType = (typeof MEMORY_TYPES)[number];

export interface MemoryFrontamatter {
    name: string,
    description: string,
    type: MemoryType,
}

export interface MemoryEntry {
    fileName: string,
    filePath: string,
    title: string,
    hook: string,
}

export interface MemoryDocument extends MemoryEntry {
    frontmatter: MemoryFrontamatter;
    body: string;
}


export function isMemoryType(type: unknown): type is MemoryType {
    return typeof type === "string" && MEMORY_TYPES.includes(type as MemoryType);
}


export function buildMemoryValidationGuidance(): string[] {
    return [
        "Project memory stores only facts that cannot be derived reliably from the current repo state.",
        "Do not save code structure, file contents, or facts that can be re-read from the workspace.",
        "If the user says to ignore memory, proceed as if project memory were empty.",
        "Before relying on a memory that names a file path, check that the file still exists.",
        "Before relying on a memory that names a function, flag, or symbol, grep or read the current code to confirm it still exists.",
    ];
}
