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
  // WebMCP-specific vendor extensions for scope/role-based filtering
  'x-webmcp-scopes'?: string[];
  'x-webmcp-roles'?: string[];
  // Allow arbitrary vendor extensions
  [key: `x-${string}`]: unknown;
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

export interface SessionAuthConfig {
  type: 'session';
  credentials?: 'include' | 'same-origin';
  validate?: () => boolean | Promise<boolean>;
}

export type AuthConfig = BearerAuthConfig | ApiKeyAuthConfig | SessionAuthConfig;

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
  // First-class scope/role filtering
  allowedScopes?: string[];
  requiredRoles?: string[];
  scopeMode?: 'all' | 'any'; // 'all' = user must have all scopes, 'any' = user can have any scope
  roleMode?: 'all' | 'any'; // 'all' = tool requires all roles, 'any' = tool requires any role
  scopeRegistrationMode?: 'discovery' | 'filtered';
  // Secure mode: default-deny (require explicit scope/role) vs default-allow
  secureMode?: boolean; // if true, tools without declared scopes/roles are skipped
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
  securityMetadata?: {
    authorized: boolean;
    reason?: string;
    message: string;
    requiredScopes?: string[];
    requiredRoles?: string[];
    secureMode: boolean;
  };
}

export type MCPToolWithExecute = WebMCPToolDefinition & {
  execute: (params: Record<string, unknown>) => Promise<unknown>;
};

export interface ToolSkipReason {
  toolName: string;
  operationId?: string;
  reason: 'insufficient_scope' | 'insufficient_role' | 'session_invalid' | 'tag_mismatch' | 'duplicate' | 'secure_mode_deny' | 'other';
  details?: string;
  requiredScopes?: string[];
  requiredRoles?: string[];
}

export interface FilteredToolInfo {
  name: string;
  operationId?: string;
  summary?: string;
  reason: 'insufficient_scope' | 'insufficient_role' | 'secure_mode_deny' | 'session_invalid';
  requiredScopes?: string[];
  requiredRoles?: string[];
  message: string; // Human-readable message for frontend/UI
}

export interface ToolRegistrationDiagnostics {
  registered: string[]; // tool names successfully registered
  skipped: ToolSkipReason[]; // tools skipped with reasons
  filtered: number; // total tools filtered by scope/role
  filteredTools?: FilteredToolInfo[]; // detailed info about each filtered tool
  permissionSummary?: string; // human-readable summary of why tools are unavailable
}

export interface SwaggerToolsResult {
  tools: WebMCPToolDefinition[];
  errors: string[];
  diagnostics?: ToolRegistrationDiagnostics; // diagnostic info about registration
}
export interface SwaggerToolsScope {
  key: string;
  tags?: string[];
  // Scope/role filtering options
  allowedScopes?: string[];
  requiredRoles?: string[];
  scopeMode?: 'all' | 'any';
  roleMode?: 'all' | 'any';
  scopeRegistrationMode?: 'discovery' | 'filtered';
  secureMode?: boolean;
}