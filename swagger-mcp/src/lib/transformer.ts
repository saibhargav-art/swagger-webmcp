import type {
  AuthConfig,
  ParsedOpenAPISpec,
  OpenAPIOperation,
  OpenAPISchema,
  SwaggerToolsResult,
  WebMCPToolDefinition,
  MCPToolWithExecute,
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

async function getAuthHeaders(auth?: AuthConfig): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

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
): (params: Record<string, unknown>) => Promise<unknown> {
  return async function execute(params: Record<string, unknown>): Promise<unknown> {
    const url = new URL(`${baseUrl}${path}`);

    const pathParams: Record<string, string> = {};
    const queryParams: Record<string, string> = {};

    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null) continue;

      if (path.includes(`{${key}}`)) {
        pathParams[key] = String(value);
      } else {
        queryParams[key] = String(value);
      }
    }

    let finalPath = path;
    for (const [key, value] of Object.entries(pathParams)) {
      finalPath = finalPath.replace(`{${key}}`, encodeURIComponent(value));
    }

    if (Object.keys(queryParams).length > 0) {
      for (const [key, value] of Object.entries(queryParams)) {
        url.searchParams.append(key, value);
      }
    }

    const bodyParams = Object.entries(params)
      .filter(([key]) => !pathParams[key] && !queryParams[key])
      .reduce((acc, [key, value]) => {
        if (value !== undefined) acc[key] = value;
        return acc;
      }, {} as Record<string, unknown>);

    const headers = await getAuthHeaders(auth);

    const fetchOptions: RequestInit = { method, headers };

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
  }
): SwaggerToolsResult {
  const baseUrl = resolveBaseUrl(spec, options.baseUrl);
  const allOps = getAllOperations(spec);
  const filteredOps = filterByTags(allOps, options.include, options.exclude);

  const tools: WebMCPToolDefinition[] = [];
  const errors: string[] = [];

  for (const { path, method, operation } of filteredOps) {
    try {
      const name = generateOperationId(operation, path, method);
      const description = buildDescription(operation);
      const { properties, required } = buildInputSchema(operation);

      const tool: MCPToolWithExecute = {
        name,
        description,
        inputSchema: {
          type: 'object',
          properties,
          required: required.length > 0 ? required : undefined,
        },
        execute: createExecute(baseUrl, path, method.toUpperCase(), options.auth),
      };

      tools.push(tool);
    } catch (err) {
      errors.push(
        `Failed to transform ${method.toUpperCase()} ${path}: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }

  return { tools, errors };
}
