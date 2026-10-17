/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the API; empty means relative `/api` paths. */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
