/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_GOOGLE_WEB_CLIENT_ID?: string;
  readonly VITE_ADMOB_BANNER_UNIT_ID?: string;
  readonly VITE_USE_MOCK_BACKEND?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
