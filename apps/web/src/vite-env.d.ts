/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Render (or other) API origin when the web app is hosted separately. */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
