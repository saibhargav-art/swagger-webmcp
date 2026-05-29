import type {
  AuthConfig,
  EnricherConfig,
  SwaggerToolsOptions,
  SwaggerToolsResult,
  WebMCPToolDefinition,
  MCPToolWithExecute,
  ToolRegistrationDiagnostics,
} from './types.js';
import { parseSpec } from './parser.js';
import { transformSpec } from './transformer.js';

const _registeredTools = new Map<string, WebMCPToolDefinition>();
let _activeScope: string | null = null;
let _lastDiagnostics: ToolRegistrationDiagnostics | undefined;

/**
 * Create a deterministic fingerprint of scope identity including filter options.
 * This prevents stale scope issues when authorization/filter inputs change.
 */
function createScopeFingerprint(
  scopeKey: string,
  options?: Pick<SwaggerToolsOptions, 'allowedScopes' | 'requiredRoles' | 'scopeMode' | 'roleMode' | 'scopeRegistrationMode' | 'secureMode'>
): string {
  const parts = [scopeKey];

  if (options?.allowedScopes?.length) {
    parts.push(`scopes:${options.allowedScopes.sort().join(',')}`);
  }

  if (options?.requiredRoles?.length) {
    parts.push(`roles:${options.requiredRoles.sort().join(',')}`);
  }

  if (options?.scopeMode) {
    parts.push(`scopeMode:${options.scopeMode}`);
  }

  if (options?.roleMode) {
    parts.push(`roleMode:${options.roleMode}`);
  }

  if (options?.scopeRegistrationMode) {
    parts.push(`scopeRegistrationMode:${options.scopeRegistrationMode}`);
  }

  if (options?.secureMode) {
    parts.push(`secure:${options.secureMode}`);
  }

  return parts.join('|');
}

function injectJsonLdFallback(tools: WebMCPToolDefinition[]): void {
  if (typeof document === 'undefined') return;

  const existingScript = document.querySelector('script[data-swagger-webmcp-jsonld]');
  if (existingScript) existingScript.remove();

  if (tools.length === 0) return;

  const jsonLd = {
    '@context': 'https://modelcontextprotocol.io/schema/2024-11/tool',
    '@type': 'ToolCollection',
    hasTool: tools.map((tool) => ({
      '@type': 'Tool',
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    })),
  };

  const script = document.createElement('script');
  script.type = 'application/ld+json';
  script.setAttribute('data-swagger-webmcp-jsonld', 'true');
  script.textContent = JSON.stringify(jsonLd, null, 2);
  document.head.appendChild(script);
}

function isModelContextAvailable(): boolean {
  return typeof navigator !== 'undefined' && 'modelContext' in navigator;
}

function syncJsonLd(): void {
  injectJsonLdFallback([..._registeredTools.values()]);
}

function isDuplicateToolError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.toLowerCase().includes('duplicate');
}

async function _registerSingleTool(tool: MCPToolWithExecute): Promise<void> {
  if (!isModelContextAvailable()) return;

  const nav = navigator as Navigator & {
    modelContext: {
      registerTool: (tool: MCPToolWithExecute) => Promise<void>;
    };
  };

  try {
    await nav.modelContext.registerTool(tool);
  } catch (err: unknown) {
    if (isDuplicateToolError(err)) {
      return;
    }
    throw err;
  }
}

async function _unregisterSingleTool(name: string): Promise<void> {
  if (!isModelContextAvailable()) return;

  const nav = navigator as Navigator & {
    modelContext: {
      unregisterTool?: (name: string) => Promise<void>;
    };
  };

  if (typeof nav.modelContext.unregisterTool === 'function') {
    try {
      await nav.modelContext.unregisterTool(name);
    } catch (err: unknown) {
      // ignore unregister failures in browser model context
    }
  }
}

async function enrichDescriptions(
  tools: { name: string; description: string }[],
  config: EnricherConfig
): Promise<string[]> {
  const apiKey = typeof config.apiKey === 'function' ? await config.apiKey() : config.apiKey;
  const results: string[] = [];

  for (const tool of tools) {
    try {
      if (config.provider === 'anthropic') {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true',
          },
          body: JSON.stringify({
            model: config.model || 'claude-3-5-haiku-20241022',
            max_tokens: 300,
            messages: [
              {
                role: 'user',
                content: `Improve this API description for an AI agent. Be concise and informative.\n\n${tool.description}\n\nReturn ONLY the improved description.`,
              },
            ],
          }),
        });

        if (response.ok) {
          const data = await response.json() as { content: { text: string }[] };
          results.push(data.content[0]?.text || tool.description);
        } else {
          results.push(tool.description);
        }
      } else {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: config.model || 'gpt-4o-mini',
            max_tokens: 300,
            messages: [
              {
                role: 'system',
                content: 'Improve API descriptions for AI agents. Return ONLY the improved description.',
              },
              {
                role: 'user',
                content: tool.description,
              },
            ],
          }),
        });

        if (response.ok) {
          const data = await response.json() as { choices: { message: { content: string } }[] };
          results.push(data.choices[0]?.message?.content || tool.description);
        } else {
          results.push(tool.description);
        }
      }
    } catch {
      results.push(tool.description);
    }
  }

  return results;
}


