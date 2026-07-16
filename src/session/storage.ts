import * as crypto from "node:crypto";
import * as path from "path";
import * as fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import { MessageParam } from "@anthropic-ai/sdk/resources";

import { AGENT_HOME, getTimestamp } from "../utils/loadEnv.js";
import { getProjectPathInfo } from "../utils/getProjectPathInfo.js";
import { Usage } from "../types/message.js";
import { createEmptyUsage } from "../utils/usage.js";


const MAX_SESSIONS = 20;


export type TranscriptEntry = 
    | {
        type: "session_meta";
        sessionId: string;
        cwd: string;
        startedAt: string;
        model: string;
    }
    | {
        type: "message";
        timestamp: string;
        role: "user" | "assistant";
        message: MessageParam;
    }
    | {
        type: "tool_event";
        timestamp: string;
        name: string;
        arguments?: string;
        phase: "start" | "done";
        resultLength?: number;
        isError?: boolean;
    }
    | {
        type: "usage";
        timestamp: string;
        turn: Usage;
        total: Usage;
    }
    | {
        type: "system";
        timestamp: string;
        level: "info" | "error";
        message: string;
    }
    | {
        type: "compaction";
        timestamp: string;
        trigger: "auto" | "manual";
    };

export interface SessionMetadata {
    sessionId: string;
    model: string;
    cwd: string;
    startedAt: string;
}

export interface SessionSummary extends SessionMetadata {
    updatedAt: string;
    messageCount: number;
    totalUsage: Usage;
}

export interface SessionPaths {
    rootDir: string;
    projectSessionDir: string;
    transcriptPath: string;
    latestPath: string;
}

export interface RestoredSession {
  summary: SessionSummary;
  messages: MessageParam[];
  path: string;
}


export function createSessionId(): string {
    return crypto.randomUUID();
}


export async function isEmptyMessageSession(sessionFilePath: string): Promise<boolean> {
    if (!sessionFilePath) return true;
    const entries = await readTranscriptEntries(sessionFilePath);
    if (entries.length === 0) {
        return true;
    }

    const messages = entries
      .filter((entry): entry is TranscriptEntry & { type: "message" } => entry.type === "message")
      .map((entry) => entry.message);
    return messages.length === 0;
}


export async function deleteSession(sessionFilePath: string, latestSession: string): Promise<void> {
    // 删除最后一个 / 后的内容
    const latestSessionPath = path.join(path.dirname(sessionFilePath), "latest");
    await fs.unlink(sessionFilePath);
    await fs.writeFile(latestSessionPath, `${latestSession}\n`, "utf-8");
}


export async function getSessionPaths(cwd: string, sessionId: string): Promise<SessionPaths> {
    const { projectDir } = await getProjectPathInfo(cwd);
    const projectSessionDir = path.join(projectDir, "sessions");

    return {
        rootDir: AGENT_HOME,
        projectSessionDir,
        transcriptPath: path.join(projectSessionDir, `${sessionId}.jsonl`),
        latestPath: path.join(projectSessionDir, "latest"),
    };
}

async function ensureSessionDir(paths: SessionPaths): Promise<void> {
    await fs.mkdir(paths.projectSessionDir, { recursive: true });
}

async function readTranscriptEntries(sessionFilePath: string): Promise<TranscriptEntry[]> {
    try{
        const raw = await fs.readFile(sessionFilePath, "utf-8");
        return raw
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map(parseJsonLine)
        .filter((entry): entry is TranscriptEntry => entry !== null);
    } catch (error: unknown) {
        const err = error as NodeJS.ErrnoException;
        if (err.code === "ENOENT") {
            return [];
        }
        throw error;
    }
}

function getLatestUsage(entries: TranscriptEntry[]): TranscriptEntry & { type: "usage" } | null {
    const latestUsage = [...entries]
              .reverse()
              .find((entry): entry is Extract<TranscriptEntry, { type: "usage" }> => entry.type === "usage");
    return latestUsage || null;
}


export async function initSessionStorage(metadata: SessionMetadata): Promise<SessionPaths> {
    const paths = await getSessionPaths(metadata.cwd, metadata.sessionId);
    await ensureSessionDir(paths);

    const metaEntry: TranscriptEntry = {
        type: "session_meta",
        sessionId: metadata.sessionId,
        cwd: metadata.cwd,
        startedAt: metadata.startedAt,
        model: metadata.model,
    }

    await fs.writeFile(paths.transcriptPath, `${JSON.stringify(metaEntry)}\n`, { flag: "a", encoding: "utf-8" });
    await fs.writeFile(paths.latestPath, `${metadata.sessionId}\n`, "utf-8");
    return paths;
}


