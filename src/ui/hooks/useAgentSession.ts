import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages.js";
import { QueryEngine } from "../../core/queryEngine.js";
import {
  loadPermissionSettings,
  type PermissionDecision,
  type PermissionMode,
  type PermissionRequest,
  type PermissionRuleSet,
  type PermissionSettings,
} from "../../permissions/permissions.js";
import type { ToolContext } from "../../tools/Tool.js";
import type {
  PermissionPromptState,
  SystemNotice,
  ToolCallInfo,
  UsageSummary,
} from "../types.js";

// interface 定义配置参数类型
interface UseAgentSessionOptions {
  model: string;  // AI 模型名称
  onExit: () => void;  // 退出回调
  permissionMode?: PermissionMode;  // 权限模式（可选）
}

// 返回结果类型
interface SubmitResult {
  handled: boolean;  // 命令是否被处理
}

// 更新工具调用信息，标记完成状态
function markToolCallComplete(
  toolCalls: ToolCallInfo[],  // 当前工具调用列表
  name: string,  // 要更新的工具名称
  resultLength: number,  // 结果长度
  isError?: boolean,  // 是否出错（可选）
): ToolCallInfo[] {
  // map - 类似 Python 的 list comprehension，遍历每个工具调用
  return toolCalls.map((toolCall) =>
    // 条件：名称匹配且尚未标记完成
    toolCall.name === name && toolCall.resultLength === undefined
      ? { ...toolCall, resultLength, isError }  // 合并更新后的属性
      : toolCall,  // 不匹配则保持原样
  );
}

// 构建系统通知对象，类似 Python 的 dataclass 或字典构造
function buildCommandNotice(message: string, kind: "info" | "error"): SystemNotice {
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
      ].join("\n"),  // join 类似 Python 的 "\n".join(list)
    };
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
  };
}

