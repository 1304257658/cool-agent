import React, { useState } from 'react';
import { render, Box, Text, useInput, useApp } from 'ink';


function Counter() {
    // useState<number> - 泛型指定状态类型，不写则自动推断
    const [count, setCount] = useState<number>(0);

    // useApp() - Ink 提供，获取应用级 API（如退出）
    const { exit } = useApp();

    // useInput - 监听键盘输入，回调接收输入字符和按键信息
    useInput((input, key) => {
        if (input === "q") exit();  // 输入 q 退出应用
        if (key.return) setCount((c) => c + 1);  // 回车键递增计数
    });

    return (
        <Box>
            <Text>Count: </Text>
            <Text color="green" bold>{count}</Text>
        </Box>
    );
}

// render - Ink 渲染函数，将 React 组件渲染到终端
render(<Counter />);