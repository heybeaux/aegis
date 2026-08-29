# @heybeaux/aegis-hook

`@heybeaux/aegis-hook` is the live Aegis runtime for tool-use governance. It ships:

- A framework-neutral hook adapter contract
- A production local-evidence predictor with persistent state
- Structured JSONL telemetry and one-shot approvals
- A Claude Code adapter plus a generic JSON/stdio adapter

The runtime always attempts prediction before `evaluate()`. Predictions can only escalate the deterministic rule floor.

## Runtime model

The package separates four responsibilities:

1. `HostAdapter.parse(stdin)` turns a host payload into an Aegis `ToolCall`
2. `predictWithPolicy(call, mode)` produces a live or fallback prediction
3. `evaluate(call, rules, { preprocess: true, prediction })` computes the rule floor plus predictive escalation
4. `HostAdapter.render(result)` maps the Aegis decision back into the host contract

The default live predictor is self-contained. It persists local evidence in `~/.aegis/predictor-state.json` and scores:

- Tool class risk (`Bash`, `Write`, `Edit`, `Delegate`, `Task`, `Read`)
- Path risk, including system directories
- Command combinator density
- Content risk markers
- Recent repeated attempts for the same exact action key
- Recent blocked-decision rate for the exact action and the local session

## Failure modes

`AEGIS_PREDICTOR_FAILURE_MODE` controls predictor/runtime fallback:

- `fail-open` (default): use a neutral fallback prediction and preserve the rule floor
- `degraded`: inject an `ask`-level fallback prediction with a clear runtime reason
- `fail-closed`: inject a `deny`-level fallback prediction with a clear runtime reason

`AEGIS_PREDICTOR_TIMEOUT_MS` bounds predictor latency. Every fallback emits JSONL telemetry.

## Files on disk

- `~/.aegis/predictor-state.json`: local evidence store
- `~/.aegis/hook-runtime.jsonl`: structured runtime telemetry
- `~/.aegis/approvals/*.json`: exact one-shot approval records

Override paths with:

- `AEGIS_HOME`
- `AEGIS_PREDICTOR_STATE_PATH`
- `AEGIS_HOOK_TELEMETRY_PATH`
- `AEGIS_APPROVAL_DIR`

Enable fail-open shadow telemetry with:

- `AEGIS_SHADOW_MODE=1`

In shadow mode, the hook still computes and logs the proposed decision, approval id, and predictor action key, but it allows the tool call to proceed. This is for production-shaped observation, not enforcement.

Current shadow-mode gaps:

- PostToolUse joins are exact only when the host supplies `toolUseId`.
- Rollback and correction chains are not directly observable from the Claude hook payload today.
- Final approval outcome receipts are not exposed by PostToolUse alone.

## Claude Code

Default CLI behavior uses the Claude Code adapter. The hook still returns:

- exit `0` to allow
- exit `2` to block or ask
- human-facing reasons on `stderr`

Install into `.claude/settings.json`:

```bash
aegis-hook install
```

Approve a pending `ask` exactly once:

```bash
aegis-hook approve <approval-id>
```

The retry must be the exact same tool call. Changed arguments, content, paths, or evaluation state do not reuse the approval.

## Generic JSON/stdio

Run the same runtime with:

```bash
aegis-hook --adapter generic-json
```

The generic adapter accepts either of these stdin payloads:

```json
{
  "toolUseId": "run_123",
  "toolCall": {
    "tool": "Write",
    "paths": ["/tmp/file.txt"],
    "content": "hello"
  }
}
```

```json
{
  "tool": "Bash",
  "command": "ls -la"
}
```

It returns a JSON object on stdout containing the rendered decision, evaluation summary, predictor metadata, and approval command when relevant.

## Programmatic API

```ts
import {
  runHook,
  claudeCodeAdapter,
  genericJsonStdioAdapter,
  predictWithPolicy,
  decide,
} from '@heybeaux/aegis-hook';
```
