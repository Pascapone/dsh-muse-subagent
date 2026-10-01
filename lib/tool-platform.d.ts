import type { MuseContext, ToolConfig } from './types.js';
import z from '@deepseek-ai/schemastery';
export declare const name = "tool-subagent-muse";
export declare const inject: string[];
export declare const ORIGINAL_DESCRIPTION = "Delegate a self-contained task to a subagent (a separate agent that works in its own context) to offload focused, independent work \u2014 research, a scoped implementation, an analysis \u2014 so it does not consume this conversation's context. The subagent returns its result, not its intermediate steps. Give it a complete, standalone prompt: it does not see this conversation. This call waits for the result by default. Set `run_in_background: true` to return a job id; collect with `job_output` and stop with `job_kill`.";
export declare const ORIGINAL_PROMPT_DESCRIPTION = "The complete, self-contained task for the subagent. It does not share this conversation's context, so include everything it needs.";
export declare function toolWording(platform?: string): {
    description: string;
    promptDescription: string;
};
export declare const Config: z<Schemastery.ObjectS<NoInfer<{
    provider: z<string, string, "defined">;
    toolName: z<string, string, "defined">;
    enableRunInBackground: z<boolean, boolean, "defined">;
}>>, Schemastery.ObjectT<NoInfer<{
    provider: z<string, string, "defined">;
    toolName: z<string, string, "defined">;
    enableRunInBackground: z<boolean, boolean, "defined">;
}>>, "plain">;
export declare function apply(ctx: Pick<MuseContext, 'tools' | 'subagents' | 'get'>, config: ToolConfig): void;
