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
import { readPlan, getPlanFilePath, getPlansDirectory } from "../../context/plans.js";
import { QueryEngine } from '../../core/queryEngine.js';
import type {
    TokenWarningResult
} from '../../context/autoCompact.js'
import { formatToolInputPreview } from '../utils/toolCardFormat.js';
import { clearTodos, getTodos, subscribeTodos } from "../../state/todoStore.js";
import type { TodoItem } from "../../types/todo.js";
import { getTaskListId, listTasks, subscribeTasks } from "../../state/taskStore.js";
import {
    getTaskMode,
    subscribeTaskMode,
    type TaskMode,
} from "../../state/taskModeStore.js";
import type { Task } from "../../types/task.js";


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

interface ToolCallCompletion {
  resultLength: number;
  isError?: boolean;
  displayName?: string;
  displayHint?: string;
  inputPreview?: string;
  errorMessage?: string;
}

/**
 * Mark a specific tool call card as complete, identified by its unique
 * tool_use id. We must NOT match by `name` alone — when an assistant turn
 * fires several parallel calls of the same tool (e.g. three Reads), a
 * name-based match would either update every pending card with the first
 * result that lands, or silently drop subsequent results.
 */
function markToolCallComplete(
  toolCalls: ToolCallInfo[],
  id: string,
  completion: ToolCallCompletion,
): ToolCallInfo[] {
  // 遍历工具调用列表，找到匹配名称且尚未完成的工具调用
  // 更新其 resultLength 和 isError 状态，返回新的工具调用数组
  return toolCalls.map((toolCall) => 
    toolCall.id === id
    // 如果条件匹配，更新工具调用的 resultLength 和 isError 状态
    // 否则保持原状态不变
    ? { ...toolCall, ...completion }
    : toolCall,
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
                "/mode [default|plan|auto]  Inspect or switch permission mode",
                "/tasks [task|todo|reset]  Switch task system or reset the task graph",
                "/history  Show saved sessions for this project",
                "/compact  Compact conversation context",
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

    if (message.startsWith("Task system")) {
        return {
            tone: kind,
            title: message.startsWith("Task system status") ? "Task system" : "Task system updated",
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
    const [activePermissionMode, setActivePermissionMode] = useState<string>(permissionMode ?? "default");
    const [todos, setTodosState] = useState<TodoItem[]>([]);
    const [tasks, setTasksState] = useState<Task[]>([]);
    const [taskMode, setTaskModeState] = useState<TaskMode>(getTaskMode());

    const permissionResolverRef = useRef<((decision: PermissionDecision) => void) | null>(null);
    const pendingClearContextRef = useRef(false);
    const pendingFeedbackRef = useRef<string | null>(null);
    const sessionRulesRef = useRef<PermissionRuleSet>({ allow: [], deny: [] });
    const engineRef = useRef<QueryEngine | null>(null);
    const sessionIdRef = useRef<string>(createSessionId());
    const latestSessionRef = useRef<string>("");
    const sessionPathRef = useRef<string>("");


    // Streaming-text throttling. SSE chunks can arrive at >100 Hz from fast
    // models, and every setStreamingText forces Ink to repaint the whole
    // frame — combined with the TodoList / ToolCallList that sit above it,
    // the unbatched updates caused visible flicker and "untouchable" terminal
    // scrolling. We coalesce chunks into a 30ms window (≈33 fps) — fast
    // enough to look live, slow enough to keep the UI usable.
    const pendingTextRef = useRef<string>("");
    const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const flushPendingText = useCallback(() => {
        flushTimerRef.current = null;
        if (pendingTextRef.current) {
            const chunk = pendingTextRef.current;
            pendingTextRef.current = "";
            setStreamingText((prev) => prev + chunk);
        }
    }, []);
    const cancelPendingText = useCallback(() => {
        if (flushTimerRef.current) {
            clearTimeout(flushTimerRef.current);
            flushTimerRef.current = null;
        }
        pendingTextRef.current = "";
    }, []);

    // Always release the timer on unmount so we don't leak across hot reloads.
    useEffect(() => () => cancelPendingText(), [cancelPendingText]);
    // `sessionId` is exposed as a live getter so tools always see the
    // current sessionIdRef value. This matters during /resume — the ref is
    // mutated *after* this hook has memoized the toolContext, and a baked-in
    // value would silently route TodoWrite writes to the old (orphan) key
    // while the UI subscriber filters on the new sessionId, leaving the
    // todo panel permanently empty.
    const toolContext = useMemo<ToolContext>(() => ({
        cwd: process.cwd(),
        get sessionId() {
            return sessionIdRef.current;
        },
    }), []);

    // Subscribe to TodoWrite updates. The store is global (mirrors source's
    // `appState.todos` map), so we filter by our own sessionId. When the
    // session is restored or cleared we also re-pull the snapshot.
    useEffect(() => {
        setTodosState(getTodos(sessionIdRef.current));
        const unsubscribe = subscribeTodos((sid, next) => {
        if (sid === sessionIdRef.current) {
            setTodosState(next);
        }
        });
        return unsubscribe;
    }, []);

    // Subscribe to Task V2 updates. Tasks live on disk, so on mount we do
    // one full listTasks to populate the initial view, then refresh every
    // time the store fires a change event for our task list id. Each
    // mutation already runs through the lock budget on the writer side,
    // so the reader doesn't need its own synchronization.
    useEffect(() => {
        let cancelled = false;
        const refresh = async () => {
            const taskListId = getTaskListId(sessionIdRef.current);
            try {
                const list = await listTasks(taskListId);
                if (!cancelled) setTasksState(list);
            } catch {
                // Ignore transient read errors — a future mutation will trigger
                // another refresh that can succeed.
            }
        };
        void refresh();
        const unsubscribe = subscribeTasks((taskListId) => {
        if (taskListId === getTaskListId(sessionIdRef.current)) {
            void refresh();
        }
        });
        return () => {
            cancelled = true;
            unsubscribe();
        };
    }, []);

    // Mirror the global task-mode store into local state so React re-renders
    // when the user flips `/tasks task|todo`. The global store is still the
    // source of truth — tools and permissions.ts read from it directly.
    useEffect(() => {
        setTaskModeState(getTaskMode());
        return subscribeTaskMode((mode) => setTaskModeState(mode));
    }, []);

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

                const engine = new QueryEngine({
                    model: model,
                    toolContext: toolContext,
                    initialMessages,
                    initialUsage,
                    permissionMode: permissionMode ?? permissionSettings?.mode,
                    permissionSettings: permissionSettings ?? undefined,
                    sessionPermissionRules: sessionRulesRef.current ?? undefined,
                    onPermissionRequest: async (request: PermissionRequest) => {
                        const isPlanExit = request.toolName === "ExitPlanMode";
                        setSpinnerLabel(isPlanExit ? "Waiting for plan approval" : "Waiting for permission");

                        let planContent: string | undefined;
                        let planFilePath: string | undefined;
                        if (isPlanExit) {
                            planContent = (await readPlan()) ?? undefined;
                            planFilePath = getPlanFilePath();
                        }

                        setPermissionPrompt({
                            toolName: request.toolName,
                            summary: request.summary,
                            risk: request.risk,
                            ruleHint: request.ruleHint,
                            isPlanExit: isPlanExit,
                            planContent: planContent,
                            planFilePath: planFilePath,
                        });
                        return new Promise<PermissionDecision>((resolve) => {
                            permissionResolverRef.current = resolve;
                        });
                    },
                });
                engine.onModeChange((newMode, previousMode) => {
                    setActivePermissionMode(newMode);
                    const label = newMode === "plan" ? "Entered plan mode" : "Exited plan mode";
                    const body = newMode === "plan"
                        ? "Only read-only tools are available. Explore the codebase and write your plan."
                        : `Returned to ${newMode} mode. Full tool access restored.`;
                    setSystemNotice({ tone: "info", title: label, body });
                });
                engineRef.current = engine;
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
        cancelPendingText();
        setStreamingText("");
        setSystemNotice({
            tone: "info",
            title: "Interrupted",
            body: "Use /exit, /quit, /bye, or Ctrl+D to exit."
        });
        return true;
    }, [cancelPendingText]);

    const resolvePermission = useCallback((decision: PermissionDecision, feedback?: string) => {
        if (!permissionResolverRef.current) {
            return false;
        }

        const autoAcceptRules = ["Write", "Edit", "Bash(npm *)","Bash(npx *)"];

        if (decision === "allow_clear_context") {
            pendingClearContextRef.current = true;
            sessionRulesRef.current.allow.push(...autoAcceptRules);
            permissionResolverRef.current("allow_once");
            // Abort the loop immediately after ExitPlanMode runs,
            // so the model doesn't start implementing in the same loop.
            // The clear-context flow will submit a fresh "Implement" message.
            engineRef.current?.interrupt();
        } else if (decision === "allow_accept_edits") {
            sessionRulesRef.current.allow.push(...autoAcceptRules);
            permissionResolverRef.current("allow_once");
        } else if (decision === "deny" && feedback) {
            pendingFeedbackRef.current = feedback;
            permissionResolverRef.current("deny");
        } else {
            permissionResolverRef.current(decision);
        }

        permissionResolverRef.current = null;
        setPermissionPrompt(null);

        if (decision === "deny" && feedback) {
            setSystemNotice({ tone: "info", title: "Plan rejected with feedback", body: `Feedback: ${feedback}` });
        } else if (decision === "deny") {
            setSystemNotice({ tone: "error", title: "Permission denied", body: "Permission denied." });
        } else if (decision === "allow_clear_context") {
            setSystemNotice({ tone: "info", title: "Plan approved", body: "Plan approved. Edits auto-accepted. Context will be cleared for implementation." });
        } else if (decision === "allow_accept_edits") {
            setSystemNotice({ tone: "info", title: "Plan approved", body: "Plan approved. Edits auto-accepted. Continuing with current context." });
        } else if (decision === "allow_always") {
            setSystemNotice({ tone: "info", title: "Permission granted", body: "Permission granted and remembered for this session." });
        } else {
            setSystemNotice({ tone: "info", title: "Permission granted", body: "Permission granted." });
        }
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
            cancelPendingText();
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
                        if (value.reason === "aborted" && !pendingClearContextRef.current) {
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
                            // Coalesce rapid SSE chunks into a 30ms window. Without this
                            // every chunk forces a full Ink frame repaint, and combined
                            // with the TodoList / ToolCallList above it the terminal
                            // flickers and refuses to scroll.
                            pendingTextRef.current += value.text;
                            if (!flushTimerRef.current) {
                                flushTimerRef.current = setTimeout(flushPendingText, 30);
                            }
                            break;
                        case "tool_use_start":
                            setToolCalls((prev) => [...prev, {
                                id: value.id,
                                name: value.name,
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
                        case "tool_use_done": {
                            const isPlanFileWrite = (value.name === "Write" || value.name === "Edit") && value.result.content.includes(getPlansDirectory());
                            const inputPreview = formatToolInputPreview(value.input);
                            const errorMessage = value.result.isError ? value.result.content : undefined;
                            setToolCalls((prev) => markToolCallComplete(
                                    prev,
                                    value.id,
                                    {
                                        resultLength: value.result.content.length,
                                        isError: value.result.isError,
                                        displayName: isPlanFileWrite ? "Updated plan" : undefined,
                                        displayHint: isPlanFileWrite ? "/plan to preview" : undefined,
                                        inputPreview: inputPreview,
                                        errorMessage: errorMessage,
                                    }
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
                        }
                        case "assistant_message":
                            // The full assistant text is committed to `messages` and will
                            // render via ConversationView. Drop any unflushed pending
                            // chunk so it can't overwrite the cleared streaming line.
                            cancelPendingText();
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
                            // Tool results are now committed to `messages` — the cards
                            // will render inline in ConversationView from here on, so we
                            // drop the live in-flight cards to avoid duplication and, more
                            // importantly, to keep the final assistant text rendered
                            // BELOW its tool calls (not above them).
                            setToolCalls([]);
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
                            const compactTitle = value.trigger === "micro"
                              ? "Context micro-compacted"
                              : value.trigger === "auto"
                                ? "Context auto-compacted"
                                : "Conversation compacted";
                            const compactBody = value.trigger === "micro"
                              ? "Old tool results cleared to save context space."
                              : "Conversation history has been summarized to free up context window.";
                            setSystemNotice({
                                tone: "info",
                                title: compactTitle,
                                body: compactBody,
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
                        case "mode_changed":
                            setActivePermissionMode(value.mode);
                            break;
                        case "task_mode_changed":
                            setTaskModeState(value.mode);
                            break;
                        case "session_cleared":
                            cancelPendingText();
                            setMessages([]);
                            setStreamingText("");
                            setToolCalls([]);
                            setLastUsage(null);
                            clearTodos(sessionIdRef.current);
                            break;
                        case "token_warning": {
                            const w = value.warning as TokenWarningResult;
                            const pct = Math.round((w.estimatedTokens / w.contextWindow) * 100);
                            if (w.state === "warning") {
                                setSystemNotice({
                                    tone: "info",
                                    title: "Context window filling up",
                                    body: `${pct}% used (${w.estimatedTokens} / ${w.contextWindow} tokens). Consider using / compact.`
                                });
                            } else if (w.state === "error") {
                                setSystemNotice({
                                    tone: "error",
                                    title: "Context window nearly full",
                                    body: `${pct}% used (${w.estimatedTokens} / ${w.contextWindow} tokens). Auto-compaction will trigger.`,
                                });
                            } else if (w.state === "blocking") {
                                setSystemNotice({
                                    tone: "error",
                                    title: "Context window limit reached",
                                    body: `${pct}% used (${w.estimatedTokens} / ${w.contextWindow} tokens). Use /compact to free space.`,
                                });
                            }
                            break;
                        }
                        case "turn_complete":
                            if (value.reason === "max_turns") {
                                setSystemNotice({
                                    tone: "error",
                                    title: "Turn complete",
                                    body: `Reached maximun tool turns (${value.turnCount}).`
                                })
                            } else if (value.reason === "blocking_limit") {
                                setSystemNotice({
                                    tone: "error",
                                    title: "Context window limit reached",
                                    body: "Cannot continue - context is full. Use /compact to free space."
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

            // After the loop completes, check if we need to clear context and re-submit
            if (pendingClearContextRef.current && engineRef.current) {
                pendingClearContextRef.current = false;
                const planContent = await readPlan();
                if (planContent) {
                    const implementMsg = engineRef.current.clearContextAndImplement(planContent);
                    cancelPendingText();
                    setMessages([]);
                    setStreamingText("");
                    setToolCalls([]);
                    setLastUsage(null);
                    clearTodos(sessionIdRef.current);
                    setSystemNotice({
                        tone: "info",
                        title: "Context cleared",
                        body: "Starting fresh with the approved plan. Implementing...",
                    });
                    return submit(implementMsg);
                }
            }

            // After plan rejection with feedback, re-submit the feedback so the model continues planning
            if (pendingFeedbackRef.current && engineRef.current) {
                const feedback = pendingFeedbackRef.current;
                pendingFeedbackRef.current = null;
                return submit(`User rejected the plan. Feedback: ${feedback}\n\nPlease revise your plan based on this feedback.`);
            }

            return {
                handled: true
            }
        }, [onExit, toolContext.cwd, cancelPendingText, flushPendingText]);
    
    return {
        state: {
            messages,
            isLoading,
            spinnerLabel,
            streamingText,
            toolCalls,
            todos,
            tasks,
            taskMode,
            lastUsage,
            totalUsage,
            systemNotice,
            permissionPrompt,
            permissionMode: activePermissionMode,
            currentModel,
        },
        actions: {
            submit,
            interrupt,
            resolvePermission,
        }
    }
}