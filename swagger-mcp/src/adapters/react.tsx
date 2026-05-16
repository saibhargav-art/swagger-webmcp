import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { registerSwaggerTools } from '../lib/registry.js';
import type {
  SwaggerToolsOptions,
  SwaggerToolsResult,
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
  refetch: async () => {},
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
