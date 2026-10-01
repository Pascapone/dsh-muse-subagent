# dsh-muse-subagent

A persistent DeepSeek Harness bundle that exposes an authenticated Muse Code CLI as the one-shot `subagent_muse` tool.

## What it does

- Registers a `muse` provider on `ctx.subagents`.
- Adds a dedicated static `subagent_muse` tool. Its model-facing description mentions the WSL/Windows-filesystem boundary only when the Harness host runs on Windows.
- Runs `muse exec --json` in the parent session's workspace, applying the caller's DSH file policy at each delegation. Restricted calls run with Muse's WSL sandbox; full-access calls run unrestricted unless `sandboxed: true`.
- Uses the Harness `ctx.subprocess` service for environment scrubbing, process ownership, cancellation, and teardown. Native execution gets the full managed-range guarantee; WSL has the boundary documented below.
- For each run, forwards the parent Session's `DSH_SESSION_ID` (including through `WSLENV`) so repository-local Git hooks can attribute worktrees. This is advisory provenance, not a security boundary; a child process can change its own environment.
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
| `approvalMode` | `never` | Required on sandboxed workspace-write calls; unrestricted and read-only use their own profile flags |
| `trustWorkspace` | `true` | Load workspace rules and skills |
| `noSessionLog` | `true` | Avoid persistent Muse session logs for one-shot runs |
| `extraArgs` | `[]` | Additional `muse exec` arguments |
| `env` | `{}` | Explicit environment overlay; WSL imports validated names with `WSLENV`, never argv |
| `disposeGraceMs` | `3000` | Harness subprocess termination grace |

The caller's **effective DSH file policy**, not the approval setting, selects Muse's launch mode:

| DSH file policy | Muse launch | Workspace |
|---|---|---|
| `workspace-write` | sandbox on, `--approval-mode never` | caller's session workspace |
| `read-only` | `:read-only` permission profile, shell/write tools off | caller's session workspace |
| `danger-full-access` | `--yolo` (unrestricted) | caller's session workspace by default |

The optional `sandboxed: true` tool argument constrains a full-access caller to Muse's workspace-write sandbox. A restricted caller cannot disable the sandbox. Only full-access callers may pass an absolute `workspace` path to select another checkout; the selected directory becomes the Muse workspace and working directory. For example, two separate delegations may target `C:\\Users\\pasca\\Coding\\CC-Assets-1` and `C:\\Users\\pasca\\Coding\\CC-Assets-2`. Background calls use the same policy checks at start. `approvalMode` must remain `never` for sandboxed workspace-write calls, and `extraArgs` must be empty for *all* sandboxed calls to prevent configured CLI overrides.

WSL confinement is Muse's own sandbox, not an exact reproduction of DSH's Windows sandbox. Muse's personal configuration, hooks, and external MCP tools must be trusted separately; the Muse shell sandbox cannot confine them. Read-only calls do not load workspace rules. Setting `--approval-mode never` does not disable Muse's shell sandbox.

Example provider override:

```yaml
- id: subagent-muse
  name: '@pascapone/dsh-muse-code'
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
pnpm install --frozen-lockfile --ignore-scripts
pnpm run check  # strict types, build, unchanged offline tests and boundary checks
pnpm test:real  # separate authenticated real-model nonce; never part of check
```

Runtime, tools and tests are TypeScript. `tsc` emits runtime JavaScript and declarations under `lib`; tests, including the real-test helper, run from `.test-build` as JavaScript, so Node 20 does not need native TypeScript support. Published DSH peer packages may require a newer Node runtime than this plugin's own Node ≥20 baseline. No install hook builds the plugin or invokes Muse. Offline migration checks pass 11/11 (nine original cases and two added boundary/disposal checks); this is not a real Muse/WSL acceptance.

The real test auto-falls back from native Windows discovery to Muse inside the configured `Ubuntu` WSL distribution.

## Limitations

- One fresh Muse process and one turn per delegation; no continuation or progress stream.
- Text prompts only.
- WSL automatic path translation currently supports drive-letter paths and `\\wsl$` / `\\wsl.localhost` UNC paths.
- In WSL mode the Harness can prove termination of the Windows relay, not independently prove that every guest descendant exited; native mode is required for the full managed-range guarantee.
- Side effects completed before cancellation are not rolled back.
- `extraArgs` is deployment-owned, only used for unrestricted runs, and can weaken Muse policy; review it before use.
