// React 是必须导入的，因为 JSX 编译后依赖 React
import React, { useState, useEffect } from 'react';
import { render, Text } from 'ink';

// 加载动画的字符帧数组，每个字符代表一帧
const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

// interface 定义"属性"的类型，类似 Python 的 TypedDict
// 用于约束组件接收哪些参数，以及参数的类型
interface SpinnerProps {
    label?: string;  // label 后面的 ? 表示这个参数是可选的
}

// export function - 这个函数可以被其他文件通过 import 导入使用
// 参数解构：{ label = "Thinking" } 等同于 props.label，默认值为 "Thinking"
// 返回类型 React.ReactNode 表示可以返回任何 React 可渲染的内容
export function Spinner({ label = "Thinking" }: SpinnerProps): React.ReactNode {
    // useState - React 的状态钩子，类似 Python 类组件中的 self.state
    // useState(0) 返回两个值：[当前值, 更新函数]
    const [frameIndex, setFrameIndex] = useState(0);

    // useEffect - 处理"副作用"的钩子
    // 副作用：除了渲染 UI 之外的操作，比如定时器、网络请求、订阅等
    useEffect(() => {
        // setInterval - 每隔一段时间执行一次回调，类似 Python 的 asyncio.set_interval
        // 第一个参数是回调函数，第二个参数是间隔时间（毫秒）
        const timer = setInterval(() => {
            // setFrameIndex 接收一个函数作为参数
            // (prev) => (prev + 1) % FRAMES.length
            // prev 是当前的 frameIndex，返回值是新的 frameIndex
            // % FRAMES.length 保证索引在 0-9 之间循环
            setFrameIndex((prev) => (prev + 1) % FRAMES.length);
        }, 80);

        // useEffect 可以返回一个"清理函数"
        // 这个函数会在组件被移除（卸载）时自动调用
        // 类似于 Python 的 __del__ 或 with 语句的 finally
        // 这里清理定时器，防止组件卸载后定时器还在运行（内存泄漏）
        return () => clearInterval(timer);
    }, []);  // 空数组表示这个 effect 没有依赖项，只在组件挂载时执行一次
             // 如果数组里有变量，那个变量变化时 effect 会重新执行

    // JSX return - 返回要渲染的内容
    // <Text dimColor> 是 Ink 的组件，类似 <div> 但用于终端
    return (
        <Text dimColor>
            {/* FRAMES[frameIndex] 根据当前帧索引获取字符 */}
            {/* {label} 渲染传入的标签文本，默认是 "Thinking" */}
            {FRAMES[frameIndex]} {label}...
        </Text>
    );
}

// render - Ink 的渲染函数，将 React 组件渲染到终端
render(<Spinner />);
