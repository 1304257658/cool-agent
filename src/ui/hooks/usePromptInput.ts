import { useCallback, useMemo, useState } from "react";
// Ink 终端 UI 框架核心组件
import { useInput } from 'ink';
import type { PermissionDecision } from "../../permissions/permissions.js";
import type { CommandSuggestion } from "../types.js";


interface UsePromptInputOptions {
    isLoading: boolean;
    hasPermissionPrompt: boolean;
    onSubmit: (text: string) => Promise<unknown> | unknown;
    onExit: () => void;
    onInterrupt: () => boolean;
    onPermissionDecision: (decision: PermissionDecision) => boolean;
}

const ALL_COMMANDS: CommandSuggestion[] = [
    { name: "/help", description: "Show available commands" },
    { name: "/clear", description: "Clear conversation history" },
    { name: "/cost", description: "Show session token usage" },
    { name: "/model", description: "Inspect current model or override it for this session" },
    { name: "/history", description: "Show saved sessions for this project" },
    { name: "/compact", description: "Compact the conversation context" },
    { name: "/exit", description: "Exit the session" },
];

export function usePromptInput({
    isLoading,
    hasPermissionPrompt,
    onSubmit,
    onExit,
    onInterrupt,
    onPermissionDecision,
}: UsePromptInputOptions) {
    const [inputValue, setInputValue] = useState("");

    const handleSubmit = useCallback(() => {
        const text = inputValue;
        setInputValue("");
        void onSubmit(text);
    }, [inputValue, onSubmit]);

    // 注册 Ink 键盘事件监听
    // 所有用户键盘输入都会经过此处理函数
    useInput((input, key) => {
        // Ctrl+C：中断当前请求
        if (key.ctrl && input === "c") {
          onInterrupt();
          return;
        }

        // Ctrl+D：退出程序
        if (key.ctrl && input === "d") {
          onExit();
          return;
        }

        if (hasPermissionPrompt) {
            const normalized = input.toLowerCase();
            if (normalized === "y") {
                onPermissionDecision("allow_once");
            } else if (normalized === "n") {
                onPermissionDecision("deny");
            } else if (normalized === "a") {
                onPermissionDecision("allow_always");
            }
            return;
        }

        // 正在加载时忽略普通输入
        if (isLoading) return;

        // 回车：提交消息
        if (key.return) {
            handleSubmit();
            return;
        }

        // 退格
        if (key.backspace || key.delete) {
            setInputValue((prev) => prev.slice(0, -1));
            return;
        }

        // 普通字符追加到输入框
        if (input && !key.ctrl && !key.meta) {
            setInputValue((prev) => prev + input);
        }

        // 左右箭头：移动输入光标
        if (key.leftArrow || key.rightArrow) {
            // 实现移动光标的逻辑
            // 这里简单地打印出当前输入框内容
            console.log(inputValue);
        }
    });

    const commandSuggestions = useMemo(() => {
        if (!inputValue.startsWith("/")) {
            return [];
        };

        const keyword = inputValue.trim().slice(1).toLowerCase();
        return ALL_COMMANDS.filter((command) => command.name.includes(keyword)).slice(0, 6);
    }, [inputValue]);

    return {
        inputValue,
        setInputValue,
        commandSuggestions,
    }
}
