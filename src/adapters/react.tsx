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
  getRegisteredTools,
} from '../lib/registry.js';
import type {
  SwaggerToolsOptions,
  SwaggerToolsScope,
  WebMCPToolDefinition,
} from '../lib/types.js';

interface SwaggerToolsContextValue {
  tools: WebMCPToolDefinition[];
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
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
      if (result.errors.length > 0) {
        console.warn('Swagger tools registration warnings:', result.errors);
      }
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTools();
  }, [spec, baseUrl, JSON.stringify(auth), JSON.stringify(include), JSON.stringify(exclude)]);

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

export function useRouteTools(
  scope: SwaggerToolsScope,
  options: Omit<SwaggerToolsOptions, 'include'>
): { loading: boolean; error: Error | null; registeredNames: string[] } {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [registeredNames, setRegisteredNames] = useState<string[]>([]);

  const registeredNamesRef = useRef<string[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      setLoading(true);
      setError(null);

      try {
        const result = await swapToolScope(
          { ...options, include: scope.tags },
          scope.key
        );

        if (cancelled) return;

        const names = result.tools.map((t) => t.name);
        registeredNamesRef.current = names;
        setRegisteredNames(names);

        if (result.errors.length > 0) {
          console.warn('[swagger-webmcp] useRouteTools warnings:', result.errors);
        }
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
        unregisterSwaggerTools(registeredNamesRef.current).catch((err) => {
          console.warn('[swagger-webmcp] Failed to unregister tools on unmount:', err);
        });
      }
    };
  }, [scope.key, options.baseUrl, options.spec, JSON.stringify(options.auth)]);

  return { loading, error, registeredNames };
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
