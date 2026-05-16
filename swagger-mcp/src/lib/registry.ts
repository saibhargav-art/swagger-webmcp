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

function injectJsonLdFallback(tools: WebMCPToolDefinition[]): void {
  if (typeof document === 'undefined') return;

  const existingScript = document.querySelector('script[data-swagger-webmcp-jsonld]');
  if (existingScript) existingScript.remove();

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

async function registerTools(tools: MCPToolWithExecute[]): Promise<void> {
  if (isModelContextAvailable()) {
    const nav = navigator as Navigator & {
      modelContext: {
        registerTool: (tool: MCPToolWithExecute) => Promise<void>;
      };
    };
    for (const tool of tools) {
      await nav.modelContext.registerTool(tool);
    }
  } else {
    injectJsonLdFallback(tools);
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

  await registerTools(result.tools as MCPToolWithExecute[]);

  console.log(
    `%c[swagger-webmcp] Registered ${result.tools.length} tools`,
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
