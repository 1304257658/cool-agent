import type { MessageParam } from "@anthropic-ai/sdk/resources/messages.js";
import {
  query,
  type AgenticLoopEvent,
  type LoopTerminationReason,
} from "./agenticLoop.js";
import {
  type PermissionDecision,
  type PermissionMode,
  type PermissionRequest,
  type PermissionRuleSet,
  type PermissionSettings,
} from "../permissions/permissions.js";
import type { ToolContext } from "../tools/Tool.js";
import type { Usage } from "../types/message.js";

import { buildSystemPrompt, renderSystemPrompt } from "../context/systemPrompt.js";
import { getToolsApiParams } from "../tools/index.js";
import { formatProjectSessionHistory } from "../session/history.js";

export type QueryEngineEvent = 
    | AgenticLoopEvent
    | {
        type: "messages_updated";
        messages: MessageParam[];
    }
    | {
        type: "usage_updated";
        totalUsage: Usage;
        turnUsage: Usage;
    }
    | {
        type: "command";
        message: string;
        kind: "info" | "error";
    }
    | {
        type: "model_changed";
        model: string;
        source: "default" | "session";
    }
    | {
        type: "session_cleared";
    };


export interface QueryEngineOptions {
    model: string;
    toolContext: ToolContext;
    permissionMode?: PermissionMode;
    permissionSettings?: PermissionSettings;
    sessionPermissionRules?: PermissionRuleSet;
    onPermissionRequest?: (request: PermissionRequest) => Promise<PermissionDecision>;
    initialMessages?: MessageParam[];
    initialUsage?: Usage;
}

export interface QueryEngineState {
    messages: MessageParam[];
    totalUsage: Usage;
    model: string;
    modelSource: "default" | "session";
}


function createEmptyUsage(): Usage {
    return {
        input_tokens: 0,
        output_tokens: 0,
    }
}


export class QueryEngine {
    private messages: MessageParam[];
    private totalUsage: Usage;
    private readonly defaultModel: string;
    private sessionModelOverride: string | null = null;
    private readonly toolContext: ToolContext;
    private readonly permissionMode?: PermissionMode;
    private readonly permissionSettings?: PermissionSettings;
    private readonly sessionPermissionRules?: PermissionRuleSet;
    private readonly onPermissionRequest?: (request: PermissionRequest) => Promise<PermissionDecision>;
    private abortController: AbortController | null = null;

    constructor(options: QueryEngineOptions) {
        this.defaultModel = options.model;
        this.toolContext = options.toolContext;
        this.permissionMode = options.permissionMode;
        this.permissionSettings = options.permissionSettings;
        this.sessionPermissionRules = options.sessionPermissionRules;
        this.onPermissionRequest = options.onPermissionRequest;
        this.messages = [...(options.initialMessages ?? [])];
        this.totalUsage = {...options.initialUsage ?? createEmptyUsage()};
    }

    private getActiveModel(): string {
        return this.sessionModelOverride ?? this.defaultModel;
    }

    private getModelSource(): "default" | "session" {
        return this.sessionModelOverride ? "session" : "default";
    }

    getState(): QueryEngineState {
        return {
            messages: [...this.messages],
            totalUsage: {...this.totalUsage},
            model: this.getActiveModel(),
            modelSource: this.getModelSource(),
        }
    }

    interrupt(): boolean {
        if (!this.abortController) {
            return false;
        }
        this.abortController.abort();
        this.abortController = null;
        return true;
    }

