import { S as SwaggerToolsOptions, a as SwaggerToolsResult, P as ParsedOpenAPISpec, A as AuthConfig } from './types-DnCZNaZE.js';
export { b as ApiKeyAuthConfig, B as BearerAuthConfig, E as EnricherConfig, M as MCPToolWithExecute, O as OpenAPIOperation, c as OpenAPIParameter, d as OpenAPIRequestBody, e as OpenAPISchema, f as OpenAPIServer, W as WebMCPInputSchema, g as WebMCPToolDefinition } from './types-DnCZNaZE.js';

declare function registerSwaggerTools(options: SwaggerToolsOptions): Promise<SwaggerToolsResult>;

declare function parseSpec(spec: string | object, _options?: {
    baseUrl?: string;
}): Promise<ParsedOpenAPISpec>;

declare function transformSpec(spec: ParsedOpenAPISpec, options: {
    auth?: AuthConfig;
    include?: string[];
    exclude?: string[];
    baseUrl?: string;
}): SwaggerToolsResult;

export { AuthConfig, ParsedOpenAPISpec, SwaggerToolsOptions, SwaggerToolsResult, parseSpec, registerSwaggerTools, transformSpec };
