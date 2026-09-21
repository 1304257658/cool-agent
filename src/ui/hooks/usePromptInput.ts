import { useCallback, useMemo, useState } from "react";
// Ink 终端 UI 框架核心组件
import { useInput } from 'ink';
import type { PermissionDecision, PermissionMode } from "../../permissions/permissions.js";
import type { TaskMode } from "../../state/taskModeStore.js";
import type { CommandSuggestion } from "../types.js";


export interface ModeSuggestion {
    key: string;
    mode: PermissionMode;
    description: string;
    isCurrent: boolean;
    isSelected: boolean;
}

export interface TaskModeSuggestion {
    key: string;
    mode: TaskMode;
    description: string;
    isCurrent: boolean;
    isSelected: boolean;
}

interface UsePromptInputOptions {
    isLoading: boolean;
    hasPermissionPrompt: boolean;
    isPlanExitPrompt: boolean;
    permissionMode: string;
    taskMode: TaskMode;
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
    { name: "/mode", description: "Inspect or switch permission mode (default/plan/auto)" },
    { name: "/tasks", description: "Switch task tracking system (task=persistent V2, todo=session V1)" },
    { name: "/history", description: "Show saved sessions for this project" },
    { name: "/compact", description: "Compact the conversation context" },
    { name: "/exit", description: "Exit the session" },
];

const MODE_OPTIONS: { mode: PermissionMode; description: string }[] = [
    { mode: "default", description: "Confirm destructive operations" },
    { mode: "plan", description: "Read-only exploration, then plan" },
    { mode: "auto", description: "Auto-approve all operations" },
];

const TASK_MODE_OPTIONS: { mode: TaskMode; description: string }[] = [
    { mode: "task", description: "Persistent task graph (Task V2) — default" },
    { mode: "todo", description: "Session-memory todo list (TodoWrite V1)" },
];

