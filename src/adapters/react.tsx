import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  registerSwaggerTools,
  unregisterSwaggerTools,
  swapToolScope,
  executeSwaggerTool,
  getRegisteredTools,
  getToolAvailabilityStatus,
  getLastDiagnostics,
} from '../lib/registry.js';
import type {
  SwaggerToolsOptions,
  SwaggerToolsScope,
  WebMCPToolDefinition,
  ToolRegistrationDiagnostics,
  ToolSkipReason,
  FilteredToolInfo,
} from '../lib/types.js';

// Re-export types for frontend use
export type {
  SwaggerToolsScope,
  SwaggerToolsOptions,
  WebMCPToolDefinition,
  ToolRegistrationDiagnostics,
  ToolSkipReason,
  FilteredToolInfo,
};

export { executeSwaggerTool };

interface SwaggerToolsContextValue {
  tools: WebMCPToolDefinition[];
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

export interface RouteToolsResult {
  loading: boolean;
  error: Error | null;
  registeredNames: string[];
  authorizedNames: string[]; // tools currently authorized for execution
  diagnostics?: ToolRegistrationDiagnostics;
}

const SwaggerToolsContext = createContext<SwaggerToolsContextValue>({
  tools: [],
  loading: false,
  error: null,
  refetch: async () => { },
});

interface SwaggerToolsProviderProps extends SwaggerToolsOptions {
  children: ReactNode;
}

export function SwaggerToolsProvider({
  children,
  spec,
  baseUrl,
  auth,
  include,
  exclude,
  enricher,
}: SwaggerToolsProviderProps) {
  const [tools, setTools] = useState<WebMCPToolDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const loadTools = async () => {
    setLoading(true);
    setError(null);

    try {
      const result = await registerSwaggerTools({
        spec,
        baseUrl,
        auth,
        include,
        exclude,
        enricher,
      });
      setTools(result.tools);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTools();
  }, [spec, baseUrl, getAuthFingerprint(auth), JSON.stringify(include), JSON.stringify(exclude)]);

  return (
    <SwaggerToolsContext.Provider
      value={{ tools, loading, error, refetch: loadTools }}
    >
      {children}
    </SwaggerToolsContext.Provider>
  );
}

export function useSwaggerTools(): SwaggerToolsContextValue {
  return useContext(SwaggerToolsContext);
}

function getAuthFingerprint(auth?: SwaggerToolsOptions['auth']): string {
  if (!auth) return '';

  if (auth.type === 'bearer') {
    const token = typeof auth.token === 'function' ? 'fn' : auth.token;
    return `bearer:${token}`;
  }

  if (auth.type === 'apiKey') {
    const value = typeof auth.value === 'function' ? 'fn' : auth.value;
    return `apiKey:${auth.header}:${value}`;
  }

  if (auth.type === 'session') {
    return `session:${auth.credentials ?? 'include'}`;
  }

  return '';
}

export function useRouteTools(
  scope: SwaggerToolsScope,
  options: Omit<SwaggerToolsOptions, 'include' | 'allowedScopes' | 'requiredRoles' | 'scopeMode' | 'roleMode' | 'secureMode'>
): RouteToolsResult {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [registeredNames, setRegisteredNames] = useState<string[]>([]);
  const [authorizedNames, setAuthorizedNames] = useState<string[]>([]);
  const [diagnostics, setDiagnostics] = useState<ToolRegistrationDiagnostics | undefined>(undefined);

  const registeredNamesRef = useRef<string[]>([]);

  const authFingerprint = getAuthFingerprint(options.auth);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      setLoading(true);
      setError(null);

      try {
        const result = await swapToolScope(
          {
            ...options,
            include: scope.tags,
            allowedScopes: scope.allowedScopes,
            requiredRoles: scope.requiredRoles,
            scopeMode: scope.scopeMode,
            roleMode: scope.roleMode,
            scopeRegistrationMode: scope.scopeRegistrationMode,
            secureMode: scope.secureMode,
          },
          scope.key
        );

        if (cancelled) return;

        const names = result.tools.map((t) => t.name);
        const authorized = result.tools.filter((t) => t.securityMetadata?.authorized).map((t) => t.name);
        registeredNamesRef.current = names;
        setRegisteredNames(names);
        setAuthorizedNames(authorized);
        setDiagnostics(result.diagnostics);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err : new Error(String(err)));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    run();

    return () => {
      cancelled = true;
      if (registeredNamesRef.current.length > 0) {
        unregisterSwaggerTools(registeredNamesRef.current).catch(() => {
          // ignore unregister failures on unmount
        });
      }
    };
  }, [
    scope.key,
    JSON.stringify(scope.tags),
    JSON.stringify(scope.allowedScopes),
    JSON.stringify(scope.requiredRoles),
    scope.scopeMode,
    scope.roleMode,
    scope.scopeRegistrationMode,
    scope.secureMode,
    options.baseUrl,
    options.spec,
    authFingerprint,
  ]);

  return { loading, error, registeredNames, authorizedNames, diagnostics };
}

export function useRegisteredTools(pollIntervalMs = 500): string[] {
  const [names, setNames] = useState<string[]>(() => getRegisteredTools());

  useEffect(() => {
    const id = setInterval(() => {
      setNames(getRegisteredTools());
    }, pollIntervalMs);
    return () => clearInterval(id);
  }, [pollIntervalMs]);

  return names;
}

// Re-export diagnostic functions for frontend access
export { getToolAvailabilityStatus, getLastDiagnostics };
