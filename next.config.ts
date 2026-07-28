import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // 产出自包含的最小运行时（.next/standalone/server.js），供 Docker 容器部署。
  // CloudBase 云托管等容器环境用 `node server.js` 直接启动，无需完整 node_modules。
  output: 'standalone',
};

export default nextConfig;
