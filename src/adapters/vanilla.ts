import { registerSwaggerTools } from '../lib/registry.js';
import type { SwaggerToolsOptions, SwaggerToolsResult } from '../lib/types.js';

export function setupSwaggerTools(
  options: SwaggerToolsOptions
): Promise<SwaggerToolsResult> {
  return registerSwaggerTools(options);
}

export type { SwaggerToolsOptions, SwaggerToolsResult };
