"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var src_exports = {};
__export(src_exports, {
  parseSpec: () => parseSpec,
  registerSwaggerTools: () => registerSwaggerTools,
  transformSpec: () => transformSpec
});
module.exports = __toCommonJS(src_exports);

// src/lib/parser.ts
function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function resolveRef(spec, ref) {
  const parts = ref.replace("#/", "").split("/");
  let current = spec;
  for (const part of parts) {
    if (!isObject(current)) return void 0;
    current = current[part];
  }
  return current;
}
function resolveSchemaData(spec, schema) {
  if (!isObject(schema)) return schema;
  if (schema.$ref) {
    const resolved = resolveRef(spec, schema.$ref);
    if (resolved) {
      return resolveSchemaData(spec, resolved);
    }
  }
  const result = {};
  if (schema.type) result.type = schema.type;
  if (schema.format) result.format = schema.format;
  if (schema.description) result.description = schema.description;
  if (schema.enum) result.enum = schema.enum;
  if (schema.properties) {
    result.properties = {};
    for (const [key, prop] of Object.entries(schema.properties)) {
      result.properties[key] = resolveSchemaData(spec, prop);
    }
  }
  if (schema.items) {
    result.items = resolveSchemaData(spec, schema.items);
  }
  if (schema.allOf) {
    const merged = { type: "object", properties: {} };
    const allOf = schema.allOf;
    for (const subSchema of allOf) {
      const resolved = resolveSchemaData(spec, subSchema);
      if (resolved.properties) {
        merged.properties = { ...merged.properties, ...resolved.properties };
      }
      if (resolved.required) {
        merged.required = [...merged.required || [], ...resolved.required];
      }
    }
    return merged;
  }
  if (schema.anyOf || schema.oneOf) {
    const schemas = schema.anyOf || schema.oneOf;
    const firstWithProps = schemas.find((s) => isObject(s) && s.properties);
    if (firstWithProps) {
      return resolveSchemaData(spec, firstWithProps);
    }
  }
  return result;
}
function resolveOperation(spec, operation) {
  const resolved = {};
  if (operation.operationId) resolved.operationId = operation.operationId;
  if (operation.summary) resolved.summary = operation.summary;
  if (operation.description) resolved.description = operation.description;
  if (operation.tags) resolved.tags = operation.tags;
  if (operation.parameters) {
    resolved.parameters = operation.parameters.map((p) => {
      const param = p;
      return {
        name: param.name,
        in: param.in,
        required: param.required,
        description: param.description,
        schema: param.schema ? resolveSchemaData(spec, param.schema) : void 0
      };
    });
  }
  if (operation.requestBody) {
    const body = operation.requestBody;
    resolved.requestBody = {
      required: body.required,
      description: body.description,
      content: void 0
    };
    if (body.content) {
      const content = body.content;
      if (content["application/json"]) {
        const jsonContent = content["application/json"];
        resolved.requestBody.content = {
          "application/json": {
            schema: jsonContent.schema ? resolveSchemaData(spec, jsonContent.schema) : void 0
          }
        };
      }
    }
  }
  return resolved;
}
async function parseSpec(spec, _options) {
  let specData;
  if (typeof spec === "string") {
    if (spec.startsWith("http://") || spec.startsWith("https://")) {
      const response = await fetch(spec);
      if (!response.ok) {
        throw new Error(`Failed to fetch spec: ${response.status} ${response.statusText}`);
      }
      specData = await response.json();
    } else if (typeof window !== "undefined" && spec.startsWith("/")) {
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
  const parsed = specData;
  if (!parsed.paths) {
    throw new Error("Invalid OpenAPI spec: missing paths");
  }
  for (const [path, pathItem] of Object.entries(parsed.paths)) {
    for (const [method, operation] of Object.entries(pathItem)) {
      if (["get", "post", "put", "patch", "delete", "options", "head"].includes(method)) {
        parsed.paths[path][method] = resolveOperation(parsed, operation);
      }
    }
  }
  return parsed;
}
function resolveBaseUrl(spec, providedBaseUrl) {
  if (providedBaseUrl) {
    return providedBaseUrl.replace(/\/$/, "");
  }
  if (spec.servers && spec.servers.length > 0) {
    return spec.servers[0].url.replace(/\/$/, "");
  }
  return "";
}
function getAllOperations(spec) {
  const operations = [];
  const httpMethods = ["get", "post", "put", "patch", "delete", "options", "head"];
  for (const [path, pathItem] of Object.entries(spec.paths || {})) {
    for (const [method, operation] of Object.entries(pathItem)) {
      if (httpMethods.includes(method)) {
        operations.push({
          path,
          method,
          operation
        });
      }
    }
  }
  return operations;
}

// src/lib/transformer.ts
function generateOperationId(operation, path, method) {
  if (operation.operationId) {
    return operation.operationId.replace(/[^a-zA-Z0-9_]/g, "_");
  }
  const cleanPath = path.replace(/^\//, "").replace(/\//g, "_").replace(/[{}]/g, "").replace(/[^a-zA-Z0-9_]/g, "_");
  return `${method}_${cleanPath}`.toLowerCase();
}
function extractProperties(schema) {
  const props = {};
  if (schema.properties) {
    for (const [name, prop] of Object.entries(schema.properties)) {
      const typedProp = prop;
      const propDef = {
        type: typedProp.type || "object"
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
function buildInputSchema(operation) {
  const properties = {};
  const required = [];
  for (const param of operation.parameters || []) {
    if (param.in === "path" || param.in === "query") {
      const prop = {
        type: param.schema?.type || "string"
      };
      if (param.description) prop.description = param.description;
      if (param.schema?.format) prop.format = param.schema.format;
      if (param.schema?.enum) prop.enum = param.schema.enum;
      properties[param.name] = prop;
      if (param.required) required.push(param.name);
    }
  }
  const bodySchema = operation.requestBody?.content?.["application/json"]?.schema;
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
function buildDescription(operation) {
  if (operation.summary && operation.description) {
    return `${operation.summary}

${operation.description}`;
  }
  if (operation.summary) return operation.summary;
  if (operation.description) return operation.description;
  return "No description available";
}
function filterByTags(operations, include, exclude) {
  let filtered = operations;
  if (include && include.length > 0) {
    filtered = filtered.filter(
      (op) => op.operation.tags?.some((tag) => include.includes(tag))
    );
  }
  if (exclude && exclude.length > 0) {
    filtered = filtered.filter(
      (op) => !op.operation.tags?.some((tag) => exclude.includes(tag))
    );
  }
  return filtered;
}
async function getAuthHeaders(auth) {
  const headers = {
    "Content-Type": "application/json"
  };
  if (!auth) return headers;
  if (auth.type === "bearer") {
    const token = typeof auth.token === "function" ? await auth.token() : auth.token;
    headers["Authorization"] = `Bearer ${token}`;
  } else if (auth.type === "apiKey") {
    const value = typeof auth.value === "function" ? await auth.value() : auth.value;
    headers[auth.header] = value;
  }
  return headers;
}
function createExecute(baseUrl, path, method, auth) {
  return async function execute(params) {
    const url = new URL(`${baseUrl}${path}`);
    const pathParams = {};
    const queryParams = {};
    for (const [key, value] of Object.entries(params)) {
      if (value === void 0 || value === null) continue;
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
    const bodyParams = Object.entries(params).filter(([key]) => !pathParams[key] && !queryParams[key]).reduce((acc, [key, value]) => {
      if (value !== void 0) acc[key] = value;
      return acc;
    }, {});
    const headers = await getAuthHeaders(auth);
    const fetchOptions = { method, headers };
    if (["POST", "PUT", "PATCH"].includes(method) && Object.keys(bodyParams).length > 0) {
      fetchOptions.body = JSON.stringify(bodyParams);
    }
    const response = await fetch(url.toString(), fetchOptions);
    if (!response.ok) {
      let errorBody;
      try {
        errorBody = await response.json();
      } catch {
        errorBody = await response.text();
      }
      throw new Error(`HTTP ${response.status}: ${JSON.stringify(errorBody)}`);
    }
    const contentType = response.headers.get("content-type");
    if (contentType?.includes("application/json")) {
      return response.json();
    }
    return response.text();
  };
}
function transformSpec(spec, options) {
  const baseUrl = resolveBaseUrl(spec, options.baseUrl);
  const allOps = getAllOperations(spec);
  const filteredOps = filterByTags(allOps, options.include, options.exclude);
  const tools = [];
  const errors = [];
  for (const { path, method, operation } of filteredOps) {
    try {
      const name = generateOperationId(operation, path, method);
      const description = buildDescription(operation);
      const { properties, required } = buildInputSchema(operation);
      const tool = {
        name,
        description,
        inputSchema: {
          type: "object",
          properties,
          required: required.length > 0 ? required : void 0
        },
        execute: createExecute(baseUrl, path, method.toUpperCase(), options.auth)
      };
      tools.push(tool);
    } catch (err) {
      errors.push(
        `Failed to transform ${method.toUpperCase()} ${path}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
  return { tools, errors };
}

// src/lib/registry.ts
function injectJsonLdFallback(tools) {
  if (typeof document === "undefined") return;
  const existingScript = document.querySelector("script[data-swagger-webmcp-jsonld]");
  if (existingScript) existingScript.remove();
  const jsonLd = {
    "@context": "https://modelcontextprotocol.io/schema/2024-11/tool",
    "@type": "ToolCollection",
    hasTool: tools.map((tool) => ({
      "@type": "Tool",
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema
    }))
  };
  const script = document.createElement("script");
  script.type = "application/ld+json";
  script.setAttribute("data-swagger-webmcp-jsonld", "true");
  script.textContent = JSON.stringify(jsonLd, null, 2);
  document.head.appendChild(script);
}
function isModelContextAvailable() {
  return typeof navigator !== "undefined" && "modelContext" in navigator;
}
async function registerTools(tools) {
  if (isModelContextAvailable()) {
    const nav = navigator;
    for (const tool of tools) {
      await nav.modelContext.registerTool(tool);
    }
  } else {
    injectJsonLdFallback(tools);
  }
}
async function enrichDescriptions(tools, config) {
  const apiKey = typeof config.apiKey === "function" ? await config.apiKey() : config.apiKey;
  const results = [];
  for (const tool of tools) {
    try {
      if (config.provider === "anthropic") {
        const response = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
            "anthropic-dangerous-direct-browser-access": "true"
          },
          body: JSON.stringify({
            model: config.model || "claude-3-5-haiku-20241022",
            max_tokens: 300,
            messages: [
              {
                role: "user",
                content: `Improve this API description for an AI agent. Be concise and informative.

${tool.description}

Return ONLY the improved description.`
              }
            ]
          })
        });
        if (response.ok) {
          const data = await response.json();
          results.push(data.content[0]?.text || tool.description);
        } else {
          results.push(tool.description);
        }
      } else {
        const response = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            model: config.model || "gpt-4o-mini",
            max_tokens: 300,
            messages: [
              {
                role: "system",
                content: "Improve API descriptions for AI agents. Return ONLY the improved description."
              },
              {
                role: "user",
                content: tool.description
              }
            ]
          })
        });
        if (response.ok) {
          const data = await response.json();
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
async function registerSwaggerTools(options) {
  const spec = await parseSpec(options.spec, { baseUrl: options.baseUrl });
  const result = transformSpec(spec, {
    auth: options.auth,
    include: options.include,
    exclude: options.exclude,
    baseUrl: options.baseUrl
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
  await registerTools(result.tools);
  console.log(
    `%c[swagger-webmcp] Registered ${result.tools.length} tools`,
    "color: #10b981; font-weight: bold; font-size: 14px;"
  );
  console.log(
    "%c[swagger-webmcp] Registered tools:",
    "color: #10b981; font-weight: bold;"
  );
  result.tools.forEach((tool) => {
    console.log(`  %c${tool.name}`, "color: #3b82f6; font-weight: bold;", {
      description: tool.description,
      inputSchema: tool.inputSchema
    });
  });
  return result;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  parseSpec,
  registerSwaggerTools,
  transformSpec
});
//# sourceMappingURL=index.js.map