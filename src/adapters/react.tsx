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
  SwaggerToolsResult,
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

// ─── Route-Scoped Hook ────────────────────────────────────────────────────────

/**
 * useRouteTools — registers tools scoped to a route, unregisters on unmount.
 *
 * Standard usage: call at the top of a page component.
 * On mount  → swaps to this scope (unregisters previous, registers these tags).
 * On unmount → unregisters only the tools this hook registered.
 *
 * The swap is a no-op if the same scopeKey is already active (e.g. navigating
 * between /users and /users/123 — both use scope 'users', no re-registration).
 *
 * @param scope   - { key: 'users', tags: ['users'] }
 * @param options - SwaggerToolsOptions (spec, baseUrl, auth, etc.)
 *
 * @example
 *   function UsersPage() {
 *     const { loading, error } = useRouteTools(
 *       { key: 'users', tags: ['users'] },
 *       { spec: openApiSpec, baseUrl: 'https://api.example.com' }
 *     );
 *     if (loading) return <div>Registering tools...</div>;
 *   }
 */
export function useRouteTools(
  scope: SwaggerToolsScope,
  options: Omit<SwaggerToolsOptions, 'include'>
): { loading: boolean; error: Error | null; registeredNames: string[] } {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [registeredNames, setRegisteredNames] = useState<string[]>([]);

  // Keep a ref so the cleanup function always has the latest registered names
  // even if the component re-renders before unmount.
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
      // Mark as cancelled so async result doesn't update unmounted component
      cancelled = true;

      // Unregister only the tools this hook registered, not everything.
      // This is intentional: if a parent registered global tools before this
      // hook, we don't want to nuke them.
      if (registeredNamesRef.current.length > 0) {
        unregisterSwaggerTools(registeredNamesRef.current).catch((err) => {
          console.warn('[swagger-webmcp] Failed to unregister tools on unmount:', err);
        });
      }
    };
    // Re-run only if the scope key or base options change.
    // scope.key is the stable signal — not the tags array reference.
  }, [scope.key, options.baseUrl, options.spec, JSON.stringify(options.auth)]);

  return { loading, error, registeredNames };
}

// ─── Debug Hook ───────────────────────────────────────────────────────────────

/**
 * useRegisteredTools — returns the live list of registered tool names.
 * Polls the internal registry on an interval (default 500ms).
 * Use this in a debug panel to show what's currently registered.
 *
 * @example
 *   function ToolDebugPanel() {
 *     const tools = useRegisteredTools();
 *     return <pre>{JSON.stringify(tools, null, 2)}</pre>;
 *   }
 */
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