export async function appendTranscriptEntry(
    cwd: string,
    sessionId: string,
    entry: TranscriptEntry,
): Promise<void> {
    const paths = await getSessionPaths(cwd, sessionId);
    await ensureSessionDir(paths);
    await fs.appendFile(paths.transcriptPath, JSON.stringify(entry) + "\n", "utf-8");
    await fs.writeFile(paths.latestPath, sessionId + "\n", "utf-8");
}


export async function getLatestSessionId(cwd: string): Promise<string> {
    const { latestPath } = await getSessionPaths(cwd, "placeholder");
    try {
        const value = (await fs.readFile(latestPath, "utf-8")).trim();
        return value || "";
    } catch (error: unknown) {
        const err = error as NodeJS.ErrnoException;
        if (err?.code === "ENOENT") return "";
        throw error;
    }
}

export async function restoreSession(cwd: string, sessionId?: string): Promise<RestoredSession> {
    const resolvedSessionId = sessionId ?? (await getLatestSessionId(cwd));
    if (!resolvedSessionId) {
        throw new Error("No saved session found for this project.");
    }

    const { transcriptPath } = await getSessionPaths(cwd, resolvedSessionId);
    const entries = await readTranscriptEntries(transcriptPath);
    if (entries.length === 0) {
        throw new Error(`Session ${resolvedSessionId} is empty or unreadable.`);
    }
    
    const meta = entries.find((entry): entry is TranscriptEntry & { type: "session_meta" } => entry.type === "session_meta");
    if (!meta) {
        throw new Error(`Session ${resolvedSessionId} is missing session metadata entry.`);
    }

    // Find the last compaction marker; only use messages after it
    let startIndex = 0;
    for (let i = entries.length - 1; i >= 0; i--) {
        if (entries[i]!.type === "compaction") {
            startIndex = i + 1;
            break;
        }
    }

    const messages = entries
      .slice(startIndex)
      .filter((entry): entry is TranscriptEntry & { type: "message" } => entry.type === "message")
      .map((entry) => entry.message);
    if (messages.length === 0) {
        throw new Error(`Session ${resolvedSessionId} is missing message entries.`);
    }

    const latestUsage = getLatestUsage(entries);

    return {
        summary: {
            sessionId: meta.sessionId,
            model: meta.model,
            cwd: meta.cwd,
            startedAt: meta.startedAt,
            updatedAt: getLatestUpdatedAt(entries, meta.startedAt),
            messageCount: messages.length,
            totalUsage: latestUsage?.total || createEmptyUsage(),
        },
        messages: messages,
        path: transcriptPath,
    };
}


function isMessageParam(value: unknown): value is MessageParam {
    if (!value || typeof value !== "object") return false;
    const record = value as Record<string, unknown>;
    return (record.role === "user" || record.role === "assistant") && "content" in record;
}

function isUsage(value: unknown): value is Usage {
    if (!value || typeof value !== "object") return false;
    const record = value as Record<string, unknown>;
    return typeof record.input_tokens === "number" && typeof record.output_tokens === "number";
}

