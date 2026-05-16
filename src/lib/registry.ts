import type {
  AuthConfig,
  EnricherConfig,
  SwaggerToolsOptions,
  SwaggerToolsResult,
  WebMCPToolDefinition,
  MCPToolWithExecute,
} from './types.js';
import { parseSpec } from './parser.js';
import { transformSpec } from './transformer.js';

// ─── Internal Registry State ──────────────────────────────────────────────────
// Single source of truth for what tools are currently registered.
// Key = tool name, Value = the full tool definition.
const _registeredTools = new Map<string, WebMCPToolDefinition>();

// Tracks which tag-scope is currently active so we can skip no-op swaps.
// e.g. 'users' | 'posts' | null (when all tools registered or none)
let _activeScope: string | null = null;
// ─────────────────────────────────────────────────────────────────────────────

function injectJsonLdFallback(tools: WebMCPToolDefinition[]): void {
  if (typeof document === 'undefined') return;

  const existingScript = document.querySelector('script[data-swagger-webmcp-jsonld]');
  if (existingScript) existingScript.remove();

  // If no tools remain, remove the script entirely and stop.
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

// Re-syncs the JSON-LD fallback to whatever is currently in _registeredTools.
// Always call this after any add/remove to keep <head> in sync.
function syncJsonLd(): void {
  injectJsonLdFallback([..._registeredTools.values()]);
}

async function _registerSingleTool(tool: MCPToolWithExecute): Promise<void> {
  if (isModelContextAvailable()) {
    const nav = navigator as Navigator & {
      modelContext: {
        registerTool: (tool: MCPToolWithExecute) => Promise<void>;
      };
    };
    await nav.modelContext.registerTool(tool);
  }
  // JSON-LD sync is handled in bulk by the caller after all tools are processed.
}

async function _unregisterSingleTool(name: string): Promise<void> {
  if (isModelContextAvailable()) {
    const nav = navigator as Navigator & {
      modelContext: {
        // unregisterTool is the emerging standard — gracefully skip if absent
        unregisterTool?: (name: string) => Promise<void>;
      };
    };
    if (typeof nav.modelContext.unregisterTool === 'function') {
      await nav.modelContext.unregisterTool(name);
    }
  }
  // JSON-LD sync is handled in bulk by the caller.
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

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns a snapshot of all currently registered tool names.
 * Useful for debug panels, testing, and the useRouteTools hook.
 */
export function getRegisteredTools(): string[] {
  return [..._registeredTools.keys()];
}

/**
 * Unregisters tools by name. Silently skips names that aren't registered.
 * Updates JSON-LD in <head> to reflect the removal.
 */
export async function unregisterSwaggerTools(names: string[]): Promise<void> {
  const toRemove = names.filter((n) => _registeredTools.has(n));
  if (toRemove.length === 0) return;

  for (const name of toRemove) {
    await _unregisterSingleTool(name);
    _registeredTools.delete(name);
  }

  syncJsonLd();

  console.log(
    `%c[swagger-webmcp] Unregistered ${toRemove.length} tools: ${toRemove.join(', ')}`,
    'color: #ef4444; font-weight: bold;'
  );
}

/**
 * Unregisters ALL currently registered tools.
 * Resets scope tracking. Clears JSON-LD from <head>.
 */
export async function unregisterAllSwaggerTools(): Promise<void> {
  const names = [..._registeredTools.keys()];
  await unregisterSwaggerTools(names);
  _activeScope = null;
}

/**
 * Swaps the active tool scope — unregisters tools from the previous scope
 * and registers tools for the new scope in a single atomic operation.
 *
 * This is the recommended function to call on route changes.
 *
 * @param options  - Same as registerSwaggerTools. `include` tags define the new scope.
 * @param scopeKey - A stable string identifying this scope (e.g. 'users', 'posts').
 *                   If the scope hasn't changed, this is a no-op.
 */
export async function swapToolScope(
  options: SwaggerToolsOptions,
  scopeKey: string
): Promise<SwaggerToolsResult> {
  // No-op if we're already in this scope
  if (_activeScope === scopeKey) {
    console.log(
      `%c[swagger-webmcp] Scope '${scopeKey}' already active — skipping re-registration`,
      'color: #f59e0b; font-weight: bold;'
    );
    return { tools: [..._registeredTools.values()], errors: [] };
  }

  // Unregister everything currently registered
  await unregisterAllSwaggerTools();

  // Register the new scope
  _activeScope = scopeKey;
  return registerSwaggerTools(options);
}

/**
 * Core registration function — unchanged public contract, but now with:
 * 1. Deduplication guard (skips tools already registered by name)
 * 2. Internal registry tracking
 * 3. JSON-LD sync after registration
 */
export async function registerSwaggerTools(
  options: SwaggerToolsOptions
): Promise<SwaggerToolsResult> {
  const spec = await parseSpec(options.spec, { baseUrl: options.baseUrl });

  const result = transformSpec(spec, {
    auth: options.auth,
    include: options.include,
    exclude: options.exclude,
    baseUrl: options.baseUrl,
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
    } catch (err) {
      result.errors.push(
        `Enricher failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  const skipped: string[] = [];
  const registered: string[] = [];

  for (const tool of result.tools as MCPToolWithExecute[]) {
    if (_registeredTools.has(tool.name)) {
      // ← Dedup guard: already registered, skip silently
      skipped.push(tool.name);
      continue;
    }

    await _registerSingleTool(tool);
    _registeredTools.set(tool.name, tool);
    registered.push(tool.name);
  }

  // Sync JSON-LD once after all tools are processed (not per-tool)
  if (!isModelContextAvailable()) {
    syncJsonLd();
  }

  if (skipped.length > 0) {
    console.log(
      `%c[swagger-webmcp] Skipped ${skipped.length} already-registered tools: ${skipped.join(', ')}`,
      'color: #f59e0b; font-weight: bold;'
    );
  }

  console.log(
    `%c[swagger-webmcp] Registered ${registered.length} tools`,
    'color: #10b981; font-weight: bold; font-size: 14px;'
  );
  console.log(
    '%c[swagger-webmcp] Registered tools:',
    'color: #10b981; font-weight: bold;'
  );
  result.tools.forEach((tool) => {
    console.log(`  %c${tool.name}`, 'color: #3b82f6; font-weight: bold;', {
      description: tool.description,
      inputSchema: tool.inputSchema,
    });
  });

  return result;
}