export function getRegisteredTools(): string[] {
  return [..._registeredTools.keys()];
}

/**
 * Get the last registration diagnostics.
 * Useful for frontend to understand why certain tools aren't available.
 */
export function getLastDiagnostics(): ToolRegistrationDiagnostics | undefined {
  return _lastDiagnostics;
}

/**
 * Get availability status for tools.
 * Returns both registered tools and detailed info about unavailable tools.
 */
export function getToolAvailabilityStatus(): {
  available: string[];
  unavailable: Array<{
    name: string;
    reason: string;
    message?: string;
  }>;
  summary?: string;
} {
  const available = [..._registeredTools.keys()];
  const unavailable: Array<{
    name: string;
    reason: string;
    message?: string;
  }> = [];

  if (_lastDiagnostics?.filteredTools) {
    unavailable.push(
      ..._lastDiagnostics.filteredTools.map((tool) => ({
        name: tool.name,
        reason: tool.reason,
        message: tool.message,
      }))
    );
  }

  return {
    available,
    unavailable,
    summary: _lastDiagnostics?.permissionSummary,
  };
}

export async function unregisterSwaggerTools(names: string[]): Promise<void> {
  const toRemove = names.filter((n) => _registeredTools.has(n));
  if (toRemove.length === 0) return;

  for (const name of toRemove) {
    await _unregisterSingleTool(name);
    _registeredTools.delete(name);
  }

  syncJsonLd();
}

export async function unregisterAllSwaggerTools(): Promise<void> {
  const names = [..._registeredTools.keys()];
  await unregisterSwaggerTools(names);
  _activeScope = null;
}

export async function executeSwaggerTool(
  name: string,
  params: Record<string, unknown>
): Promise<unknown> {
  const tool = _registeredTools.get(name);
  if (!tool) {
    throw new Error(`Tool '${name}' is not registered.`);
  }

  if (typeof tool.execute !== 'function') {
    throw new Error(`Tool '${name}' has no execute function.`);
  }

  return tool.execute(params);
}

export async function swapToolScope(
  options: SwaggerToolsOptions,
  scopeKey: string
): Promise<SwaggerToolsResult> {
  // Create fingerprint including filter options to prevent stale scope
  const fingerprint = createScopeFingerprint(scopeKey, {
    allowedScopes: options.allowedScopes,
    requiredRoles: options.requiredRoles,
    scopeMode: options.scopeMode,
    roleMode: options.roleMode,
    scopeRegistrationMode: options.scopeRegistrationMode,
    secureMode: options.secureMode,
  });

  if (_activeScope === fingerprint) {
    return { 
      tools: [..._registeredTools.values()], 
      errors: [],
      diagnostics: {
        registered: [..._registeredTools.keys()],
        skipped: [],
        filtered: 0,
      }
    };
  }

  await unregisterAllSwaggerTools();

  _activeScope = fingerprint;
  return registerSwaggerTools(options);
}

export async function registerSwaggerTools(
  options: SwaggerToolsOptions
): Promise<SwaggerToolsResult> {
  const spec = await parseSpec(options.spec, { baseUrl: options.baseUrl });

  const result = transformSpec(spec, {
    auth: options.auth,
    include: options.include,
    exclude: options.exclude,
    baseUrl: options.baseUrl,
    allowedScopes: options.allowedScopes,
    requiredRoles: options.requiredRoles,
    scopeMode: options.scopeMode,
    roleMode: options.roleMode,
    scopeRegistrationMode: options.scopeRegistrationMode,
    secureMode: options.secureMode,
  });

  if (options.enricher && result.tools.length > 0) {
    try {
      const enriched = await enrichDescriptions(
        result.tools.map((t) => ({ name: t.name, description: t.description })),
        options.enricher
      );
      for (let i = 0; i < result.tools.length; i++) {
        if (enriched[i]) {
          result.tools[i].description = enriched[i];
        }
      }
    } catch (err: unknown) {
      result.errors.push(
        `Enricher failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  const registeredNames: string[] = [];

  for (const tool of result.tools as MCPToolWithExecute[]) {
    if (_registeredTools.has(tool.name)) {
      continue;
    }

    await _registerSingleTool(tool);
    _registeredTools.set(tool.name, tool);
    registeredNames.push(tool.name);
  }

  if (!isModelContextAvailable()) {
    syncJsonLd();
  }

  _lastDiagnostics = result.diagnostics;

  return result;
}
