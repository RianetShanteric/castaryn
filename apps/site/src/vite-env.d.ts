/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CASTARYN_OIDC_URL?: string;
  readonly VITE_CASTARYN_OIDC_REALM?: string;
  readonly VITE_CASTARYN_OIDC_CLIENT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
