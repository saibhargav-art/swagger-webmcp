# Project State: @vikramthakur/swagger-webmcp

## Last Updated
2026-03-27

## Project Overview

`swagger-webmcp` is a browser-native TypeScript library that bridges OpenAPI/Swagger specifications and the emerging **WebMCP** (Web Model Context Protocol) standard. Its core purpose is to automatically convert any OpenAPI spec into callable MCP tools that AI agents can discover and invoke directly from a web browser, without a server-side MCP proxy.

**Current Version:** 0.2.2
**License:** MIT
**Published Registry:** Gemfury (private registry at npm.fury.io/vikramthakur)

## Technology Stack

| Layer | Technology |
|-------|-----------|
| Language | TypeScript 5.3 (strict mode) |
| Target | ES2022 + DOM (browser-native) |
| Build Tool | tsup 8.x (wraps esbuild) |
| Module Formats | CJS + ESM dual output |
| React Integration | React 18+ (peer dependency) |
| Runtime | Browser (fetch API, navigator.modelContext) |

## Project Structure

```
swagger-mcp/
├── src/
│   ├── index.ts                  # Main barrel export
│   ├── lib/
│   │   ├── types.ts              # All TypeScript interfaces
│   │   ├── parser.ts             # OpenAPI spec loading & $ref resolution
│   │   ├── transformer.ts        # Spec -> WebMCP tool transformation + HTTP executor
│   │   └── registry.ts          # Tool registration + enricher + JSON-LD fallback
│   └── adapters/
│       ├── react.tsx             # React Context Provider + useSwaggerTools hook
│       └── vanilla.ts            # Framework-agnostic thin wrapper
├── dist/                         # Built output (CJS + ESM + .d.ts)
├── tsconfig.json
├── tsup.config.ts
├── package.json
└── .npmrc                        # Private Gemfury registry config
```

## Architecture & Design Patterns

### Core Pipeline
```
OpenAPI Spec (URL | path | object)
    -> parseSpec()       [parser.ts]   - fetch, parse, resolve $refs
    -> transformSpec()   [transformer.ts] - build WebMCPToolDefinition[] with execute()
    -> enrichDescriptions() [registry.ts] - optional AI description improvement
    -> registerTools()   [registry.ts] - navigator.modelContext or JSON-LD fallback
```

### Key Architectural Decisions

1. **Dual Registration Strategy**: If `navigator.modelContext` exists (WebMCP-capable browser), tools are registered natively. Otherwise, a JSON-LD `<script>` tag is injected into `<head>` as a discovery fallback using the MCP schema context (`https://modelcontextprotocol.io/schema/2024-11/tool`).

2. **$ref Resolution at Parse Time**: The parser eagerly resolves all `$ref` pointers, `allOf` merges, and `anyOf`/`oneOf` simplification before transformation. This avoids lazy resolution complexity downstream.

3. **Flat Parameter Model**: Path params, query params, and request body properties are all merged into a single flat `inputSchema.properties` object. The `execute()` function re-separates them at call time by checking if the key appears in the path template.

4. **Auth Lazy Evaluation**: Both `BearerAuthConfig.token` and `ApiKeyAuthConfig.value` accept either a static string or an async function, enabling token rotation without re-registration.

5. **Tag-Based Filtering**: `include` and `exclude` options filter operations by OpenAPI tags before transformation.

6. **AI Description Enrichment**: Optional `EnricherConfig` can call Anthropic or OpenAI to improve tool descriptions for better LLM discoverability. Uses `anthropic-dangerous-direct-browser-access` header for direct browser calls.

7. **Adapter Pattern**: Framework-specific adapters (`react`, `vanilla`) are separate entry points compiled to their own bundles, keeping core logic framework-agnostic.

## Entry Points & Exports

| Export Path | Description |
|-------------|-------------|
| `@vikramthakur/swagger-webmcp` | Core: `registerSwaggerTools`, `parseSpec`, `transformSpec`, all types |
| `@vikramthakur/swagger-webmcp/react` | `SwaggerToolsProvider`, `useSwaggerTools` |
| `@vikramthakur/swagger-webmcp/vanilla` | `setupSwaggerTools` (thin alias) |

## Current Status

- Core functionality: COMPLETE
- Build output: COMPLETE (dist/ present, last built Mar 23 2024)
- Tests: NONE (no test files or test framework configured)
- Documentation: NONE (no README.md present)
- CI/CD: NONE (no config files)

## Known Issues & Technical Debt

1. **No README** - Package has no documentation file. New consumers have no getting-started guide.
2. **No Tests** - Zero test coverage. All three layers (parser, transformer, registry) are untested.
3. **Security Concern** - `.npmrc` contains a plaintext Gemfury auth token. This file should not be committed to source control.
4. **anyOf/oneOf Simplification** - The parser only uses the first schema variant with properties, silently discarding all other variants.
5. **No Header/Cookie Params** - `buildInputSchema` in transformer.ts only processes `path` and `query` parameters; `header` and `cookie` parameters are silently dropped.
6. **URL Construction Bug** - `createExecute` constructs `new URL(baseUrl + path)` then also builds `url.searchParams` but `finalPath` is computed separately and never applied to the URL object. The `url` variable's pathname is not updated with encoded path params.
7. **Body Param Leakage** - The body params extraction logic (`bodyParams`) may include query params that were added to `queryParams` map but have the same name as body fields.
8. **JSON.stringify in useEffect deps** - `react.tsx` uses `JSON.stringify(auth)` and `JSON.stringify(include)` in the `useEffect` dependency array, which is an anti-pattern that causes unnecessary re-renders.
9. **No Swagger 2.0 validation** - The parser accepts both OpenAPI 3.x and Swagger 2.0 (checks both `openapi` and `swagger` fields) but never validates the version or handles version-specific structural differences (e.g., Swagger 2.0 uses `host`/`basePath` instead of `servers`).
10. **Enricher sequential execution** - AI enrichment calls are made one-at-a-time in a `for` loop; could be parallelized with `Promise.all` for performance.

## Next Planned Features / Improvements
- Add README with usage examples
- Add unit tests (vitest recommended given tsup/esbuild ecosystem)
- Fix URL construction bug in createExecute
- Support header and cookie parameters
- Handle Swagger 2.0 `host`/`basePath` server resolution
- Move auth token out of .npmrc into environment variable
- Parallelize enricher API calls