function parseJsonLine(line: string): TranscriptEntry | null {
    try {
        const parsed = JSON.parse(line) as Record<string, unknown>;

        if (parsed.type === "session_meta") {
            if (
                typeof parsed.sessionId === "string" &&
                typeof parsed.cwd === "string" &&
                typeof parsed.startedAt === "string" &&
                typeof parsed.model === "string"
            ) {
                return {
                    type: "session_meta",
                    sessionId: parsed.sessionId,
                    cwd: parsed.cwd,
                    startedAt: parsed.startedAt,
                    model: parsed.model,
                };
            }
            return null;
        }

        if (parsed.type === "message") {
            if (
                typeof parsed.timestamp === "string" &&
                (parsed.role === "user" || parsed.role === "assistant") &&
                typeof parsed.message === "object" &&
                isMessageParam(parsed.message)
            ) {
                return {
                    type: "message",
                    timestamp: parsed.timestamp,
                    role: parsed.role,
                    message: parsed.message as MessageParam,
                };
            }
            return null;
        }

        if (parsed.type === "tool_event") {
            if (
                typeof parsed.timestamp === "string" &&
                typeof parsed.name === "string" &&
                // typeof parsed.arguments === "string"
                (parsed.phase === "start" || parsed.phase === "done")
            ) {
                return {
                    type: "tool_event",
                    timestamp: parsed.timestamp,
                    name: parsed.name,
                    // arguments: parsed.arguments,
                    phase: parsed.phase,
                    ...(typeof parsed.resultLength === "number" ? { resultLength: parsed.resultLength } : {}),
                    ...(typeof parsed.isError === "boolean" ? { isError: parsed.isError } : {}),
                }
            }
            return null;
        }

        if (parsed.type === "usage") {
            if (
                typeof parsed.timestamp === "string" &&
                isUsage(parsed.turn) &&
                isUsage(parsed.total)
            ) {
                return {
                    type: "usage",
                    timestamp: parsed.timestamp,
                    turn: parsed.turn as Usage,
                    total: parsed.total as Usage,
                };
            }
            return null;
        }

        if (parsed.type === "system") {
            if (
                typeof parsed.timestamp === "string" &&
                (parsed.level === "info" || parsed.level === "error") &&
                typeof parsed.content === "string"
            ) {
                return {
                    type: "system",
                    timestamp: parsed.timestamp,
                    level: parsed.level,
                    message: parsed.content,
                };
            }
            return null;
        }

        if (parsed.type === "compaction") {
            if (
                typeof parsed.timestamp === "string" &&
                (parsed.trigger === "auto" || parsed.trigger === "manual")
            ) {
                return {
                    type: "compaction",
                    timestamp: parsed.timestamp,
                    trigger: parsed.trigger,
                };
            }
            return null;
        }
        return null;
    } catch (error: unknown) {
        return null;
    }
}

function getLatestUpdatedAt(entries: TranscriptEntry[], fallback: string): string {
    const latest = [...entries]
      .reverse()
      .find((entry): entry is Extract<TranscriptEntry, { timestamp: string }> => "timestamp" in entry);
    return latest?.timestamp ?? fallback;
}

export async function listProjectSessions(cwd: string, limit = MAX_SESSIONS): Promise<SessionSummary[]> {
    const { projectSessionDir } = await getSessionPaths(cwd, "placeholder");
    let entries: Dirent[];

    try {
        entries = await fs.readdir(projectSessionDir, { withFileTypes: true });
    } catch (error: unknown) {
        const err = error as NodeJS.ErrnoException;
        if (err?.code === "ENOENT") return [];
        throw error;
    }

    const sessionFiles = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
      .map((entry) => path.join(projectSessionDir, entry.name));

    const sessions = await Promise.all(
        sessionFiles.map(async (sessionFilePath) => {
            const transcriptEntries = await readTranscriptEntries(sessionFilePath);
            const meta = transcriptEntries.find((entry): entry is Extract<TranscriptEntry, { type: "session_meta" }> => entry.type === "session_meta");
            if (!meta) return null;

            const messages = transcriptEntries.filter((entry) => entry.type === "message");
            const latestUsage = getLatestUsage(transcriptEntries);

            return {
                sessionId: meta.sessionId,
                cwd: meta.cwd,
                startedAt: meta.startedAt,
                updatedAt: getLatestUpdatedAt(transcriptEntries, meta.startedAt),
                model: meta.model,
                messageCount: messages.length,
                totalUsage: latestUsage?.total ?? createEmptyUsage(),
            } satisfies SessionSummary;
        })
    );

    return sessions
      .filter((session): session is SessionSummary => session !== null)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, limit);
}


export async function appendCompactionSnapshot(
    cwd: string,
    sessionId: string,
    trigger: "auto" | "manual",
    messages: MessageParam[],
): Promise<void> {
    const paths = await getSessionPaths(cwd, sessionId);
    await ensureSessionDir(paths);
    const lines: string[] = [];
    lines.push(JSON.stringify({
        type: "compaction",
        timestamp: getTimestamp(),
        trigger,
    }));
    for (const message of messages) {
        lines.push(JSON.stringify({
            type: "message",
            timestamp: getTimestamp(),
            role: message.role,
            content: message.content,
        }));
    }
    await fs.appendFile(paths.transcriptPath, lines.join("\n") + "\n", "utf-8");
}