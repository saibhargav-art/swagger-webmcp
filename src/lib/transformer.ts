import type {
  AuthConfig,
  ParsedOpenAPISpec,
  OpenAPIOperation,
  OpenAPISchema,
  SwaggerToolsResult,
  WebMCPToolDefinition,
  MCPToolWithExecute,
  ToolSkipReason,
  ToolRegistrationDiagnostics,
  InvocationContext,
} from './types.js';
import { getAllOperations, resolveBaseUrl } from './parser.js';

function generateOperationId(
  operation: OpenAPIOperation,
  path: string,
  method: string
): string {
  if (operation.operationId) {
    return operation.operationId.replace(/[^a-zA-Z0-9_]/g, '_');
  }

  const cleanPath = path
    .replace(/^\//, '')
    .replace(/\//g, '_')
    .replace(/[{}]/g, '')
    .replace(/[^a-zA-Z0-9_]/g, '_');

  return `${method}_${cleanPath}`.toLowerCase();
}

/**
 * Check if user's allowed scopes satisfy tool's required scopes
 */
function userHasRequiredScopes(
  toolScopes: string[] | undefined,
  allowedScopes: string[] | undefined,
  scopeMode: 'all' | 'any' = 'any'
): { matches: boolean; reason?: string } {
  // If tool has no scope requirements, allow by default
  if (!toolScopes || toolScopes.length === 0) {
    return { matches: true };
  }

  // If user has no allowed scopes but tool requires them
  if (!allowedScopes || allowedScopes.length === 0) {
    return {
      matches: false,
      reason: `Missing required scope(s): ${toolScopes.join(', ')}`,
    };
  }

  if (scopeMode === 'all') {
    // User must have ALL scopes that the tool requires
    const hasAll = toolScopes.every((scope) => allowedScopes.includes(scope));
    return {
      matches: hasAll,
      reason: hasAll
        ? undefined
        : `Missing scope(s): ${toolScopes.filter((s) => !allowedScopes.includes(s)).join(', ')}`,
    };
  } else {
    // scopeMode === 'any': User must have AT LEAST ONE scope that the tool requires
    const hasAny = toolScopes.some((scope) => allowedScopes.includes(scope));
    return {
      matches: hasAny,
      reason: hasAny
        ? undefined
        : `Missing any of required scope(s): ${toolScopes.join(', ')}`,
    };
  }
}

/**
 * Check if user's roles satisfy tool's required roles
 */
function userHasRequiredRoles(
  toolRoles: string[] | undefined,
  requiredRoles: string[] | undefined,
  roleMode: 'all' | 'any' = 'any'
): { matches: boolean; reason?: string } {
  // If tool has no role requirements, allow by default
  if (!toolRoles || toolRoles.length === 0) {
    return { matches: true };
  }

  // If user has no required roles but tool requires them
  if (!requiredRoles || requiredRoles.length === 0) {
    return {
      matches: false,
      reason: `Missing required role(s): ${toolRoles.join(', ')}`,
    };
  }

  if (roleMode === 'all') {
    // User must have ALL roles that the tool requires
    const hasAll = toolRoles.every((role) => requiredRoles.includes(role));
    return {
      matches: hasAll,
      reason: hasAll
        ? undefined
        : `Missing role(s): ${toolRoles.filter((r) => !requiredRoles.includes(r)).join(', ')}`,
    };
  } else {
    // roleMode === 'any': User must have AT LEAST ONE role that the tool requires
    const hasAny = toolRoles.some((role) => requiredRoles.includes(role));
    return {
      matches: hasAny,
      reason: hasAny
        ? undefined
        : `Missing any of required role(s): ${toolRoles.join(', ')}`,
    };
  }
}

/**
 * Check if tool should be registered based on authorization requirements
 */
function isToolAuthorized(
  operation: OpenAPIOperation,
  allowedScopes?: string[],
  requiredRoles?: string[],
  scopeMode: 'all' | 'any' = 'any',
  roleMode: 'all' | 'any' = 'any',
  secureMode = true
): {
  authorized: boolean;
  skipReason?: string;
  reason?: 'insufficient_scope' | 'insufficient_role' | 'secure_mode_deny' | 'other';
  requiredScopes?: string[];
  requiredRoles?: string[];
} {
    const toolScopes = operation['x-webmcp-scopes'];
  const toolRoles = operation['x-webmcp-roles'];

  // In secure mode, tools without declared scopes/roles are skipped
  if (secureMode && !toolScopes && !toolRoles) {
    return {
      authorized: false,
      skipReason: 'No scopes/roles declared (secure mode)',
      reason: 'secure_mode_deny',
      requiredScopes: toolScopes,
      requiredRoles: toolRoles,
    };
  }

  // Check scope requirements
  const scopeCheck = userHasRequiredScopes(toolScopes, allowedScopes, scopeMode);
  if (!scopeCheck.matches) {
    return {
      authorized: false,
      skipReason: scopeCheck.reason || 'Insufficient scope',
      reason: 'insufficient_scope',
      requiredScopes: toolScopes,
      requiredRoles: toolRoles,
    };
  }

  // Check role requirements
  const roleCheck = userHasRequiredRoles(toolRoles, requiredRoles, roleMode);
  if (!roleCheck.matches) {
    return {
      authorized: false,
      skipReason: roleCheck.reason || 'Insufficient role',
      reason: 'insufficient_role',
      requiredScopes: toolScopes,
      requiredRoles: toolRoles,
    };
  }

  return { authorized: true };
}

/**
 * Generate human-readable permission denial message for frontend
 */
function generatePermissionMessage(
  toolName: string,
  summary?: string,
  reason?: 'insufficient_scope' | 'insufficient_role' | 'secure_mode_deny' | 'session_invalid',
  requiredScopes?: string[],
  requiredRoles?: string[]
): string {
  const toolDesc = summary ? `"${summary}"` : `"${toolName}"`;

  switch (reason) {
    case 'insufficient_scope':
      return `Tool ${toolDesc} requires scope(s): ${requiredScopes?.join(', ') || 'unknown'}. You don't have the required permissions.`;

    case 'insufficient_role':
      return `Tool ${toolDesc} requires role(s): ${requiredRoles?.join(', ') || 'unknown'}. Your current role doesn't have access.`;

    case 'secure_mode_deny':
      return `Tool ${toolDesc} is not available in secure mode (no security declarations found).`;

    case 'session_invalid':
      return `Tool ${toolDesc} requires an authenticated session. Please sign in and try again.`;

    default:
      return `Tool ${toolDesc} is not available. Permission denied.`;
  }
}

function extractProperties(schema: OpenAPISchema): Record<string, unknown> {
  const props: Record<string, unknown> = {};

  if (schema.properties) {
    for (const [name, prop] of Object.entries(schema.properties)) {
      const typedProp = prop as OpenAPISchema;
      const propDef: Record<string, unknown> = {
        type: typedProp.type || 'object',
      };

      if (typedProp.description) propDef.description = typedProp.description;
      if (typedProp.format) propDef.format = typedProp.format;
      if (typedProp.enum) propDef.enum = typedProp.enum;
      if (typedProp.items) propDef.items = typedProp.items;

      props[name] = propDef;
    }
  }

  return props;
}

function buildInputSchema(operation: OpenAPIOperation): {
  properties: Record<string, unknown>;
  required: string[];
} {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const param of operation.parameters || []) {
    if (param.in === 'path' || param.in === 'query') {
      const prop: Record<string, unknown> = {
        type: param.schema?.type || 'string',
      };

      if (param.description) prop.description = param.description;
      if (param.schema?.format) prop.format = param.schema.format;
      if (param.schema?.enum) prop.enum = param.schema.enum;

      properties[param.name] = prop;
      if (param.required) required.push(param.name);
    }
  }

  const bodySchema = operation.requestBody?.content?.['application/json']?.schema;
  if (bodySchema) {
    const bodyProps = extractProperties(bodySchema);
    Object.assign(properties, bodyProps);

    if (bodySchema.required) {
      for (const req of bodySchema.required) {
        if (!required.includes(req)) {
          required.push(req);
        }
      }
    }
  }

  return { properties, required };
}

function buildDescription(operation: OpenAPIOperation): string {
  if (operation.summary && operation.description) {
    return `${operation.summary}\n\n${operation.description}`;
  }
  if (operation.summary) return operation.summary;
  if (operation.description) return operation.description;
  return 'No description available';
}

function hasAuthConfig(auth?: AuthConfig): boolean {
  if (!auth) return false;
  if (auth.type === 'bearer') {
    return typeof auth.token !== 'string' || auth.token.trim() !== '';
  }
  if (auth.type === 'apiKey') {
    return typeof auth.value !== 'string' || auth.value.trim() !== '';
  }
  if (auth.type === 'session') {
    return true;
  }
  return false;
}

function filterByTags(
  operations: { path: string; method: string; operation: OpenAPIOperation }[],
  include?: string[],
  exclude?: string[]
): typeof operations {
  let filtered = operations;

  if (include && include.length > 0) {
    filtered = filtered.filter((op) =>
      op.operation.tags?.some((tag) => include.includes(tag))
    );
  }

  if (exclude && exclude.length > 0) {
    filtered = filtered.filter(
      (op) => !op.operation.tags?.some((tag) => exclude.includes(tag))
    );
  }

  return filtered;
}

async function resolveAuthValue(auth?: AuthConfig): Promise<string | undefined> {
  if (!auth) return undefined;

  if (auth.type === 'bearer') {
    const token = typeof auth.token === 'function' ? await auth.token() : auth.token;
    return typeof token === 'string' ? token.trim() || undefined : String(token);
  }

  if (auth.type === 'apiKey') {
    const value = typeof auth.value === 'function' ? await auth.value() : auth.value;
    return typeof value === 'string' ? value.trim() || undefined : String(value);
  }

  return undefined;
}

async function getAuthHeaders(auth?: AuthConfig): Promise<Record<string, string>> {
  const headers: Record<string, string> = {};

  if (!auth) return headers;

  if (auth.type === 'bearer') {
    const token = typeof auth.token === 'function' ? await auth.token() : auth.token;
    headers['Authorization'] = `Bearer ${token}`;
  } else if (auth.type === 'apiKey') {
    const value = typeof auth.value === 'function' ? await auth.value() : auth.value;
    headers[auth.header] = value;
  }

  return headers;
}

function createExecute(
  baseUrl: string,
  path: string,
  method: string,
  auth?: AuthConfig
): (params: Record<string, unknown>, invocationAuth?: AuthConfig) => Promise<unknown> {
  return async function execute(params: Record<string, unknown>, invocationAuth?: AuthConfig): Promise<unknown> {
    const pathParams: Record<string, string> = {};
    const queryParams: Record<string, string> = {};

    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null) continue;

      if (path.includes(`{${key}}`)) {
        pathParams[key] = String(value);
      } else if (['GET', 'DELETE'].includes(method)) {
        queryParams[key] = String(value);
      }
    }

    let finalPath = path;
    for (const [key, value] of Object.entries(pathParams)) {
      finalPath = finalPath.replace(`{${key}}`, encodeURIComponent(value));
    }

    const url = new URL(`${baseUrl}${finalPath}`);
    if (Object.keys(queryParams).length > 0) {
      for (const [key, value] of Object.entries(queryParams)) {
        url.searchParams.append(key, value);
      }
    }

    const bodyParams = ['POST', 'PUT', 'PATCH'].includes(method)
      ? Object.entries(params)
          .filter(([key]) => !pathParams[key])
          .reduce((acc, [key, value]) => {
            if (value !== undefined) acc[key] = value;
            return acc;
          }, {} as Record<string, unknown>)
      : {};

    const finalAuth = invocationAuth ?? auth;
    let headers = await getAuthHeaders(finalAuth);
    if (Object.keys(bodyParams).length > 0) {
      headers['Content-Type'] = 'application/json';
    }

    const fetchOptions: RequestInit = {
      method,
      headers,
      mode: 'cors',
    };

    if (finalAuth?.type === 'session') {
      if (typeof finalAuth.validate === 'function') {
        const valid = await finalAuth.validate();
        if (!valid) {
          throw new Error('User session is not available. Please sign in and try again.');
        }
      }
      fetchOptions.credentials = finalAuth.credentials ?? 'include';
    } else if (finalAuth) {
      const tokenOrValue = await resolveAuthValue(finalAuth);
      if (!tokenOrValue) {
        throw new Error('User session is not available. Please sign in and try again.');
      }
    }

    if (['POST', 'PUT', 'PATCH'].includes(method) && Object.keys(bodyParams).length > 0) {
      fetchOptions.body = JSON.stringify(bodyParams);
    }

    const response = await fetch(url.toString(), fetchOptions);

    if (!response.ok) {
      let errorBody: unknown;
      try {
        errorBody = await response.json();
      } catch {
        errorBody = await response.text();
      }
      throw new Error(`HTTP ${response.status}: ${JSON.stringify(errorBody)}`);
    }

    const contentType = response.headers.get('content-type');
    if (contentType?.includes('application/json')) {
      return response.json();
    }
    return response.text();
  };
}

