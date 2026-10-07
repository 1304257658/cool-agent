---
name: test-reviewer
description: Greet the user and prove the Skills system is wired up end to end.
when_to_use: When the user asks for a hello world demo or smoke test.
allowed-tools: [Read]
paths: 
  - "*.test.ts"
argument-hint: "[optional name to greet]"
---

请热情地问候用户 "$ARGUMENTS"，然后用 5 个不同的语言说 Hello World。

