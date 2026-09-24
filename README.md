# dsh-muse-subagent

A persistent DeepSeek Harness bundle that exposes an authenticated Muse Code CLI as the one-shot `subagent_muse` tool.

## What it does

- Registers a `muse` provider on `ctx.subagents`.
- Adds a dedicated static `subagent_muse` tool. Its model-facing description mentions the WSL/Windows-filesystem boundary only when the Harness host runs on Windows; Linux and macOS retain the original wording.
- Runs `muse exec --json` in the parent session's workspace.
- Uses the Harness `ctx.subprocess` service for environment scrubbing, process ownership, cancellation, and teardown. Native execution gets the full managed-range guarantee; WSL has the boundary documented below.
- Returns only Muse's authoritative final text. Raw JSONL events, stderr, tool traffic, reasoning, and workspace diffs stay out of the parent model context.
- Supports foreground and generic Harness background-job execution.

The provider intentionally advertises no optional start capabilities. Dynamic agent/model options, output schemas, personas, tool filters, and Harness depth limits are rejected instead of silently ignored. A model can be fixed in the plugin configuration.

## Runtime discovery

`runtime` controls where Muse runs:

- `auto` (default): resolve `command` natively first. On Windows only, fall back to `wsl.exe` and run `wslCommand` in the default or configured distribution.
- `native`: require a native Muse executable.
- `wsl`: require WSL and run Muse there.

On WSL, Windows workspace and temporary prompt-file paths are translated to `/mnt/<drive>/...`; a distribution is inferred from `\\wsl$`/`\\wsl.localhost` paths when needed. The Harness owns the Windows `wsl.exe` relay, while guest-process quiescence ultimately depends on WSL terminating the relayed Linux command.

## Configuration

| Field | Default | Meaning |
|---|---|---|
| `providerName` | `muse` | Registry name consumed by the tool row |
| `runtime` | `auto` | `auto`, `native`, or `wsl` |
| `command` | `muse` | Native executable name or absolute path |
| `wslExecutable` | `wsl.exe` | Windows WSL launcher |
| `wslDistribution` | default distro | Optional distribution name |
| `wslCommand` | `muse` | Muse command inside WSL |
| `provider` | Muse default | Optional Muse provider override |
| `model` | Muse default | Optional Muse model override |
| `preset` | Muse default | Optional Muse preset |
| `reasoningEffort` | Muse default | Optional Muse reasoning tier |
| `approvalMode` | `never` | Native non-interactive approval mode |
| `trustWorkspace` | `true` | Load workspace rules and skills |
| `noSessionLog` | `true` | Avoid persistent Muse session logs for one-shot runs |
| `extraArgs` | `[]` | Additional `muse exec` arguments |
| `env` | `{}` | Explicit environment overlay; WSL imports validated names with `WSLENV`, never argv |
| `disposeGraceMs` | `3000` | Harness subprocess termination grace |

The safe default keeps Muse's sandbox enabled and uses `--approval-mode never`; it does **not** pass `--yolo`, `--disable-sandbox`, or `--disable-approval`.

Example provider override:

```yaml
- id: subagent-muse
  name: '@local/dsh-muse-code'
  config:
    runtime: wsl
    wslDistribution: Ubuntu
    model: muse-spark-1.3-contributor
    reasoningEffort: high
```

## Installation

Install this directory as a bundle with the Harness Plugin Manager. The plugin deliberately activates both the provider and its dedicated `subagent_muse` tool for this Profile so the requested capability is immediately available. Muse Code must already be installed and authenticated in the selected native or WSL environment.

## Tests

```sh
pnpm test       # parser, argument, task, and path-mapping unit tests
pnpm test:real  # authenticated real-model nonce through the provider runtime
```

The real test auto-falls back from native Windows discovery to Muse inside the configured `Ubuntu` WSL distribution.

## Limitations

- One fresh Muse process and one turn per delegation; no continuation or progress stream.
- Text prompts only.
- WSL automatic path translation currently supports drive-letter paths and `\\wsl$` / `\\wsl.localhost` UNC paths.
- In WSL mode the Harness can prove termination of the Windows relay, not independently prove that every guest descendant exited; native mode is required for the full managed-range guarantee.
- Side effects completed before cancellation are not rolled back.
- `extraArgs` is deployment-owned and can weaken Muse policy; review it before use.
