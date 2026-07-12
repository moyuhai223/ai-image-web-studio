"use client";

import { useEffect, useState } from "react";
import { ChevronDown, PanelLeftClose } from "lucide-react";
import { normalizeImageSize } from "@/lib/image-size";
import { useStudio } from "./studio-provider";

/**
 * 左栏参数面板:常用(模型/尺寸/数量)+ 高级折叠区(线路/自定义宽高/局部重绘合成开关)。
 * 尺寸选「自定义…」时自动展开高级区(宽高输入在那里)。
 */
export function ParamPanel({ onCollapse }: { onCollapse: () => void }) {
  const studio = useStudio();
  const {
    dedupedModels,
    servingGroups,
    model,
    setModel,
    groupId,
    setGroupId,
    size,
    setSize,
    customWidth,
    setCustomWidth,
    customHeight,
    setCustomHeight,
    count,
    setCount,
    maskBlob,
    maskComposite,
    setMaskComposite
  } = studio;

  const [advancedOpen, setAdvancedOpen] = useState(false);
  // 自定义尺寸的宽高输入放在高级区;选中「自定义…」时自动展开,避免用户找不到输入框。
  useEffect(() => {
    if (size === "custom") setAdvancedOpen(true);
  }, [size]);

  const hasAdvanced = servingGroups.length > 1 || size === "custom" || Boolean(maskBlob);

  return (
    <section className="panel studio-panel studio-param-panel">
      <div className="panel-header">
        <h1 className="panel-title">参数</h1>
        <button className="status studio-collapse-btn" type="button" onClick={onCollapse} title="收起参数面板" aria-label="收起参数面板">
          <PanelLeftClose size={15} />
        </button>
      </div>
      <div className="panel-body studio-panel-body form-stack">
        <div className="field">
          <label htmlFor="model">模型</label>
          {dedupedModels.length > 0 ? (
            <select
              className="select"
              id="model"
              value={model}
              onChange={(event) => {
                setModel(event.target.value);
                setGroupId(""); // 换模型后线路回到自动轮询
              }}
            >
              {dedupedModels.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          ) : (
            <p className="small muted" style={{ margin: 0 }}>
              还没有配置模型组,请到 <a href="/settings#settings-groups">设置 → 模型组</a> 添加。
            </p>
          )}
        </div>

        <div className="field">
          <label htmlFor="size">尺寸</label>
          <select className="select" id="size" value={size} onChange={(event) => setSize(event.target.value)}>
            <option value="auto">自动 - auto</option>
            <option value="1024x1024">1:1 - 1024x1024</option>
            <option value="1024x1824">纵向 9:16 - 1024x1824</option>
            <option value="1824x1024">横向 16:9 - 1824x1024</option>
            <option value="1360x1024">横向 4:3 - 1360x1024</option>
            <option value="1024x1360">纵向 3:4 - 1024x1360</option>
            <option value="2080x1472">A4 横向 2K - 2080x1472</option>
            <option value="1472x2080">A4 纵向 2K - 1472x2080</option>
            <option value="2880x2880">1:1 4K - 2880x2880</option>
            <option value="3840x2160">横向 16:9 4K - 3840x2160</option>
            <option value="2160x3840">纵向 9:16 4K - 2160x3840</option>
            <option value="3264x2448">横向 4:3 4K - 3264x2448</option>
            <option value="2448x3264">纵向 3:4 4K - 2448x3264</option>
            <option value="3424x2416">A4 横向 4K - 3424x2416</option>
            <option value="2416x3424">A4 纵向 4K - 2416x3424</option>
            <option value="custom">自定义…</option>
          </select>
        </div>

        <div className="field">
          <label htmlFor="count">数量</label>
          <select className="select" id="count" value={count} onChange={(event) => setCount(event.target.value)}>
            <option value="1">1 张</option>
            <option value="2">2 张</option>
            <option value="3">3 张</option>
            <option value="4">4 张</option>
          </select>
        </div>

        {hasAdvanced ? (
          <div className="studio-advanced">
            <button
              className="form-section-title reference-section-toggle"
              type="button"
              aria-expanded={advancedOpen}
              aria-controls="studio-advanced-body"
              onClick={() => setAdvancedOpen((current) => !current)}
            >
              <span>高级</span>
              <span className="reference-section-toggle-meta">
                <span className="status action-button action-neutral reference-section-toggle-status">
                  <ChevronDown size={14} />
                  {advancedOpen ? "收起" : "展开"}
                </span>
              </span>
            </button>
            {advancedOpen ? (
              <div className="form-stack" id="studio-advanced-body">
                {servingGroups.length > 1 ? (
                  <div className="field">
                    <label htmlFor="model-route">线路</label>
                    <select
                      className="select"
                      id="model-route"
                      value={groupId}
                      onChange={(event) => setGroupId(event.target.value)}
                    >
                      <option value="">自动轮询({servingGroups.length} 条线路)</option>
                      {servingGroups.map((g) => (
                        <option key={g.groupId} value={g.groupId}>
                          {g.groupName}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}
                {size === "custom" ? (
                  <div className="field">
                    <label>自定义尺寸</label>
                    <div className="custom-size-row">
                      <input
                        className="input"
                        type="number"
                        min={256}
                        max={3840}
                        step={16}
                        value={customWidth}
                        onChange={(event) => setCustomWidth(event.target.value)}
                        aria-label="自定义宽度（像素）"
                        placeholder="宽"
                      />
                      <span className="custom-size-x">×</span>
                      <input
                        className="input"
                        type="number"
                        min={256}
                        max={3840}
                        step={16}
                        value={customHeight}
                        onChange={(event) => setCustomHeight(event.target.value)}
                        aria-label="自定义高度（像素）"
                        placeholder="高"
                      />
                      <span className="small muted custom-size-hint">→ {normalizeImageSize(`${customWidth}x${customHeight}`)}（自动取 16 倍数 / 限 4K）</span>
                    </div>
                  </div>
                ) : null}
                {maskBlob ? (
                  <label
                    className="small muted mask-composite-toggle"
                    title="开:出图后把编辑区贴回原图高清版,蒙版外像素零变化;关:直接用模型返回的编辑图(整图重绘,分辨率随模型)"
                  >
                    <input
                      type="checkbox"
                      checked={maskComposite}
                      onChange={(event) => setMaskComposite(event.target.checked)}
                    />
                    局部重绘:合成回原图(保留原清晰度)
                  </label>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