    private async *handleCommand(command: string): AsyncGenerator<QueryEngineEvent, {
        handled: boolean;
    }> {
        const [name, ...args] = command.slice(1).split(/\s+/).filter(Boolean);

        switch (name) {
            case "help":
                yield {
                    type: "command",
                    kind: "info",
                    message: "Commands: /help, /clear, /cost, /model [name|default] /history /exit /quit /bye",
                };
                return {
                    handled: true,
                };
            case "clear":
                this.messages = [];
                yield {
                    type: "session_cleared",
                };
                yield {
                    type: "messages_updated",
                    messages: [],
                };
                yield {
                    type: "command",
                    kind: "info",
                    message: "Conversation cleared.",
                };
                return {
                    handled: true,
                };
            case "cost":
                yield {
                    type: "command",
                    kind: "info",
                    message: [
                        "Session usage",
                        `- Input tokens: ${this.totalUsage.input_tokens}`,
                        `- Output tokens: ${this.totalUsage.output_tokens}`,
                        `- Total tokens: ${this.totalUsage.input_tokens + this.totalUsage.output_tokens}`
                    ].join("\n"),
                }
                return {
                    handled: true,
                };
            case "model":
                const nextModel = args.join(" ").trim();

                if (!nextModel) {
                    yield {
                        type: "command",
                        kind: "info",
                        message: [
                            "Model status",
                            `- Active model: ${this.getActiveModel()}`,
                            `- Default model: ${this.defaultModel}`,
                            this.sessionModelOverride
                             ? `- Session override: ${this.sessionModelOverride}`
                             : "- Session override: none",
                            "- Usage: /model <name> to override for this session",
                            "- Usage: /model default to clear the override",
                        ].join("\n"),
                    }
                    return {
                        handled: true,
                    };
                }

                if (nextModel === "default") {
                    this.sessionModelOverride = null;
                    const activeModel = this.getActiveModel();
                    yield {
                        type: "model_changed",
                        model: activeModel,
                        source: "default",
                    };
                    yield {
                        type: "command",
                        kind: "info",
                        message: [
                            "Model updated",
                            `- Active model: ${activeModel}`,
                            "- Source: default",
                            "- Session override: cleared",
                        ].join("\n"),
                    }
                    return {
                        handled: true,
                    };
                }

                this.sessionModelOverride = nextModel;
                yield {
                    type: "model_changed",
                    model: nextModel,
                    source: "session",
                };
                yield {
                    type: "command",
                    kind: "info",
                    message: [
                        "Model updated",
                        `- Active model: ${nextModel}`,
                        "- Source: session",
                        `- Default model remains: ${this.defaultModel}`,
                    ].join("\n"),
                };

                return {
                    handled: true
                };
            case "history":
                yield {
                    type: "command",
                    kind: "info",
                    message: await formatProjectSessionHistory(this.toolContext.cwd),
                };
                return {
                    handled: true,
                };
            default:
                yield {
                    type: "command",
                    kind: "error",
                    message: `Unknown command: /${name}. Try /help.`,
                }
                return {
                    handled: true,
                };
        }
    }

    async *submitMessage(
        input: string,
    ): AsyncGenerator<QueryEngineEvent, {
        handled: boolean;
        reason?: LoopTerminationReason
    }> {
        const trimmed = input.trim();
        if (!trimmed) {
            return {
                handled: false
            };
        }

        if (trimmed.startsWith("/")) {
            return yield* this.handleCommand(trimmed);
        }

        const userMessage: MessageParam = {
            role: "user",
            content: trimmed,
        };
        this.messages = [...this.messages, userMessage];
        yield {
            type: "messages_updated",
            messages: [...this.messages],
        };

        const abortController = new AbortController();
        this.abortController = abortController;

        try {
            const systemParts = await buildSystemPrompt({
                cwd: this.toolContext.cwd,
            });
            const systemPrompt = renderSystemPrompt(systemParts);
            const tools = getToolsApiParams();

            const loop = query({
                messages: [...this.messages],
                systemPrompt: systemPrompt,
                tools: tools,
                model: this.getActiveModel(),
                abortSignal: abortController.signal,
                toolContext: {
                    ...this.toolContext,
                    abortSignal: abortController.signal,
                },
                sessionPermissionRules: this.sessionPermissionRules,
                onPermissionRequest: this.onPermissionRequest,
            });

            while (true) {
                const { value, done } = await loop.next();
                if (done) {
                    this.messages = [...value.state.messages];
                    this.totalUsage = {
                        input_tokens: this.totalUsage.input_tokens + value.usage.input_tokens,
                        output_tokens: this.totalUsage.output_tokens + value.usage.output_tokens,
                    };
                    yield {
                        type: "messages_updated",
                        messages: [...this.messages],
                    };
                    yield {
                        type: "usage_updated",
                        totalUsage: { ...this.totalUsage },
                        turnUsage: { ...value.usage },
                    };
                    return {
                        handled: true,
                        reason: value.reason,
                    };
                }
                yield value;

                switch (value.type) {
                    case "assistant_message":
                    case "tool_result_message":
                        this.messages = [
                            ...this.messages,
                            value.message
                        ];
                        yield {
                            type: "messages_updated",
                            messages: [...this.messages],
                        };
                        break;
                    default:
                        break;
                }
            }
        } finally {
            this.abortController = null;
        }
    }
}
