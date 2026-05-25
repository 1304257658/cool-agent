// React 是必须导入的，因为 JSX 编译后依赖 React
import React, { useState, useEffect, useRef } from 'react';
import { render, Text, useApp, useInput } from 'ink';
import Spinner from './Spinner.js';


export function App({ model, system }: AppProps): React.ReactNode {
    const { exit } = useApp();

    const [messages, setMessages] = useState<MessageParam[]>([]);
    const [inputValue, setInputValue] = useState("");

    const [isLoading, setIsloading] = useState(false);
    const [spinnerLabel, setSpinnerLabel] = useState("Thinking");
    const [streamingText, setStreamingText] = useState("");
    const [toolCalls, setToolCalls] = useState<ToolCallInfo[]>([]);
    const [lastUsage, setLastUsage] = useState<{ input: Number; output: number } | null>(null);
    const [infoMessage, setInfoMessage] = useState<String | null>(null);
    const [errorText, setErrorText] = useState<String | null>(null);

    const abortRef = useRef<AbortController | null>(null);
    const messagesRef = useRef<MessageParam[]>([]);
    messagesRef.current = messages;
    
}