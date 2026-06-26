# Claude Console Retry

Run Claude Code through a monitored console wrapper. It keeps the console interactive, records output, and restarts Claude when the output contains `429`, `rate limit`, `Too Many Requests`, or `Service Unavailable`.

## Use

```bash
/Users/leisureman/project/tools/burningTool/plugins/claude-console-retry/scripts/claude-retry-console
```

## Options

```bash
CLAUDE_RETRY_CMD='claude --debug' \
CLAUDE_RETRY_INITIAL_DELAY=60 \
CLAUDE_RETRY_MAX_DELAY=300 \
/Users/leisureman/project/tools/burningTool/plugins/claude-console-retry/scripts/claude-retry-console
```

Logs are saved under `~/.claude-retry-console`.
