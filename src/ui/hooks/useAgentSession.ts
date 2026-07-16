// React 是必须导入的，因为 JSX 编译后依赖 React
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
// Anthropic Messages API 的类型定义
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages.js";

import { getTimestamp } from '../../utils/loadEnv.js';
import { buildTokenBudgetSnapshot } from "../../utils/tokens.js";
import { createEmptyUsage } from "../../utils/usage.js";
import {
  loadPermissionSettings,
  type PermissionDecision,
  type PermissionMode,
  type PermissionRequest,
  type PermissionRuleSet,
  type PermissionSettings,
} from "../../permissions/permissions.js";
import {
    appendCompactionSnapshot,
    appendTranscriptEntry,
    createSessionId,
    initSessionStorage,
    restoreSession,
    isEmptyMessageSession,
    deleteSession,
    getLatestSessionId,
} from "../../session/storage.js"
// 本地类型定义：工具调用信息和 token 用量汇总
import type {
    PermissionPromptState,
    ToolCallInfo,
    UsageSummary,
    SystemNotice,
} from './../types.js';
import type { ToolContext } from "../../tools/Tool.js";
import { QueryEngine } from '../../core/queryEngine.js';

interface UseAgentSessionOptions {
  model: string;
  onExit: () => void;
  permissionMode?: PermissionMode;
  shouldResume?: boolean;
  resumeSessionId?: string;
}

interface SubmitResult {
  handled: boolean;
}

function markToolCallComplete(
  toolCalls: ToolCallInfo[],
  name: string,
  resultLength: number,
  isError?: boolean,
): ToolCallInfo[] {
  // 遍历工具调用列表，找到匹配名称且尚未完成的工具调用
  // 更新其 resultLength 和 isError 状态，返回新的工具调用数组
  return toolCalls.map((toolCall) => 
    toolCall.name === name
    // 检查此工具调用是否尚未完成（resultLength 未定义）
    && toolCall.resultLength === undefined
    // 如果条件匹配，更新工具调用的 resultLength 和 isError 状态
    // 否则保持原状态不变
    ? { ...toolCall, resultLength, isError } : toolCall,
  );
}


function buildCommandNotice(
    message: string,
    kind: "info" | "error",
): SystemNotice {
    if (message.startsWith("Commands:")) {
        return {
            tone: "info",
            title: "Available commands",
            body: [
                "/help  Show available commands",
                "/clear  Clear conversation history",
                "/cost  Show session token usage",
                "/model [name|default]  Inspect or override the session model",
                "/history  Show saved sessions for this project",
                "/exit | /quit | /bye  Exit session",
            ].join("\n"),
        }
    }

    if (message.startsWith("Session usage") || message.startsWith("Recent sessions:")) {
        return {
            tone: kind,
            title: message.startsWith("Recent sessions:") ? "Session history" : "Session usage",
            body: message,
        };
    }

    if (message.startsWith("Model status") || message.startsWith("Model updated")) {
        return {
        tone: kind,
        title: message.startsWith("Model status") ? "Model status" : "Model updated",
        body: message,
        };
    }

    if (message.startsWith("Unknown command:")) {
        return {
        tone: "error",
        title: "Unknown command",
        body: message,
        };
    }

    if (message === "Conversation cleared.") {
        return {
        tone: "info",
        title: "Conversation reset",
        body: message,
        };
    }

    return {
        tone: kind,
        title: kind === "error" ? "Command error" : "System message",
        body: message,
    }
}


