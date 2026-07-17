import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

import { MEMORY_ENTRYPOINT } from "../../utils/loadEnv.js";
import { getProjectPathInfo, sanitizeSlug } from "../../utils/getProjectPathInfo.js";
import type { MemoryType, MemoryFrontamatter, MemoryDocument, MemoryEntry } from "./memoryTypes.js";
import { isMemoryType } from "./memoryTypes.js";


const MAX_ENTRYPOINT_LINES = 200;
const MAX_ENTRYPOINT_BYTES = 1024 * 25;


export interface WriteProjectMemoryOptions {
    cwd: string;
    name: string;
    description: string;
    type: MemoryType;
    content: string;
    fileName?: string;
}

export interface WriteProjectMemoryResult {
    fileName: string;
    filePath: string;
    updatedExisting: boolean;
}

export interface MemoryHeader extends MemoryEntry {
    frontmatter: MemoryFrontamatter;
    relativePath: string;
}


async function getProjectMemoryDir(cwd: string): Promise<string> {
    const { projectDir } = await getProjectPathInfo(cwd);
    return path.join(projectDir, "memory");
}

export async function ensureMemoryDirExists(cwd: string): Promise<string> {
    const memoryDir = await getProjectMemoryDir(cwd);
    await fs.mkdir(memoryDir, { recursive: true });
    const entrypoint = path.join(memoryDir, MEMORY_ENTRYPOINT);

    try {
        await fs.access(entrypoint);
    } catch {
        await fs.writeFile(entrypoint, "# Project Memory\n\n", "utf-8");
    }

    return memoryDir;
}


function normalizeLine(value: string): string {
    return value.replace(/\s+/g, " ").trim();
}

function parseFrontmatter(raw: string): MemoryFrontamatter | null {
    const match = raw.match(/^---\n([\s\S]*?)\n---\n?/);
    if (!match) return null;

    const fields = new Map<string, string>();
    for (const line of match[1].split(/\r?\n/)) {
        const idx = line.indexOf(":");
        if (idx === -1) continue;
        fields.set(line.slice(0, idx).trim(), line.slice(idx + 1).trim());
    }

    const name = fields.get("name");
    const description = fields.get("description");
    const type = fields.get("type");
    if (!name || !description || !type || !isMemoryType(type)) {
        return null;
    }

    return {
        name: normalizeLine(name),
        description: normalizeLine(description),
        type,
    };
}

function stripFrontmatter(raw: string): string {
    return raw.replace(/^---\n([\s\S]*?)\n---\n?/, "");
}


async function collectMemoryMarkdownFiles(memoryDir: string, currentDir = memoryDir): Promise<string[]> {
    const dirents = await fs.readdir(currentDir, { withFileTypes: true });
    const nested = await Promise.all(
        dirents.map(async (entry) => {
            const fullPath = path.join(currentDir, entry.name);
            if (entry.isDirectory()) {
                return collectMemoryMarkdownFiles(memoryDir, fullPath);
            }
            if (entry.isFile() && entry.name.endsWith(".md") && entry.name !== MEMORY_ENTRYPOINT) {
                return [path.relative(memoryDir, fullPath)];
            }
            return [];
        }),
    );

    return nested.flat();
}

