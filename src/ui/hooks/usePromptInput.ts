import { useCallback, useMemo, useState } from "react";
import { useInput } from "ink";
import type { PermissionDecision } from "../../permissions/permissions.js";
import type { CommandSuggestion } from "../types.js";

// interface 定义这个 hook 接收的参数类型
// 类似 Python 的 TypedDict 或 dataclass，但更灵活
interface UsePromptInputOptions {
  isLoading: boolean;  // 当前是否在加载中
  hasPermissionPrompt: boolean;  // 是否显示权限确认提示
  onSubmit: (text: string) => Promise<unknown> | unknown;  // 提交回调，参数是字符串，返回 Promise 或普通值
  onExit: () => void;  // 退出回调，() => void 表示不接受参数且无返回值
  onInterrupt: () => boolean;  // 中断回调，返回 boolean
  onPermissionDecision: (decision: PermissionDecision) => boolean;  // 权限决策回调
}

// 命令提示列表，类似 Python 的 list[dict]，但带类型定义
const ALL_COMMANDS: CommandSuggestion[] = [
  { name: "/help", description: "Show available commands" },
  { name: "/clear", description: "Clear conversation history" },
  { name: "/cost", description: "Show session token usage" },
  { name: "/model", description: "Inspect current model or override it for this session" },
  { name: "/history", description: "Show message count" },
  { name: "/exit", description: "Exit the session" },
];

// 自定义 React Hook - 类似 Python 的装饰器模式或类 Mixin
// Hook 以 "use" 开头，这是 React 的约定
export function usePromptInput({
  isLoading,
  hasPermissionPrompt,
  onSubmit,
  onExit,
  onInterrupt,
  onPermissionDecision,
}: UsePromptInputOptions) {
  // useState("") - 初始值为空字符串，存储用户输入
  const [inputValue, setInputValue] = useState("");

  // useCallback - 记忆化回调，类似 Python 的 @lru_cache 装饰器
  // 第二个参数 [inputValue, onSubmit] 是依赖数组
  // 当这些值变化时，才会重新创建新的 handleSubmit 函数
  // 否则返回缓存的旧函数引用，用于避免子组件不必要的重新渲染
  const handleSubmit = useCallback(() => {
    const text = inputValue;
    setInputValue("");  // 提交后清空输入框
    void onSubmit(text);  // void 运算符：显式丢弃 Promise 返回值，仅执行副作用
  }, [inputValue, onSubmit]);

  // useInput - Ink 钩子，监听键盘输入
  useInput((input, key) => {
    // Ctrl+C - 中断当前操作
    if (key.ctrl && input === "c") {
      onInterrupt();
      return;
    }
    // Ctrl+D - 退出程序
    if (key.ctrl && input === "d") {
      onExit();
      return;
    }

    // 权限确认提示模式：监听 y/n/a 按键
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

    // 加载中时不处理其他输入
    if (isLoading) return;

    // 回车 - 提交表单
    if (key.return) {
      handleSubmit();
      return;
    }
    // 退格/删除 - 删除最后一个字符
    if (key.backspace || key.delete) {
      // prev.slice(0, -1) 类似 Python 的 prev[:-1]，取除了最后一个字符外的所有字符
      setInputValue((prev) => prev.slice(0, -1));
      return;
    }
    // 普通字符输入（排除 Ctrl/Meta 组合键）
    if (input && !key.ctrl && !key.meta) {
      setInputValue((prev) => prev + input);
    }
  });

  // useMemo - 记忆化计算，类似 Python 的 @lru_cache
  // 只有 inputValue 变化时才重新计算，否则返回缓存结果
  // 用于根据用户输入过滤匹配的命令提示
  const commandSuggestions = useMemo(() => {
    // 用户输入不是以 / 开头，不显示命令提示
    if (!inputValue.startsWith("/")) {
      return [];
    }

    // trim().toLowerCase() 类似 Python 的 strip().lower()
    const keyword = inputValue.trim().toLowerCase();
    // filter + startsWith 类似 Python 的 [x for x in items if x.name.startswith(keyword)]
    // slice(0, 6) 类似 Python 的 [:6]，限制最多显示 6 条
    return ALL_COMMANDS.filter((item) => item.name.startsWith(keyword)).slice(0, 6);
  }, [inputValue]);

  // 返回值 - 类似 Python 函数返回 dict，供组件使用
  return {
    inputValue,  // 当前输入框内容
    setInputValue,  // 手动设置输入值的函数
    commandSuggestions,  // 匹配的命令提示列表
  };
}
