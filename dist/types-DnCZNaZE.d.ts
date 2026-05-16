interface OpenAPISchema {
    type?: string;
    properties?: Record<string, OpenAPISchema>;
    items?: OpenAPISchema;
    required?: string[];
    format?: string;
    description?: string;
    $ref?: string;
    allOf?: OpenAPISchema[];
    anyOf?: OpenAPISchema[];
    oneOf?: OpenAPISchema[];
    enum?: unknown[];
}
interface OpenAPIParameter {
    name: string;
    in: 'path' | 'query' | 'header' | 'cookie';
    required?: boolean;
    description?: string;
    schema?: OpenAPISchema;
}
interface OpenAPIRequestBody {
    required?: boolean;
    description?: string;
    content?: {
        'application/json'?: {
            schema?: OpenAPISchema;
        };
    };
}
interface OpenAPIOperation {
    operationId?: string;
    summary?: string;
    description?: string;
    parameters?: OpenAPIParameter[];
    requestBody?: OpenAPIRequestBody;
    responses?: Record<string, unknown>;
    tags?: string[];
}
interface OpenAPIServer {
    url: string;
    description?: string;
}
interface ParsedOpenAPISpec {
    openapi?: string;
    swagger?: string;
    info: {
        title: string;
        version: string;
        description?: string;
    };
    servers?: OpenAPIServer[];
    paths: Record<string, Record<string, OpenAPIOperation>>;
    components?: {
        schemas?: Record<string, OpenAPISchema>;
        securitySchemes?: Record<string, unknown>;
    };
}
interface BearerAuthConfig {
    type: 'bearer';
    token: string | (() => string | Promise<string>);
}
interface ApiKeyAuthConfig {
    type: 'apiKey';
    header: string;
    value: string | (() => string | Promise<string>);
}
type AuthConfig = BearerAuthConfig | ApiKeyAuthConfig;
interface EnricherConfig {
    provider: 'anthropic' | 'openai';
    apiKey: string | (() => string | Promise<string>);
    model?: string;
}
interface SwaggerToolsOptions {
    spec: string | object;
    auth?: AuthConfig;
    include?: string[];
    exclude?: string[];
    baseUrl?: string;
    enricher?: EnricherConfig;
}
interface WebMCPInputSchema {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
    description?: string;
}
interface WebMCPToolDefinition {
    name: string;
    description: string;
    inputSchema: WebMCPInputSchema;
    execute?: (params: Record<string, unknown>) => Promise<unknown>;
}
type MCPToolWithExecute = WebMCPToolDefinition & {
    execute: (params: Record<string, unknown>) => Promise<unknown>;
};
interface SwaggerToolsResult {
    tools: WebMCPToolDefinition[];
    errors: string[];
}

export type { AuthConfig as A, BearerAuthConfig as B, EnricherConfig as E, MCPToolWithExecute as M, OpenAPIOperation as O, ParsedOpenAPISpec as P, SwaggerToolsOptions as S, WebMCPInputSchema as W, SwaggerToolsResult as a, ApiKeyAuthConfig as b, OpenAPIParameter as c, OpenAPIRequestBody as d, OpenAPISchema as e, OpenAPIServer as f, WebMCPToolDefinition as g };