export function useAgentSession({
    model,
    onExit,
    permissionMode,
    shouldResume,
    resumeSessionId,
}: UseAgentSessionOptions) {
    
    // 对话数据
    const [messages, setMessages] = useState<MessageParam[]>([]);  // 完整的消息历史

    // UI 状态
    const [isLoading, setIsLoading] = useState(false);  // 是否正在请求 API
    const [spinnerLabel, setSpinnerLabel] = useState("Thinking");  // 加载动画文本
    const [streamingText, setStreamingText] = useState("");  // 流式输出的增量文本
    const [toolCalls, setToolCalls] = useState<ToolCallInfo[]>([]);  // 当前工具调用列表
    const [lastUsage, setLastUsage] = useState<UsageSummary | null>(null);  // 上一轮的 token 用量
    const [totalUsage, setTotalUsage] = useState<UsageSummary | null>(null);  // 累计 token 用量
    const [systemNotice, setSystemNotice] = useState<SystemNotice | null>(null);  // 系统通知
    const [permissionPrompt, setPermissionPrompt] = useState<PermissionPromptState | null>(null);
    const [permissionSettings, setPermissionSettings] = useState<PermissionSettings | null>(null);
    const [currentModel, setCurrentModel] = useState(model);

    const permissionResolverRef = useRef<((decision: PermissionDecision) => void) | null>(null);
    const sessionRulesRef = useRef<PermissionRuleSet | null>({ allow: [], deny: [] });
    const engineRef = useRef<QueryEngine | null>(null);
    const sessionIdRef = useRef<string>(createSessionId());
    const latestSessionRef = useRef<string>("");
    const sessionPathRef = useRef<string>("");

    const toolContext = useMemo<ToolContext>(() => ({
        cwd: process.cwd(),
    }), []);

    useEffect(() => {
        void loadPermissionSettings(process.cwd())
          .then(setPermissionSettings)
          .catch((error: unknown) => {
            setSystemNotice({
                tone: "error",
                title: "Permission settings error",
                body: error instanceof Error ? error.message : String(error),
            });
          });
    }, []);

    // 初始化会话
    useEffect(() => {
        if (!permissionSettings) return;

        let cancelled = false;
        const initialize = async () => {
            try {
                let initialMessages: MessageParam[] = [];
                let initialUsage = createEmptyUsage();
                latestSessionRef.current = await getLatestSessionId(toolContext.cwd);
                if (shouldResume) {
                    const restored = await restoreSession(toolContext.cwd, resumeSessionId ?? undefined);
                    if (cancelled) return;
                    sessionIdRef.current = restored.summary.sessionId;
                    sessionPathRef.current = restored.path;

                    initialMessages = restored.messages;
                    initialUsage = restored.summary.totalUsage;

                    setMessages(initialMessages);
                    setTotalUsage({
                        input: initialUsage.input_tokens,
                        output: initialUsage.output_tokens,
                    });
                    setSystemNotice({
                        tone: "info",
                        title: "Session restored",
                        body: `Resumed session ${sessionIdRef.current} with ${restored.summary.messageCount} messages.`
                    });
                } else {
                    const startedAt = getTimestamp();
                    const { transcriptPath } = await initSessionStorage({
                        sessionId: sessionIdRef.current,
                        model: model,
                        cwd: toolContext.cwd,
                        startedAt: startedAt,
                    });
                    sessionPathRef.current = transcriptPath;
                }

                engineRef.current = new QueryEngine({
                    model: model,
                    toolContext: toolContext,
                    initialMessages,
                    initialUsage,
                    permissionMode: permissionMode ?? permissionSettings?.mode,
                    permissionSettings: permissionSettings ?? undefined,
                    sessionPermissionRules: sessionRulesRef.current ?? undefined,
                    onPermissionRequest: (request: PermissionRequest) => {
                        setSpinnerLabel("Waiting for permission...");
                        setPermissionPrompt({
                            toolName: request.toolName,
                            summary: request.summary,
                            risk: request.risk,
                            ruleHint: request.ruleHint,
                        });
                        return new Promise<PermissionDecision>((resolve) => {
                            permissionResolverRef.current = resolve;
                        });
                    },
                });
                setCurrentModel(model);
            } catch (error: unknown) {
                if (cancelled) return;
                setSystemNotice({
                    tone: "error",
                    title: "Session restore error",
                    body: error instanceof Error ? error.message : String(error),
                });
            }
        };

        void initialize();

        return () => {
            cancelled = true;
        };
    }, [model, permissionMode, permissionSettings, shouldResume, resumeSessionId, toolContext]);

    const interrupt = useCallback(() => {
        if (permissionResolverRef.current) {
            permissionResolverRef.current("deny");
            permissionResolverRef.current = null;
            setPermissionPrompt(null);
            setSystemNotice({
                tone: "info",
                title: "Permission denied",
                body: "Use /exit, /quit, /bye, or Ctrl+D to exit."
            });
            return true;
        };

        if (!engineRef.current?.interrupt()) {
            setSystemNotice({
                tone: "info",
                title: "Nothing to interrupt",
                body: "Use /exit, /quit, /bye, or Ctrl+D to exit."
            });
            return true;
        }

        setIsLoading(false);
        setStreamingText("");
        setSystemNotice({
            tone: "info",
            title: "Interrupted",
            body: "Use /exit, /quit, /bye, or Ctrl+D to exit."
        });
        return true;
    }, []);

    const resolvePermission = useCallback((decision: PermissionDecision) => {
        if (!permissionResolverRef.current) {
            return false;
        }
        permissionResolverRef.current(decision);
        permissionResolverRef.current = null;
        setPermissionPrompt(null);
        setSystemNotice({
            tone: decision === "deny" ? "error" : "info",
            title: decision === "deny" ? "Permission denied" : "Permission granted",
            body: 
                decision === "allow_always"
                ? "Permission granted and remembered for this session."
                : decision === "allow_once"
                  ? "Permission granted once."
                  : "Permission denied.",
        });
        return true;
    }, []);

    // 提交用户消息，启动 Agentic Loop
    // 流程：发送消息 → AI 回复 → 若需要调工具则执行 → 结果喂回 AI → 重复
    // 处理 slash 命令（/exit, /clear, /history）、AbortError、token 用量统计
    const submit = useCallback(
        async (text: string): Promise<SubmitResult> => {
            if (!text.trim()) {
                return {
                    handled: false
                };
            }
            const trimmed = text.trim();

            // Slash commands 本地拦截
            if (trimmed === "/exit" || trimmed === "/quit" || trimmed === "/bye") {
                setSystemNotice({
                    tone: "info",
                    title: "Exiting",
                    body: `${sessionPathRef.current} - ${latestSessionRef.current}`,
                });
                if (await isEmptyMessageSession(sessionPathRef.current ?? "") && latestSessionRef.current) {
                    await deleteSession(sessionPathRef.current ?? "", latestSessionRef.current);
                }
                onExit();
                return {
                    handled: true
                };
            }

            if (!engineRef.current) {
                setSystemNotice({
                    tone: "error",
                    title: "QueryEngine is not ready",
                    body: "Please wait for initialization to finish.",
                });
                return { handled: true };
            }

            const isSlashCommand = trimmed.startsWith("/");

            // 重置 UI 状态
            setStreamingText("");
            setToolCalls([]);
            setSystemNotice(null);
            if (!isSlashCommand) {
                setLastUsage(null);
                await appendTranscriptEntry(toolContext.cwd, sessionIdRef.current, {
                    type: "message",
                    timestamp: getTimestamp(),
                    role: "user",
                    message: {
                        role: "user",
                        content: trimmed
                    },
                });
            }
            setPermissionPrompt(null);
            const needsLoading = !isSlashCommand || trimmed.startsWith("/compact");
            setIsLoading(needsLoading);
            setSpinnerLabel(trimmed.startsWith("/compact") ? "Compacting conversation" : "Thinking");

            try {
                const run = engineRef.current.submitMessage(trimmed);

                while (true) {
                    const { value, done } = await run.next();
                    if (done) {
                        if (value.reason === "aborted") {
                            setSystemNotice({
                                tone: "info",
                                title: "Interrupted",
                                body: "Use /exit, /quit, /bye, or Ctrl+D to exit."
                            })
                        }
                        break;
                    }
                    // export type AgenticLoopEvent =
                    //   | { type: "text"; text: string }
                    //   | { type: "tool_use_start"; id: string; name: string }
                    //   | { type: "permission_request"; request: PermissionRequest }
                    //   | { type: "tool_use_done"; id: string; name: string; result: ToolResult }
                    //   | { type: "assistant_message"; message: MessageParam }
                    //   | { type: "tool_result_message"; message: MessageParam }
                    //   | { type: "turn_complete"; reason: LoopTerminationReason; turnCount: number }
                    //   | { type: "error"; error: Error };

                    switch (value.type) {
                        case "text":
                            setStreamingText((prev) => prev + value.text);
                            break;
                        case "tool_use_start":
                            setToolCalls((prev) => [...prev, {
                                name: value.name
                            }]);
                            await appendTranscriptEntry(toolContext.cwd, sessionIdRef.current, {
                                type: "tool_event",
                                timestamp: getTimestamp(),
                                name: value.name,
                                // arguments: value.request.arguments,
                                phase: "start",
                            });
                            break;
                        case "permission_request":
                            setSpinnerLabel("Waiting for permission");
                            setPermissionPrompt({
                                toolName: value.request.toolName,
                                summary: value.request.summary,
                                risk: value.request.risk,
                                ruleHint: value.request.ruleHint,
                            });
                            break;
                        case "tool_use_done":
                            setToolCalls((prev) => markToolCallComplete(
                                    prev,
                                    value.name,
                                    value.result.content.length,
                                    value.result.isError
                                ),
                            );
                            await appendTranscriptEntry(toolContext.cwd, sessionIdRef.current, {
                                type: "tool_event",
                                timestamp: getTimestamp(),
                                name: value.name,
                                // arguments: value.request.arguments,
                                phase: "done",
                                resultLength: value.result.content.length,
                                isError: value.result.isError,
                            });
                            break;
                        case "assistant_message":
                            setStreamingText("");
                            await appendTranscriptEntry(toolContext.cwd, sessionIdRef.current, {
                                type: "message",
                                timestamp: getTimestamp(),
                                role: "assistant",
                                message: value.message,
                            });
                            break;
                        case "tool_result_message":
                            setSpinnerLabel("Thinking");
                            setPermissionPrompt(null);
                            await appendTranscriptEntry(toolContext.cwd, sessionIdRef.current, {
                                type: "message",
                                timestamp: getTimestamp(),
                                role: "user",
                                message: value.message,
                            });
                            break;
                        case "messages_updated":
                            setMessages(value.messages);
                            break;
                        case "usage_updated":
                            {
                                const engineMessages = engineRef.current?.getState().messages ?? [];
                                const usageAnchorIndex = engineMessages.length > 0 ? engineMessages.length - 1 : -1;
                                const snapshot = buildTokenBudgetSnapshot(engineMessages, {
                                    usage: value.lastCallUsage,
                                    usageAnchorIndex: usageAnchorIndex,
                                });
                                const contextPercent = Math.round((snapshot.estimatedConversationTokens / snapshot.contextWindow) * 100);
                                const turnInput = value.turnUsage.input_tokens + (value.turnUsage.cache_creation_input_tokens ?? 0) + (value.turnUsage.cache_read_input_tokens ?? 0);
                                const totalInput = value.totalUsage.input_tokens + (value.totalUsage.cache_creation_input_tokens ?? 0) + (value.totalUsage.cache_read_input_tokens ?? 0);
                                setLastUsage({
                                    input: turnInput,
                                    output: value.turnUsage.output_tokens,
                                    contextTokens: snapshot.estimatedConversationTokens,
                                    contextPercent,
                                });
                                setTotalUsage({
                                    input: totalInput,
                                    output: value.totalUsage.output_tokens,
                                    contextTokens: snapshot.estimatedConversationTokens,
                                    contextPercent,
                                });
                            }
                            await appendTranscriptEntry(toolContext.cwd, sessionIdRef.current, {
                                type: "usage",
                                timestamp: getTimestamp(),
                                turn: value.turnUsage,
                                total: value.totalUsage,
                            });
                            break;
                        case "command":
                            setSystemNotice(buildCommandNotice(
                                value.message,
                                value.kind,
                            ));
                            await appendTranscriptEntry(toolContext.cwd, sessionIdRef.current, {
                                type: "system",
                                timestamp: getTimestamp(),
                                level: value.kind,
                                message: value.message,
                            });
                            break;
                        case "compacted":
                            setSystemNotice({
                                tone: "info",
                                title: value.trigger === "micro" ? "Context micro-compacted" : "Conversation compacted",
                                body: value.summary ?? (value.trigger === "micro" ? "Old tool results were cleared to save context space." : "Conversation summary created."),
                            });
                            if (value.trigger !== "micro") {
                                const compactedMessages = engineRef.current?.getState().messages ?? [];
                                await appendCompactionSnapshot(
                                    toolContext.cwd,
                                    sessionIdRef.current,
                                    value.trigger as "auto" | "manual",
                                    compactedMessages,
                                );
                            } else {
                                await appendTranscriptEntry(toolContext.cwd, sessionIdRef.current, {
                                    type: "system",
                                    timestamp: getTimestamp(),
                                    level: "info",
                                    message: `compaction: ${value.trigger}`,
                                });
                            }
                            break;
                        case "model_changed":
                            setCurrentModel(value.model);
                            break;
                        case "session_cleared":
                            setMessages([]);
                            setStreamingText("");
                            setToolCalls([]);
                            setLastUsage(null);
                            break;
                        case "turn_complete":
                            if (value.reason === "max_turns") {
                                setSystemNotice({
                                    tone: "error",
                                    title: "Turn complete",
                                    body: `Reached maximun tool turns (${value.turnCount}).`
                                })
                            }
                            break;
                        case "error":
                            setSystemNotice({
                                tone: "error",
                                title: "Agent error",
                                body: value.error.message
                            });
                            await appendTranscriptEntry(toolContext.cwd, sessionIdRef.current, {
                                type: "system",
                                timestamp: getTimestamp(),
                                level: "error",
                                message: value.error.message,
                            });
                            break;
                        default:
                            break;
                    }
                }

            } catch (error: unknown) {
                if (error instanceof Error && error.name === "AbortError") {
                    setSystemNotice({
                        tone: "info",
                        title: "Interrupted",
                        body: "Use /exit, /quit, /bye, or Ctrl+D to exit."
                    });
                } else {
                    setSystemNotice({
                        tone: "error",
                        title: "Unhandled error",
                        body: error instanceof Error ? error.message : String(error),
                    })
                }
            } finally {
                setIsLoading(false);
                permissionResolverRef.current = null;
                setPermissionPrompt(null);
            }

            return {
                handled: true
            }
        }, [onExit, toolContext.cwd]);
    
    return {
        state: {
            messages,
            isLoading,
            spinnerLabel,
            streamingText,
            toolCalls,
            lastUsage,
            totalUsage,
            systemNotice,
            permissionPrompt,
            permissionMode: permissionMode ?? permissionSettings?.mode ?? "default",
            currentModel,
        },
        actions: {
            submit,
            interrupt,
            resolvePermission,
        }
    }
}