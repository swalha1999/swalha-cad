import type { ReactNode } from 'react';
import { createContext, useContext } from 'react';
import type { StoreApi } from 'zustand';
import { useStore } from 'zustand';
import type { CadStoreState } from './cad-store.js';

const CadStoreContext = createContext<StoreApi<CadStoreState> | null>(null);

export interface CadStoreProviderProps {
  store: StoreApi<CadStoreState>;
  children: ReactNode;
}

export function CadStoreProvider({ store, children }: CadStoreProviderProps) {
  return <CadStoreContext.Provider value={store}>{children}</CadStoreContext.Provider>;
}

function useCadStoreApiOrThrow(): StoreApi<CadStoreState> {
  const store = useContext(CadStoreContext);
  if (!store) {
    throw new Error('useCadStore must be used within a CadStoreProvider');
  }
  return store;
}

/** Reads/subscribes to the {@link CadStoreProvider}'s store; each test can provide its own isolated instance. */
export function useCadStore<T>(selector: (state: CadStoreState) => T): T {
  return useStore(useCadStoreApiOrThrow(), selector);
}

/** Imperative access (`getState`/`setState`) for code that must read the store without subscribing to it, e.g. a mount-only effect. */
export function useCadStoreApi(): StoreApi<CadStoreState> {
  return useCadStoreApiOrThrow();
}
