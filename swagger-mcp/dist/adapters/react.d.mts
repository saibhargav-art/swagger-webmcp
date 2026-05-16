import * as react_jsx_runtime from 'react/jsx-runtime';
import { ReactNode } from 'react';
import { S as SwaggerToolsOptions, g as WebMCPToolDefinition } from '../types-DnCZNaZE.mjs';

interface SwaggerToolsContextValue {
    tools: WebMCPToolDefinition[];
    loading: boolean;
    error: Error | null;
    refetch: () => Promise<void>;
}
interface SwaggerToolsProviderProps extends SwaggerToolsOptions {
    children: ReactNode;
}
declare function SwaggerToolsProvider({ children, spec, baseUrl, auth, include, exclude, enricher, }: SwaggerToolsProviderProps): react_jsx_runtime.JSX.Element;
declare function useSwaggerTools(): SwaggerToolsContextValue;

export { SwaggerToolsProvider, useSwaggerTools };