export async function loadMemoryHeaders(cwd: string): Promise<MemoryHeader[]> {
    const memoryDir = await ensureMemoryDirExists(cwd);
    const relativePaths = await collectMemoryMarkdownFiles(memoryDir);
    const headers = await Promise.all(
        relativePaths.map(async (relativePath) => {
            const filePath = path.join(memoryDir, relativePath);
            const raw = await fs.readFile(filePath, "utf-8");
            const frontmatter = parseFrontmatter(raw);
            if (!frontmatter) return null;
            return {
                fileName: relativePath,
                filePath,
                title: frontmatter.name,
                hook: frontmatter.description,
                frontmatter,
                relativePath,
            } satisfies MemoryHeader;
        }),
    );
    return headers
      .filter((header): header is MemoryHeader => header !== null)
      .sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

export async function loadMemoryDocumentBodies(cwd: string, relativePaths: readonly string[]): Promise<MemoryDocument[]> {
    const memoryDir = await ensureMemoryDirExists(cwd);
    const uniquePaths = [...new Set(relativePaths)];
    const docs = await Promise.all(
        uniquePaths.map(async (relativePath) => {
            const filePath = path.join(memoryDir, relativePath);
            const raw = await fs.readFile(filePath, "utf-8");
            const frontmatter = parseFrontmatter(raw);
            if (!frontmatter) return null;
            return {
                fileName: relativePath,
                filePath,
                relativePath,
                title: frontmatter.name,
                hook: frontmatter.description,
                frontmatter,
                body: stripFrontmatter(raw),
            } satisfies MemoryDocument;
        }),
    );
    return docs
      .filter((doc): doc is MemoryDocument => doc !== null)
      .sort((a, b) => a.fileName.localeCompare(b.fileName));
}

export async function listMemoryFiles(cwd: string): Promise<MemoryDocument[]> {
    const headers = await loadMemoryHeaders(cwd);
    return loadMemoryDocumentBodies(cwd, headers.map((header) => header.relativePath));
}

async function findExistingMemoryFile(cwd: string, name: string, description: string): Promise<string | null> {
    const docs = await listMemoryFiles(cwd);
    const normalizedName = normalizeLine(name).toLowerCase();
    const normalizedDescription = normalizeLine(description).toLowerCase();

    const exact = docs.find((doc) => doc.frontmatter.name.toLowerCase() === normalizedName);
    if (exact) return exact.fileName;

    const similar = docs.find((doc) => {
        const existing = `${doc.frontmatter.name} ${doc.frontmatter.description}`.toLowerCase();
        return existing.includes(normalizedName) || existing.includes(normalizedDescription);
    });

    return similar?.fileName ?? null;
}

function slugifyMemoryFileName(name: string): string {
    return `${sanitizeSlug(name).replace(/\.+/g, '-')}.md`;
}

function buildFrontmatterHeader(name: string, description: string, type: MemoryType): string {
    return [
        `---
        name: ${name}
        description: ${description}
        type: ${type}
        ---`
    ].join("\n");
}

function buildPointerLine(entry: MemoryEntry): string {
    return `- [${normalizeLine(entry.title)}](${entry.filePath}) - ${normalizeLine(entry.hook)}`;
}

function truncateEntrypoint(raw: string): { content: string; warning?: string } {
    let content = raw;
    let lineTruncated = false;
    let byteTruncated = false;

    const lines = content.split(/r?\n/);
    if (lines.length > MAX_ENTRYPOINT_LINES) {
        content = lines.slice(0, MAX_ENTRYPOINT_LINES).join("\n");
        lineTruncated = true;
    }

    while (Buffer.byteLength(content, "utf-8") > MAX_ENTRYPOINT_BYTES && content.length > 0) {
        content = content.slice(0, MAX_ENTRYPOINT_BYTES);
        byteTruncated = true;
    }

    const warning = lineTruncated || byteTruncated
    ? `> WARNING: MEMORY.md was truncated${lineTruncated ? " by line limit" : ""}${lineTruncated && byteTruncated ? " and" : ""}${byteTruncated ? " by byte limit" : ""}.`
    : undefined;

    return { content: content.trim(), ...(warning ? { warning } : {}) };
}

async function rewriteEntrypoint(memoryDir: string, entries: MemoryEntry[]): Promise<void> {
    const entrypointPath = path.join(memoryDir, MEMORY_ENTRYPOINT);
    const unique = new Map<string, string>();
    for (const entry of entries) {
        unique.set(entry.fileName, buildPointerLine(entry));
    }

    const bodyLines = ["# Project Memory", "", ...[...unique.values()]];
    const truncated = truncateEntrypoint(bodyLines.join("\n"));
    const finalText = [truncated.content, truncated.warning].filter(Boolean).join("\n\n") + "\n";
    await fs.writeFile(entrypointPath, finalText, "utf-8");
}

export async function writeProjectMemory(input: WriteProjectMemoryOptions): Promise<WriteProjectMemoryResult> {
    const memoryDir = await ensureMemoryDirExists(input.cwd);
    const existingFileName = input.fileName ?? (await findExistingMemoryFile(input.cwd, input.name, input.description));
    const fileName = existingFileName ?? slugifyMemoryFileName(input.name);
    const filePath = path.join(memoryDir, fileName);

    const body = [
        buildFrontmatterHeader(input.name, input.description, input.type),
        "",
        input.content,
        "",
    ].join("\n");
    
    await fs.writeFile(filePath, body, "utf-8");
    const docs = await listMemoryFiles(input.cwd);
    await rewriteEntrypoint(memoryDir, docs.map((doc) => ({
        fileName: doc.fileName,
        filePath: doc.filePath,
        title: doc.title,
        hook: doc.hook,
    })));

    return {
        filePath,
        fileName,
        updatedExisting: Boolean(existingFileName)
    };
}


export async function readMemoryEntrypoint(cwd: string): Promise<string | null> {
    const memoryDir = await ensureMemoryDirExists(cwd);
    const entrypoint = path.join(memoryDir, MEMORY_ENTRYPOINT);
    const raw = await fs.readFile(entrypoint, "utf-8");
    const truncated = truncateEntrypoint(raw);
    return [truncated.content, truncated.warning].filter(Boolean).join("\n\n") || null;
}


export function shouldIgnoreMemory(query: string): boolean {
    const normalized = query.toLowerCase();
    return ["ignore memory", "don't use memory", "do not use memory", "忽略记忆", "不要用记忆", "别用记忆"].some((term) => normalized.includes(term));
}

export function buildMemoryPromptInstructions(): string[] {
    return [
        "Use memory only for information that will be useful in future conversations and cannot be derived directly from the current repo state.",
        "Supported memory types: user, feedback, project, reference.",
        "When saving a memory, write one markdown file with frontmatter: name, description, type.",
        `After writing or updating a memory file, update ${MEMORY_ENTRYPOINT} with a one-line pointer in the form: - [Title](file.md) — one-line hook.`,
        `${MEMORY_ENTRYPOINT} is an index, not a place to store full memory content.`,
        `Keep ${MEMORY_ENTRYPOINT} under ${MAX_ENTRYPOINT_LINES} lines and ${MAX_ENTRYPOINT_BYTES} bytes.`,
        "Before creating a new memory, inspect existing topic memory files and update the best match when possible.",
    ];
}


export function formatMemorySystemLocation(memoryDir: string): string[] {
    const entrypointPath = path.join(memoryDir, MEMORY_ENTRYPOINT);
    return [
        `You have a persistent, file-based project memory system at \`${memoryDir}\`.`,
        `The memory index file is \`${entrypointPath}\`.`,
        `The index points to topic memory files stored under \`${memoryDir}\` (including subdirectories).`,
        "Before creating a new memory, inspect existing topic files and update the best match when possible.",
    ];
}
