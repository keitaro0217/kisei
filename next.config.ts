import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // データベースドライバーはバンドルせず Node.js から直接読み込む（PGlite は WASM を含むため）
  serverExternalPackages: ['@electric-sql/pglite', 'postgres'],
};

export default nextConfig;
