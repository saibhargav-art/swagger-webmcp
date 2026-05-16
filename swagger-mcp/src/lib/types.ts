export interface OpenAPISchema {
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

export interface OpenAPIParameter {
  name: string;
  in: 'path' | 'query' | 'header' | 'cookie';
  required?: boolean;
  description?: string;
  schema?: OpenAPISchema;
}

export interface OpenAPIRequestBody {
  required?: boolean;
  description?: string;
  content?: {
    'application/json'?: {
      schema?: OpenAPISchema;
    };
  };
}

export interface OpenAPIOperation {
  operationId?: string;
  summary?: string;
  description?: string;
  parameters?: OpenAPIParameter[];
  requestBody?: OpenAPIRequestBody;
  responses?: Record<string, unknown>;
  tags?: string[];
}

export interface OpenAPIServer {
  url: string;
  description?: string;
}

export interface ParsedOpenAPISpec {
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

export interface BearerAuthConfig {
  type: 'bearer';
  token: string | (() => string | Promise<string>);
}

export interface ApiKeyAuthConfig {
  type: 'apiKey';
  header: string;
  value: string | (() => string | Promise<string>);
}

export type AuthConfig = BearerAuthConfig | ApiKeyAuthConfig;

export interface EnricherConfig {
  provider: 'anthropic' | 'openai';
  apiKey: string | (() => string | Promise<string>);
  model?: string;
}

export interface SwaggerToolsOptions {
  spec: string | object;
  auth?: AuthConfig;
  include?: string[];
  exclude?: string[];
  baseUrl?: string;
  enricher?: EnricherConfig;
}

export interface WebMCPInputSchema {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
  description?: string;
}

export interface WebMCPToolDefinition {
  name: string;
  description: string;
  inputSchema: WebMCPInputSchema;
  execute?: (params: Record<string, unknown>) => Promise<unknown>;
}

export type MCPToolWithExecute = WebMCPToolDefinition & {
  execute: (params: Record<string, unknown>) => Promise<unknown>;
};

export interface SwaggerToolsResult {
  tools: WebMCPToolDefinition[];
  errors: string[];
}
