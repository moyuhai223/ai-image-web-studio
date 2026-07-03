import path from "node:path";

// 全局安全响应头。CSP 仅用不影响脚本/样式执行的安全指令(frame-ancestors 防点击劫持、
// base-uri 防 <base> 注入、object-src 禁插件),不加 script-src/style-src——那需要 nonce 接线
// 否则会打断 Next 的内联注入,留待后续。X-Content-Type-Options/HSTS Next 或反代已发,这里补齐其余。
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), browsing-topics=()" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'" }
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  turbopack: {
    root: path.resolve(".")
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "25mb"
    }
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  }
};

export default nextConfig;
