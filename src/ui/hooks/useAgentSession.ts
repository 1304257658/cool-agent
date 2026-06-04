// React 是必须导入的，因为 JSX 编译后依赖 React
import React, { useState, useEffect, useRef, useCallback } from 'react';
// Ink 终端 UI 框架核心组件
import { Box, Text, useApp, useInput } from 'ink';
// 自定义加载动画组件
import { Spinner } from './../components/Spinner.js';
// Anthropic Messages API 的类型定义
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages.js";
// 本地类型定义：工具调用信息和 token 用量汇总
import type { ToolCallInfo, UsageSummary } from './../types.js';
// 流式消息 API
import { streamMessage } from '../../services/api/streaming.js';
import type { StreamResult } from '../../services/api/streaming.js';
// 消息相关类型定义
import {
    TextBlock,
    ContentBlock,
    ToolResultBlock,
    Usage,
    StreamEvent,
    AssistantMessage,
} from '../../types/message.js';
// 工具系统：工具上下文类型定义
import type { ToolContext } from "../../tools/Tool.js";
import { getAllTools, findToolByName, getToolsApiParams } from '../../tools/index.js';
import type { AgenticLoopEvent } from '../../core/agenticLoop.js';
import { DebugView } from './../components/DebugView.js';
import { query } from '../../core/agenticLoop.js';


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

export function useAgentSession({
    model,
    onExit,
}: UseAgentSessionOptions) {
    
    // 对话数据
    const [messages, setMessages] = useState<MessageParam[]>([]);  // 完整的消息历史
    const [inputValue, setInputValue] = useState("");  // 当前输入框文本

    // UI 状态
    const [isLoading, setIsLoading] = useState(false);  // 是否正在请求 API
    const [spinnerLabel, setSpinnerLabel] = useState("Thinking");  // 加载动画文本
    const [streamingText, setStreamingText] = useState("");  // 流式输出的增量文本
    const [toolCalls, setToolCalls] = useState<ToolCallInfo[]>([]);  // 当前工具调用列表
    const [lastUsage, setLastUsage] = useState<UsageSummary | null>(null);  // 上一轮的 token 用量
    const [totalUsage, setTotalUsage] = useState<UsageSummary | null>(null);  // 累计 token 用量
    // const [systemNotice, setSystemNotice] = useState<SystemNotice | null>(null);  // 系统通知
    const [infoMessage, setInfoMessage] = useState<String | null>(null);  // 提示信息（如 /clear 的结果）
    const [errorText, setErrorText] = useState<String | null>(null);  // 错误信息


    const [currentModel, setCurrentModel] = useState(model);


    // 中断控制（不触发重渲染，用 useRef 保持可变引用）
    const abortRef = useRef<AbortController | null>(null);
    const messagesRef = useRef<MessageParam[]>([]);
    messagesRef.current = messages;

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
            if (trimmed === "/clear") {
                setMessages([]);
                messagesRef.current = [];
                setInfoMessage("Conversation cleared.");
                return {
                    handled: true
                };
            }
            if (trimmed === "/history") {
                setInfoMessage(`${messagesRef.current.length} messages in conversation.`);
                return {
                    handled: true
                };
            }

            const isSlashCommand = trimmed.startsWith("/");

            // 重置 UI 状态
            setStreamingText("");
            setToolCalls([]);
            // setSystemNotice(null);
            if (!isSlashCommand) {
                setLastUsage(null);
            }
            setIsLoading(true);
            setSpinnerLabel("Thinking");

            try {
                const run = await query(trimmed);
            }

            // 追加 user message，创建本轮消息数组
            const userMsg: MessageParam = { role: "user", content: trimmed };
            let loopMessages = [...messagesRef.current, userMsg];
            setMessages(loopMessages);
            messagesRef.current = loopMessages;

            const abort = new AbortController();
            abortRef.current = abort;

            let totalIn = 0;
            let totalOut = 0;
            
        },
        [onExit]
    );
}