// 自定义 Hook：管理 AI Agent 会话状态和操作
export function useAgentSession({ model, onExit, permissionMode }: UseAgentSessionOptions) {
  // useState - 状态钩子，类似 Python 类组件的 self.state
  const [messages, setMessages] = useState<MessageParam[]>([]);  // 对话历史
  const [isLoading, setIsLoading] = useState(false);  // 加载状态
  const [spinnerLabel, setSpinnerLabel] = useState("Thinking");  // 加载动画标签
  const [streamingText, setStreamingText] = useState("");  // 流式输出文本
  const [toolCalls, setToolCalls] = useState<ToolCallInfo[]>([]);  // 工具调用记录
  const [lastUsage, setLastUsage] = useState<UsageSummary | null>(null);  // 本次 token 用量
  const [totalUsage, setTotalUsage] = useState<UsageSummary | null>(null);  // 累计 token 用量
  const [systemNotice, setSystemNotice] = useState<SystemNotice | null>(null);  // 系统通知
  const [permissionPrompt, setPermissionPrompt] = useState<PermissionPromptState | null>(null);  // 权限提示
  const [permissionSettings, setPermissionSettings] = useState<PermissionSettings | null>(null);  // 权限设置
  const [currentModel, setCurrentModel] = useState(model);  // 当前使用模型

  // useRef - 存储可变引用，不会触发组件重新渲染
  // 类似 Python 的实例变量，但不参与 UI 更新
  const permissionResolverRef = useRef<((decision: PermissionDecision) => void) | null>(null);  // 权限决策解析器
  const sessionRulesRef = useRef<PermissionRuleSet>({ allow: [], deny: [] });  // 会话权限规则
  const engineRef = useRef<QueryEngine | null>(null);  // 查询引擎实例

  // useMemo - 记忆化计算，类似 Python 的 @lru_cache
  // 仅在依赖数组为空时创建一次，后续直接返回缓存
  const toolContext = useMemo<ToolContext>(() => ({ cwd: process.cwd() }), []);

  // useEffect - 副作用钩子：加载权限设置
  // 类似 Python 的 on_mount 或初始化逻辑
  useEffect(() => {
    void loadPermissionSettings(process.cwd())  // void 丢弃 Promise
      .then(setPermissionSettings)  // 成功时设置状态
      .catch((error: unknown) => {  // 捕获错误
        setSystemNotice({
          tone: "error",
          title: "Permission settings error",
          body: error instanceof Error ? error.message : String(error),
        });
      });
  }, []);  // 空依赖 - 仅挂载时执行一次

  // useEffect - 副作用钩子：初始化/更新 QueryEngine
  // 当 model、permissionMode、permissionSettings、toolContext 变化时重新执行
  useEffect(() => {
    if (!permissionSettings) return;  // 权限设置未加载时跳过

    // 创建新的 QueryEngine 实例
    engineRef.current = new QueryEngine({
      model,
      toolContext,
      permissionMode: permissionMode ?? permissionSettings.mode,  // ?? 空值合并运算符，类似 or
      permissionSettings,
      sessionPermissionRules: sessionRulesRef.current,
      onPermissionRequest: (request: PermissionRequest) => {
        setSpinnerLabel("Waiting for permission");
        setPermissionPrompt({
          toolName: request.toolName,
          summary: request.summary,
          risk: request.risk,
          ruleHint: request.ruleHint,
        });
        // 返回 Promise - 暂停执行，等待权限决策
        return new Promise<PermissionDecision>((resolve) => {
          permissionResolverRef.current = resolve;  // 保存 resolve 函数供后续调用
        });
      },
    });
    setCurrentModel(model);
  }, [model, permissionMode, permissionSettings, toolContext]);

  // useCallback - 记忆化中断函数
  // 依赖数组中的值变化时才重新创建
  const interrupt = useCallback(() => {
    // 情况1：正在等待权限决策 - 直接拒绝并清除
    if (permissionResolverRef.current) {
      permissionResolverRef.current("deny");
      permissionResolverRef.current = null;
      setPermissionPrompt(null);
      setSystemNotice({
        tone: "info",
        title: "Permission request cancelled",
        body: "Use /exit, /quit, /bye, or Ctrl+D to exit.",
      });
      return true;
    }

    // 情况2：没有正在运行的引擎
    if (!engineRef.current?.interrupt()) {
      setSystemNotice({
        tone: "info",
        title: "Nothing to interrupt",
        body: "Use /exit, /quit, /bye, or Ctrl+D to exit.",
      });
      return true;
    }

    // 情况3：成功中断
    setIsLoading(false);
    setStreamingText("");
    setSystemNotice({
      tone: "info",
      title: "Interrupted",
      body: "Use /exit, /quit, /bye, or Ctrl+D to exit.",
    });
    return true;
  }, []);  // 无依赖，组件生命周期内使用同一引用

  // useCallback - 记忆化权限决策函数
  const resolvePermission = useCallback((decision: PermissionDecision) => {
    if (!permissionResolverRef.current) return false;
    permissionResolverRef.current(decision);  // 调用 Promise 的 resolve
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

  // useCallback - 记忆化提交函数，async 函数
  const submit = useCallback(async (text: string): Promise<SubmitResult> => {
    // 空内容不处理
    if (!text.trim()) {
      return { handled: false };
    }

    const trimmed = text.trim();
    // 处理退出命令
    if (trimmed === "/exit" || trimmed === "/quit" || trimmed === "/bye") {
      onExit();
      return { handled: true };
    }

    // 引擎未初始化
    if (!engineRef.current) {
      setSystemNotice({
        tone: "error",
        title: "QueryEngine is not ready",
        body: "Please wait for initialization to finish.",
      });
      return { handled: true };
    }

    // 是否为斜杠命令（非斜杠命令需要调用 AI）
    const isSlashCommand = trimmed.startsWith("/");

    // 重置状态
    setStreamingText("");
    setToolCalls([]);
    setSystemNotice(null);
    if (!isSlashCommand) {
      setLastUsage(null);
    }
    setPermissionPrompt(null);
    setIsLoading(!isSlashCommand);  // 非命令时显示加载状态
    setSpinnerLabel("Thinking");

    try {
      // submitMessage 返回一个生成器（generator）
      const run = engineRef.current.submitMessage(trimmed);

      // 使用 while true 循环消费生成器，类似 Python 的 for item in generator
      while (true) {
        // await run.next() 类似 Python 的 next(run)
        // { value, done } 是生成器的返回值
        const { value, done } = await run.next();
        if (done) {
          if (value.reason === "aborted") {
            setSystemNotice({
              tone: "info",
              title: "Interrupted",
              body: "Use /exit, /quit, /bye, or Ctrl+D to exit.",
            });
          }
          break;
        }

        // switch 语句 类似 Python 的 match-case（3.10+）
        switch (value.type) {
          // 文本输出 - 累加到 streamingText
          case "text":
            setStreamingText((prev) => prev + value.text);
            break;
          // 工具调用开始
          case "tool_use_start":
            setToolCalls((prev) => [...prev, { name: value.name }]);
            break;
          // 权限请求 - 显示提示，等待用户决策
          case "permission_request":
            setSpinnerLabel("Waiting for permission");
            setPermissionPrompt({
              toolName: value.request.toolName,
              summary: value.request.summary,
              risk: value.request.risk,
              ruleHint: value.request.ruleHint,
            });
            break;
          // 工具调用完成
          case "tool_use_done":
            setToolCalls((prev) =>
              markToolCallComplete(prev, value.name, value.result.content.length, value.result.isError),
            );
            break;
          // 助手消息 - 清空流式文本
          case "assistant_message":
            setStreamingText("");
            break;
          // 工具结果返回
          case "tool_result_message":
            setSpinnerLabel("Thinking");
            setPermissionPrompt(null);
            break;
          // 消息历史更新
          case "messages_updated":
            setMessages(value.messages);
            break;
          // Token 用量更新
          case "usage_updated":
            setLastUsage({
              input: value.turnUsage.input_tokens,
              output: value.turnUsage.output_tokens,
            });
            setTotalUsage({
              input: value.totalUsage.input_tokens,
              output: value.totalUsage.output_tokens,
            });
            break;
          // 命令执行结果
          case "command":
            setSystemNotice(buildCommandNotice(value.message, value.kind));
            break;
          // 模型变化
          case "model_changed":
            setCurrentModel(value.model);
            break;
          // 会话清空
          case "session_cleared":
            setMessages([]);
            setStreamingText("");
            setToolCalls([]);
            setLastUsage(null);
            break;
          // 回合完成
          case "turn_complete":
            if (value.reason === "max_turns") {
              setSystemNotice({
                tone: "error",
                title: "Maximum tool turns reached",
                body: `Reached maximum tool turns (${value.turnCount}).`,
              });
            }
            break;
          // 错误处理
          case "error":
            setSystemNotice({
              tone: "error",
              title: "Agent error",
              body: value.error.message,
            });
            break;
        }
      }
    } catch (error: unknown) {
      // 错误处理：区分 AbortError 和其他错误
      if (error instanceof Error && error.name === "AbortError") {
        setSystemNotice({
          tone: "info",
          title: "Interrupted",
          body: "Use /exit, /quit, /bye, or Ctrl+D to exit.",
        });
      } else {
        setSystemNotice({
          tone: "error",
          title: "Unhandled error",
          body: error instanceof Error ? error.message : String(error),
        });
      }
    } finally {
      // finally 类似 Python 的 try-finally，无论是否出错都会执行
      setIsLoading(false);
      permissionResolverRef.current = null;
      setPermissionPrompt(null);
    }

    return { handled: true };
  }, [onExit]);  // onExit 变化时重新创建 submit

  // 返回状态和方法给组件使用
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
    },
  };
}
