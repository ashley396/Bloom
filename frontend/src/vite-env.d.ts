/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FLORISYN_API?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module "*.css" {}
