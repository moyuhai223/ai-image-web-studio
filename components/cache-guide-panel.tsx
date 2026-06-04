const cacheRules = [
  {
    name: "缩略图缓存",
    expression: '(http.request.uri.path wildcard "/api/images/*" and http.request.uri.query contains "thumb=1")',
    action: "Eligible for cache",
    edgeTtl: "1 day",
    browserTtl: "Respect origin 或 30 minutes",
    note: "缩略图由应用生成 WebP，并带 private cache-control。小团队私有访问下可让边缘短期缓存。"
  },
  {
    name: "原图不缓存",
    expression: '(http.request.uri.path wildcard "/api/images/*" and not http.request.uri.query contains "thumb=1")',
    action: "Bypass cache",
    edgeTtl: "-",
    browserTtl: "Bypass",
    note: "原图需要登录鉴权，且体积大。建议点击放大时从源站读取，避免用户私有图进入共享边缘缓存。"
  },
  {
    name: "生成与登录接口不缓存",
    expression: '(http.request.uri.path wildcard "/api/generate*" or http.request.uri.path wildcard "/api/auth/*" or http.request.uri.path wildcard "/api/users*")',
    action: "Bypass cache",
    edgeTtl: "-",
    browserTtl: "Bypass",
    note: "这些接口有状态、有写入、有 Cookie，必须绕过缓存。"
  },
  {
    name: "应用页面不缓存",
    expression: '(http.request.uri.path eq "/" or http.request.uri.path wildcard "/records*" or http.request.uri.path wildcard "/settings*" or http.request.uri.path wildcard "/login*")',
    action: "Bypass cache",
    edgeTtl: "-",
    browserTtl: "Bypass",
    note: "页面内容和登录态相关，避免缓存造成串号或看见旧记录。"
  },
  {
    name: "Next 静态资源缓存",
    expression: '(http.request.uri.path wildcard "/_next/static/*")',
    action: "Eligible for cache",
    edgeTtl: "1 month",
    browserTtl: "Override origin: 1 month",
    note: "Next 构建产物带 hash，适合长缓存。更新版本后 URL 会变化。"
  }
];

export function CacheGuidePanel() {
  return (
    <div className="cache-guide">
      <section className="panel">
        <div className="panel-header">
          <h2 className="panel-title">Cloudflare 缓存规则配置说明</h2>
          <span className="status">手动配置</span>
        </div>
        <div className="panel-body guide-stack">
          <p className="muted">
            这个页面只提供配置说明，不调用 Cloudflare API。推荐只缓存缩略图和 Next 静态资源；登录页面、记录页面、生成接口和原图接口保持绕过缓存。
          </p>
          <div className="notice">
            如果你的站点是私有小团队使用，最稳妥的策略是：Cloudflare 只帮助缓存 <code>?thumb=1</code> 缩略图，原图和业务接口全部 bypass。
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2 className="panel-title">手动配置步骤</h2>
        </div>
        <div className="panel-body">
          <ol className="guide-list">
            <li>进入 Cloudflare Dashboard，选择你的站点。</li>
            <li>打开 <strong>Rules</strong> → <strong>Cache Rules</strong>。</li>
            <li>点击 <strong>Create rule</strong>。</li>
            <li>选择 <strong>Custom filter expression</strong>，按下面表格逐条创建。</li>
            <li>规则顺序建议从“绕过缓存”到“允许缓存”：先放登录/生成/原图 bypass，再放缩略图和静态资源缓存。</li>
            <li>保存后访问图片列表，用浏览器 Network 或 Cloudflare 响应头检查是否命中。</li>
          </ol>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2 className="panel-title">推荐规则</h2>
        </div>
        <div className="panel-body table-wrap">
          <table className="guide-table">
            <thead>
              <tr>
                <th>规则</th>
                <th>表达式</th>
                <th>动作</th>
                <th>Edge TTL</th>
                <th>Browser TTL</th>
                <th>说明</th>
              </tr>
            </thead>
            <tbody>
              {cacheRules.map((rule) => (
                <tr key={rule.name}>
                  <td>{rule.name}</td>
                  <td>
                    <code>{rule.expression}</code>
                  </td>
                  <td>{rule.action}</td>
                  <td>{rule.edgeTtl}</td>
                  <td>{rule.browserTtl}</td>
                  <td>{rule.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2 className="panel-title">关键注意事项</h2>
        </div>
        <div className="panel-body guide-stack">
          <ul className="guide-list">
            <li>
              <strong>不要缓存</strong> <code>/api/generate</code>、<code>/api/auth/*</code>、<code>/api/users</code>、<code>/records*</code>。
            </li>
            <li>
              原图接口 <code>/api/images/&lt;id&gt;</code> 需要登录 Cookie，默认建议 bypass。缩略图可以短缓存，但不要把 Browser TTL 设太长。
            </li>
            <li>
              如果你的 Cloudflare 规则界面支持 Cache Key，保持默认包含 query string；缩略图依赖 <code>thumb=1</code>。
            </li>
            <li>
              应用自己的缩略图响应头是 <code>private, max-age=604800, immutable</code>，原图响应头是 <code>private, max-age=3600</code>。
            </li>
            <li>
              Cloudflare 文档里 Edge TTL 控制边缘缓存时间，Browser TTL 控制用户浏览器缓存时间；两者可以分别设置。
            </li>
          </ul>
          <p className="small muted">
            参考：Cloudflare Cache Rules 支持 URI Path、URI Query String、Cookie 等字段；Edge TTL 和 Browser TTL 可在 Cache Rules 中配置。
          </p>
        </div>
      </section>
    </div>
  );
}
