// React 是必须导入的，因为 JSX 编译后依赖 React
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
// Anthropic Messages API 的类型定义
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages.js";

// 本地类型定义：工具调用信息和 token 用量汇总
import type {
    ToolCallInfo,
    UsageSummary,
    SystemNotice,
} from './../types.js';
import type { ToolContext } from "../../tools/Tool.js";
import { QueryEngine } from '../../core/queryEngine.js';

interface UseAgentSessionOptions {
  model: string;
  onExit: () => void;
//   permissionMode?: PermissionMode;
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
                "/history  Show message count",
                "/exit | /quit | /bye  Exit session",
            ].join("\n"),
        }
    }

    if (message.startsWith("Session usage")) {
        return {
            tone: kind,
            title: "Session usage",
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

    const [currentModel, setCurrentModel] = useState(model);

    const engineRef = useRef<QueryEngine | null>(null);

    const toolContext = useMemo<ToolContext>(() => ({
        cwd: process.cwd(),
    }), []);

    // 中断控制（不触发重渲染，用 useRef 保持可变引用）
    const abortRef = useRef<AbortController | null>(null);
    const messagesRef = useRef<MessageParam[]>([]);
    messagesRef.current = messages;

    useEffect(() => {
        engineRef.current = new QueryEngine({
            model: model,
            toolContext: toolContext,
        });
        setCurrentModel(model);
    }, [model, toolContext]);

    const interrupt = useCallback(() => {
        if (!abortRef.current?.abort()) {
            setSystemNotice({
                tone: "info",
                title: "Nothing to interrupt",
                body: "Use /exit, /quit, /bye, or Ctrl+D to exit."
            });
            return true;
        }

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
            }
            setIsLoading(!isSlashCommand);
            setSpinnerLabel("Thinking");

            if (!trimmed) {
                return { handled: false };
            }

            // if (trimmed.startsWith("/")) {
            //     return yield* this.handleCommand(trimmed);
            // }

            const userMessage: MessageParam = { role: "user", content: trimmed };
            setMessages([...messages, userMessage]);

            const abortController = new AbortController();
            abortRef.current = abortController;

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
                    // //   | { type: "permission_request"; request: PermissionRequest }
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
                            break;
                        // case "permission_request":
                        //     break;
                        case "tool_use_done":
                            setToolCalls((prev) => markToolCallComplete(
                                    prev,
                                    value.name,
                                    value.result.content.length,
                                    value.result.isError
                                ),
                            );
                            break;
                        case "assistant_message":
                            setStreamingText("");
                            break;
                        case "tool_result_message":
                            setSpinnerLabel("Thinking");
                            break;
                        case "messages_updated":
                            setMessages(value.messages);
                            break;
                        case "usage_updated":
                            setLastUsage({
                                input: value.turnUsage.input_tokens,
                                output: value.turnUsage.output_tokens,
                            })
                            break;
                        case "command":
                            setSystemNotice(buildCommandNotice(
                                value.message,
                                value.kind,
                            ));
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
            }

            return {
                handled: true
            }
        }, [onExit]);
    
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
            // permissionPromptState,
            currentModel,
        },
        actions: {
            submit,
            interrupt,
            // resolvePermission,
        }
    }
}