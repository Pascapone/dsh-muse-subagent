import type { Readable } from 'node:stream';
import type { SubagentRun } from '@deepseek-ai/dsh-subagent';
import type { Attribution, ExecConfig, InvocationConfig, RunConfig, OutputState, MuseRequest, RunContext, ResolveContext } from './types.js';
export declare function textTask(prompt: unknown): string;
export declare function windowsPathToWslDetails(path: string, distribution?: string): {
    path: string;
    distribution: string | undefined;
};
export declare function windowsPathToWsl(path: string, distribution?: string): string;
export declare function createOutputState(): OutputState;
export declare function applyMuseJsonLine(line: string, state: OutputState): void;
export declare function consumeMuseJson(stream: Readable, state: OutputState): Promise<void>;
export declare function museExecArguments(config: ExecConfig, workspace: string, promptFile: string, mode: string): string[];
export declare function museRunEnvironment(configEnv: Record<string, string> | undefined, request?: Attribution): {
    [x: string]: string;
};
export declare function resolveInvocation(ctx: ResolveContext, config: InvocationConfig, cwd: string, promptFile: string, signal: AbortSignal, mode: string, request?: Attribution): Promise<{
    argv: string[];
    env: Record<string, string>;
}>;
export declare function startMuseRun(ctx: RunContext, request: MuseRequest, config: RunConfig, cwd: string, mode: string): Promise<SubagentRun>;