export function usePromptInput(
    params: UsePromptInputOptions
) {
    const [inputValue, setInputValue] = useState("");
    const [selectedCommandIndex, setSelectedCommandIndex] = useState(-1);
    const [selectedModeIndex, setSelectedModeIndex] = useState(-1);
    const [selectedTaskModeIndex, setSelectedTaskModeIndex] = useState(-1);

    const handleSubmit = useCallback(() => {
        const text = inputValue;
        setInputValue("");
        void params.onSubmit(text);
    }, [inputValue, params.onSubmit]);

    // 注册 Ink 键盘事件监听
    // 所有用户键盘输入都会经过此处理函数
    useInput((input, key) => {
        // Ctrl+C：中断当前请求
        if (key.ctrl && input === "c") {
          params.onInterrupt();
          return;
        }

        // Ctrl+D：退出程序
        if (key.ctrl && input === "d") {
          params.onExit();
          return;
        }

        if (params.hasPermissionPrompt) {
            const normalized = input.toLowerCase();
            if (params.isPlanExitPrompt) {
                if (normalized === "y") {
                    params.onPermissionDecision("allow_clear_context");
                } else if (normalized === "k") {
                    params.onPermissionDecision("allow_once");
                } else if (normalized === "n") {
                    params.onPermissionDecision("deny");
                }
            } else {
                if (normalized === "y") {
                    params.onPermissionDecision("allow_once");
                } else if (normalized === "n") {
                    params.onPermissionDecision("deny");
                } else if (normalized === "a") {
                    params.onPermissionDecision("allow_always");
                }
            }
            return;
        }

        // 正在加载时忽略普通输入
        if (params.isLoading) return;

        // Command suggestions: arrow keys + Enter/Tab to select
        if (showCommandSuggestions) {
            if (key.upArrow) {
                setSelectedCommandIndex((prev) => (prev <= 0 ? filteredCommands.length - 1 : prev - 1));
                return;
            }
            if (key.downArrow) {
                setSelectedCommandIndex((prev) => (prev >= filteredCommands.length - 1 ? 0 : prev + 1));
                return;
            }
            if ((key.return || key.tab) && selectedCommandIndex >= 0) {
                const selected = filteredCommands[selectedCommandIndex];
                if (selected) {
                    setInputValue(selected.name + " ");
                    setSelectedCommandIndex(-1);
                    return;
                }
            }
        }

        // Mode selector: arrow keys + Enter + number shortcuts
        if (showModeSelector) {
            if (key.upArrow) {
                setSelectedModeIndex((prev) => (prev <= 0 ? MODE_OPTIONS.length - 1 : prev - 1));
                return;
            }
            if (key.downArrow) {
                setSelectedModeIndex((prev) => (prev >= MODE_OPTIONS.length - 1 ? 0 : prev + 1));
                return;
            }
            if (key.return && selectedModeIndex >= 0) {
                const selected = MODE_OPTIONS[selectedModeIndex];
                if (selected) {
                    setInputValue("");
                    setSelectedModeIndex(-1);
                    void params.onSubmit(`/mode ${selected.mode}`);
                    return;
                }
            }
            if (input === "1" || input === "2" || input === "3") {
                const idx = Number(input) - 1;
                const selected = MODE_OPTIONS[idx];
                if (selected) {
                    setInputValue("");
                    setSelectedModeIndex(-1);
                    void params.onSubmit(`/mode ${selected.mode}`);
                    return;
                }
            }
        }

        
        // Task-system selector: same UX as the permission-mode one, just two
        // options. Typing `1` or `2` submits directly so the user can flip
        // systems in two keystrokes (`/tasks` → `1`).
        if (showTaskModeSelector) {
            if (key.upArrow) {
                setSelectedTaskModeIndex((prev) => (prev <= 0 ? TASK_MODE_OPTIONS.length - 1 : prev - 1));
                return;
            }
            if (key.downArrow) {
                setSelectedTaskModeIndex((prev) => (prev >= TASK_MODE_OPTIONS.length - 1 ? 0 : prev + 1));
                return;
            }
            if (key.return && selectedTaskModeIndex >= 0) {
                const selected = TASK_MODE_OPTIONS[selectedTaskModeIndex];
                if (selected) {
                    setInputValue("");
                    setSelectedTaskModeIndex(-1);
                    void params.onSubmit(`/tasks ${selected.mode}`);
                    return;
                }
            }
            if (input === "1" || input === "2") {
                const idx = Number(input) - 1;
                const selected = TASK_MODE_OPTIONS[idx];
                if (selected) {
                    setInputValue("");
                    setSelectedTaskModeIndex(-1);
                    void params.onSubmit(`/tasks ${selected.mode}`);
                    return;
                }
            }
        }

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

    const showModeSelector = useMemo(() => {
        const trimmed = inputValue.trim().toLowerCase();
        const show = trimmed === "/mode" || trimmed === "/mode ";
        if (!show) {
            setSelectedModeIndex(-1);
        }
        return show;
    }, [inputValue]);

    const showTaskModeSelector = useMemo(() => {
        const trimmed = inputValue.trim().toLowerCase();
        const show = trimmed === "/tasks" || trimmed === "/tasks ";
        if (!show) {
            setSelectedTaskModeIndex(-1);
        }
        return show;
    }, [inputValue]);

    const filteredCommands = useMemo(() => {
        if (!inputValue.startsWith("/")) {
            return [];
        }
        const keyword = inputValue.trim().toLowerCase();
        return ALL_COMMANDS.filter((item) => item.name.startsWith(keyword)).slice(0, 6);
    }, [inputValue]);

      const showCommandSuggestions = filteredCommands.length > 0 && !showModeSelector && !showTaskModeSelector;

    const commandSuggestions: CommandSuggestion[] = useMemo(() => {
        if (!showCommandSuggestions) {
            setSelectedCommandIndex(-1);
            return [];
        }
        return filteredCommands.map((item, i) => ({
            ...item,
            isSelected: i === selectedCommandIndex,
        }));
    }, [showCommandSuggestions, filteredCommands, selectedCommandIndex]);

    const modeSuggestions: ModeSuggestion[] = useMemo(() => {
        if (!showModeSelector) return [];
        return MODE_OPTIONS.map((opt, i) => ({
            key: String(i + 1),
            mode: opt.mode,
            description: opt.description,
            isCurrent: opt.mode === params.permissionMode,
            isSelected: i === selectedModeIndex,
        }));
    }, [showModeSelector, params.permissionMode, selectedModeIndex]);

    const taskModeSuggestions: TaskModeSuggestion[] = useMemo(() => {
        if (!showTaskModeSelector) return [];
        return TASK_MODE_OPTIONS.map((opt, i) => ({
            key: String(i + 1),
            mode: opt.mode,
            description: opt.description,
            isCurrent: opt.mode === params.taskMode,
            isSelected: i === selectedTaskModeIndex,
        }));
    }, [showTaskModeSelector, params.taskMode, selectedTaskModeIndex]);

    return {
        inputValue,
        setInputValue,
        commandSuggestions,
        modeSuggestions,
        taskModeSuggestions,
    };
}
