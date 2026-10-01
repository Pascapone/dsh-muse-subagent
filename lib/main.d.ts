import type { MuseContext, MuseConfig } from './types.js';
import z from '@deepseek-ai/schemastery';
export declare const name = "subagent-muse";
export declare const inject: string[];
export declare const Config: z<Partial<MuseConfig>>;
export declare function apply(ctx: MuseContext, config: Partial<MuseConfig>): void;
