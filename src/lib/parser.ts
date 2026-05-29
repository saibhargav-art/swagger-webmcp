import type { ParsedOpenAPISpec, OpenAPISchema, OpenAPIOperation } from './types.js';

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function resolveRef(
  spec: ParsedOpenAPISpec,
  ref: string
): OpenAPISchema | undefined {
  const parts = ref.replace('#/', '').split('/');
  let current: unknown = spec;

  for (const part of parts) {
    if (!isObject(current)) return undefined;
    current = current[part];
  }

  return current as OpenAPISchema | undefined;
}

function resolveSchemaData(
  spec: ParsedOpenAPISpec,
  schema: unknown
): OpenAPISchema {
  if (!isObject(schema)) return schema as OpenAPISchema;

  if (schema.$ref) {
    const resolved = resolveRef(spec, schema.$ref as string);
    if (resolved) {
      return resolveSchemaData(spec, resolved);
    }
  }

  const result: OpenAPISchema = {};

  if (schema.type) result.type = schema.type as string;
  if (schema.format) result.format = schema.format as string;
  if (schema.description) result.description = schema.description as string;
  if (schema.enum) result.enum = schema.enum as unknown[];

  if (schema.properties) {
    result.properties = {};
    for (const [key, prop] of Object.entries(schema.properties as Record<string, unknown>)) {
      result.properties[key] = resolveSchemaData(spec, prop);
    }
  }

  if (schema.items) {
    result.items = resolveSchemaData(spec, schema.items);
  }

  if (schema.allOf) {
    const merged: OpenAPISchema = { type: 'object', properties: {} };
    const allOf = schema.allOf as unknown[];
    for (const subSchema of allOf) {
      const resolved = resolveSchemaData(spec, subSchema);
      if (resolved.properties) {
        merged.properties = { ...merged.properties, ...resolved.properties };
      }
      if (resolved.required) {
        merged.required = [...(merged.required || []), ...resolved.required];
      }
    }
    return merged;
  }

  if (schema.anyOf || schema.oneOf) {
    const schemas = (schema.anyOf || schema.oneOf) as unknown[];
    const firstWithProps = schemas.find((s) => isObject(s) && (s as Record<string, unknown>).properties);
    if (firstWithProps) {
      return resolveSchemaData(spec, firstWithProps);
    }
  }

  return result;
}

function resolveOperation(
  spec: ParsedOpenAPISpec,
  operation: Record<string, unknown>
): OpenAPIOperation {
  const resolved: OpenAPIOperation = {};

  if (operation.operationId) resolved.operationId = operation.operationId as string;
  if (operation.summary) resolved.summary = operation.summary as string;
  if (operation.description) resolved.description = operation.description as string;
  if (operation.tags) resolved.tags = operation.tags as string[];

  if (operation.parameters) {
    resolved.parameters = (operation.parameters as unknown[]).map((p) => {
      const param = p as Record<string, unknown>;
      return {
        name: param.name as string,
        in: param.in as 'path' | 'query' | 'header' | 'cookie',
        required: param.required as boolean | undefined,
        description: param.description as string | undefined,
        schema: param.schema ? resolveSchemaData(spec, param.schema) : undefined,
      };
    });
  }

  if (operation.requestBody) {
    const body = operation.requestBody as Record<string, unknown>;
    resolved.requestBody = {
      required: body.required as boolean | undefined,
      description: body.description as string | undefined,
      content: undefined,
    };

    if (body.content) {
      const content = body.content as Record<string, unknown>;
      if (content['application/json']) {
        const jsonContent = content['application/json'] as Record<string, unknown>;
        resolved.requestBody.content = {
          'application/json': {
            schema: jsonContent.schema ? resolveSchemaData(spec, jsonContent.schema) : undefined,
          },
        };
      }
    }
  }

  // Preserve OpenAPI vendor extensions like x-webmcp-scopes / x-webmcp-roles
  for (const [key, value] of Object.entries(operation)) {
    if (key.startsWith('x-')) {
      (resolved as Record<string, unknown>)[key] = value;
    }
  }

  return resolved;
}

export async function parseSpec(
  spec: string | object,
  _options?: { baseUrl?: string }
): Promise<ParsedOpenAPISpec> {
  let specData: unknown;

  if (typeof spec === 'string') {
    if (spec.startsWith('http://') || spec.startsWith('https://')) {
      const response = await fetch(spec);
      if (!response.ok) {
        throw new Error(`Failed to fetch spec: ${response.status} ${response.statusText}`);
      }
      specData = await response.json();
    } else if (typeof window !== 'undefined' && spec.startsWith('/')) {
      const response = await fetch(spec);
      if (!response.ok) {
        throw new Error(`Failed to fetch spec: ${response.status} ${response.statusText}`);
      }
      specData = await response.json();
    } else {
      specData = JSON.parse(spec);
    }
  } else {
    specData = spec;
  }

  const parsed = specData as ParsedOpenAPISpec;

  if (!parsed.paths) {
    throw new Error('Invalid OpenAPI spec: missing paths');
  }

  for (const [path, pathItem] of Object.entries(parsed.paths)) {
    for (const [method, operation] of Object.entries(pathItem)) {
      if (['get', 'post', 'put', 'patch', 'delete', 'options', 'head'].includes(method)) {
        parsed.paths[path][method] = resolveOperation(parsed, operation as Record<string, unknown>);
      }
    }
  }

  return parsed;
}

export function resolveBaseUrl(
  spec: ParsedOpenAPISpec,
  providedBaseUrl?: string
): string {
  if (providedBaseUrl) {
    return providedBaseUrl.replace(/\/$/, '');
  }

  if (spec.servers && spec.servers.length > 0) {
    return spec.servers[0].url.replace(/\/$/, '');
  }

  return '';
}

export function getAllOperations(spec: ParsedOpenAPISpec): {
  path: string;
  method: string;
  operation: OpenAPIOperation;
}[] {
  const operations: {
    path: string;
    method: string;
    operation: OpenAPIOperation;
  }[] = [];

  const httpMethods = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head'];

  for (const [path, pathItem] of Object.entries(spec.paths || {})) {
    for (const [method, operation] of Object.entries(pathItem)) {
      if (httpMethods.includes(method)) {
        operations.push({
          path,
          method,
          operation,
        });
      }
    }
  }

  return operations;
}
