import { useInput, useApp } from "ink";

function MyComponent() {
  const { exit } = useApp();

  useInput((input, key) => {
    if (input === "q") exit();              // 按 q 退出
    if (key.return) handleSubmit();         // 回车提交
    if (key.ctrl && input === "c") abort(); // Ctrl+C 中断
    if (key.backspace) deleteLast();        // 退格删字
    if (key.upArrow) scrollUp();            // 方向键
  });
}

render(<MyComponent />);