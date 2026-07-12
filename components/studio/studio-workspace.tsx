"use client";

import { useState } from "react";
import { PanelLeftOpen, PanelRightOpen } from "lucide-react";
import { CanvasPanel } from "./canvas-panel";
import { ContextPanel } from "./context-panel";
import { ParamPanel } from "./param-panel";
import { PromptComposer } from "./prompt-composer";
import { StudioProvider, type StudioProviderProps } from "./studio-provider";

/**
 * Studio Console 壳:三栏(参数 | 画布 | 上下文)+ 底部 Prompt Composer。
 * 左右面板可折叠(V1 仅会话内记忆,V3 加 localStorage 持久化)。
 */
export function StudioWorkspace(props: StudioProviderProps) {
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);

  return (
    <StudioProvider {...props}>
      <div
        className="studio"
        data-left={leftCollapsed ? "collapsed" : "expanded"}
        data-right={rightCollapsed ? "collapsed" : "expanded"}
      >
        <div className="studio-col studio-left">
          {leftCollapsed ? (
            <div className="studio-rail">
              <button
                className="status studio-collapse-btn"
                type="button"
                onClick={() => setLeftCollapsed(false)}
                title="展开参数面板"
                aria-label="展开参数面板"
              >
                <PanelLeftOpen size={15} />
              </button>
              <span className="studio-rail-label">参数</span>
            </div>
          ) : (
            <ParamPanel onCollapse={() => setLeftCollapsed(true)} />
          )}
        </div>
        <div className="studio-col studio-center">
          <CanvasPanel />
        </div>
        <div className="studio-col studio-context">
          {rightCollapsed ? (
            <div className="studio-rail">
              <button
                className="status studio-collapse-btn"
                type="button"
                onClick={() => setRightCollapsed(false)}
                title="展开上下文面板"
                aria-label="展开上下文面板"
              >
                <PanelRightOpen size={15} />
              </button>
              <span className="studio-rail-label">参考</span>
            </div>
          ) : (
            <ContextPanel onCollapse={() => setRightCollapsed(true)} />
          )}
        </div>
      </div>
      <PromptComposer />
    </StudioProvider>
  );
}
