/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 참여자 화면(Vercel) 주소. 운영 화면에서 '참여자 화면 보기' 링크에 쓴다. */
  readonly VITE_PUBLIC_APP_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