export function transformSpec(
  spec: ParsedOpenAPISpec,
  options: {
    auth?: AuthConfig;
    include?: string[];
    exclude?: string[];
    baseUrl?: string;
    // Secure mode only: if true, tools without declared scopes/roles are skipped at discovery
    secureMode?: boolean;
  }
): SwaggerToolsResult {
  const baseUrl = resolveBaseUrl(spec, options.baseUrl);
  const allOps = getAllOperations(spec);
  const filteredOps = filterByTags(allOps, options.include, options.exclude);

  const tools: WebMCPToolDefinition[] = [];
  const errors: string[] = [];
  const filteredTools: { name: string; operationId?: string; summary?: string; reason: 'insufficient_scope' | 'insufficient_role' | 'secure_mode_deny' | 'session_invalid'; requiredScopes?: string[]; requiredRoles?: string[]; message: string }[] = [];

  const diagnostics: ToolRegistrationDiagnostics = {
    registered: [],
    skipped: [],
    filtered: 0,
    filteredTools: [],
  };

  for (const { path, method, operation } of filteredOps) {
    try {
      const name = generateOperationId(operation, path, method);

      // Check if tool should be skipped in secureMode (tools without declared scopes/roles)
      if (options.secureMode ?? false) {
        const toolScopes = operation['x-webmcp-scopes'];
        const toolRoles = operation['x-webmcp-roles'];
        if (!toolScopes && !toolRoles) {
          diagnostics.skipped.push({
            toolName: name,
            operationId: operation.operationId,
            reason: 'secure_mode_deny',
            details: 'No scopes/roles declared (secure mode)',
            requiredScopes: toolScopes,
            requiredRoles: toolRoles,
          });
          diagnostics.filtered++;
          continue;
        }
      }

      const description = buildDescription(operation);
      const { properties, required } = buildInputSchema(operation);

      const securityMetadata = {
        // Tools are always discoverable; runtime checks enforce user authorization
        authorized: true,
        message: '',
        requiredScopes: operation['x-webmcp-scopes'],
        requiredRoles: operation['x-webmcp-roles'],
        secureMode: options.secureMode ?? false,
      };

      const baseExecute = createExecute(baseUrl, path, method.toUpperCase(), options.auth);

      const execute: (params: Record<string, unknown>, invocationContext?: InvocationContext) => Promise<unknown> = async (
        params,
        invocationContext
      ) => {
        // Runtime authorization checks using invocationContext with computed user scopes
        const toolScopes = operation['x-webmcp-scopes'];
        const toolRoles = operation['x-webmcp-roles'];

        // Secure mode: deny tools without declared scopes/roles
        if ((options.secureMode ?? false) && !toolScopes && !toolRoles) {
          throw new Error(generatePermissionMessage(name, operation.summary, 'secure_mode_deny', toolScopes, toolRoles));
        }

        // Validate scopes (always 'any' mode: user must have at least one required scope)
        const scopeCheck = userHasRequiredScopes(toolScopes, invocationContext?.userScopes, 'any');
        if (!scopeCheck.matches) {
          throw new Error(generatePermissionMessage(name, operation.summary, 'insufficient_scope', toolScopes, toolRoles));
        }

        // Validate roles (always 'any' mode: user must have at least one required role)
        const roleCheck = userHasRequiredRoles(toolRoles, invocationContext?.userRole ? [invocationContext.userRole] : undefined, 'any');
        if (!roleCheck.matches) {
          throw new Error(generatePermissionMessage(name, operation.summary, 'insufficient_role', toolScopes, toolRoles));
        }

        // If tool has security metadata and no auth is available, deny
        const hasSecurityMetadata = Boolean(toolScopes?.length || toolRoles?.length);
        if (hasSecurityMetadata && !options.auth && !invocationContext?.auth) {
          throw new Error(generatePermissionMessage(name, operation.summary, 'session_invalid', toolScopes, toolRoles));
        }

        // If dryRun, do not call the remote API; just return an authorization result
        if (invocationContext?.dryRun) {
          return { authorized: true };
        }

        // Execute using invocation-time auth override if provided
        return baseExecute(params, invocationContext?.auth);
      };

      const tool: MCPToolWithExecute = {
        name,
        description,
        inputSchema: {
          type: 'object',
          properties,
          required: required.length > 0 ? required : undefined,
        },
        execute,
        securityMetadata,
      };

      tools.push(tool);
      diagnostics.registered.push(name);
    } catch (err) {
      errors.push(
        `Failed to transform ${method.toUpperCase()} ${path}: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }

  // Generate permission summary if any tools were filtered
  if (filteredTools.length > 0) {
    const scopeRestrictions = filteredTools.filter((t) => t.reason === 'insufficient_scope');
    const roleRestrictions = filteredTools.filter((t) => t.reason === 'insufficient_role');
    const secureModeBlocked = filteredTools.filter((t) => t.reason === 'secure_mode_deny');
    const sessionBlocked = filteredTools.filter((t) => t.reason === 'session_invalid');

    const summaryParts: string[] = [];

    if (scopeRestrictions.length > 0) {
      summaryParts.push(
        `${scopeRestrictions.length} tool(s) require additional scope(s): ${scopeRestrictions.map((t) => t.name).join(', ')}`
      );
    }

    if (roleRestrictions.length > 0) {
      summaryParts.push(
        `${roleRestrictions.length} tool(s) require additional role(s): ${roleRestrictions.map((t) => t.name).join(', ')}`
      );
    }

    if (secureModeBlocked.length > 0) {
      summaryParts.push(
        `${secureModeBlocked.length} tool(s) blocked by secure mode`
      );
    }

    if (sessionBlocked.length > 0) {
      summaryParts.push(
        `${sessionBlocked.length} tool(s) blocked by missing authenticated session`
      );
    }

    diagnostics.permissionSummary = summaryParts.join('; ');
  }

  diagnostics.filteredTools = filteredTools;

  return { tools, errors, diagnostics };
}
