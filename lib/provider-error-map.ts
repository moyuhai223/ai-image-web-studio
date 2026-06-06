/**
 * Provider 错误归一化映射表。
 *
 * 把上游 API / provider 包装 / 项目内部抛出的各种原始 message,
 * 翻译成对终端用户更友好的中文文案 + 可选建议 + 类别标签。
 *
 * 调用约定:
 *   - mapProviderError(rawMessage) → ProviderErrorInfo | null
 *   - 命中 PATTERNS 数组中任一条 → 返回结构化对象
 *   - 未命中(null) → 调用方应保留原始 message(便于排查未知错误)
 *
 * 阶段 2 计划把 category 用于 UI 上色 / status='upstream_error' 子状态。
 */

export type ProviderErrorCategory = "auth" | "upstream" | "quota" | "validation" | "timeout" | "network" | "unknown";

export type ProviderErrorInfo = {
  friendly: string;
  suggestion?: string;
  category: ProviderErrorCategory;
};

type Pattern = {
  test: RegExp;
  build: (match: RegExpMatchArray) => ProviderErrorInfo;
};

const PATTERNS: Pattern[] = [
  // 认证 / Key 池耗尽 ----------------------------------------------------------
  {
    // auth_unavailable / "no auth available" 是网关上游池临时没有可用认证(路由/池耗尽),
    // 属于瞬时上游问题(可重试),归类 upstream —— 区别于下面真正的「key 无效」(auth,不可重试)。
    test: /no auth available|auth_unavailable/i,
    build: () => ({
      friendly: "上游服务对该模型暂无可用认证(服务商内部路由/池临时问题)",
      suggestion: "通常稍后自动重试即可恢复;若持续出现请联系服务商或切换其它模型",
      category: "upstream"
    })
  },
  {
    test: /没有可用的 AI Key/i,
    build: () => ({
      friendly: "当前没有可用的 AI Key(可能全部被禁用或额度耗尽)",
      suggestion: "管理员请到 设置 → AI Key 池 检查 key 状态",
      category: "auth"
    })
  },
  {
    test: /invalid[_\s-]?api[_\s-]?key|incorrect api key|unauthorized/i,
    build: () => ({
      friendly: "AI Key 无效或已被上游撤销",
      suggestion: "管理员请更新或删除失效的 Key",
      category: "auth"
    })
  },

  // 配额 / 速率限制 -----------------------------------------------------------
  {
    test: /rate[_\s-]?limit|too many requests|requests per minute|429/i,
    build: () => ({
      friendly: "请求频率超过上游限制",
      suggestion: "请稍后重试,或在 设置 → AI Key 池 添加更多 Key 分担",
      category: "quota"
    })
  },
  {
    test: /quota|insufficient.*balance|insufficient_quota|余额不足|额度/i,
    build: () => ({
      friendly: "上游账户额度已用完",
      suggestion: "请管理员到服务商处充值,或更换其它 Key",
      category: "quota"
    })
  },

  // 上游返回结构异常(本项目内部抛的) --------------------------------------------
  {
    test: /Provider returned no edited image/i,
    build: () => ({
      friendly: "模型未返回编辑后的图片",
      suggestion: "参考图可能过大、含敏感内容或不符合要求,可尝试更换参考图、降低分辨率或换模型",
      category: "upstream"
    })
  },
  {
    test: /Provider returned no images/i,
    build: () => ({
      friendly: "模型未返回任何图片",
      suggestion: "提示词可能触发安全策略,可尝试调整描述或换模型",
      category: "upstream"
    })
  },
  {
    test: /Provider response did not contain an image/i,
    build: () => ({
      friendly: "模型返回了响应但不包含图片",
      suggestion: "可能是 Chat 模型未启用多模态输出,可尝试换 gpt-image-2 / nano-banana 等专用图像模型",
      category: "upstream"
    })
  },

  // 上游 HTTP 错误码 ----------------------------------------------------------
  {
    test: /Provider request failed with (\d{3})/i,
    build: (match) => {
      const status = Number(match[1]);
      if (status >= 500) {
        return {
          friendly: `上游服务异常(HTTP ${status})`,
          suggestion: "请稍后重试,如持续出现请联系服务商",
          category: "upstream"
        };
      }
      if (status === 401 || status === 403) {
        return {
          friendly: `上游拒绝访问(HTTP ${status})`,
          suggestion: "Key 可能无效或无该模型权限,请检查",
          category: "auth"
        };
      }
      if (status === 404 || status === 405) {
        return {
          friendly: `上游不支持该接口(HTTP ${status})`,
          suggestion: "可能是当前 Base URL 不支持图像编辑,请检查 Provider 配置",
          category: "upstream"
        };
      }
      if (status === 408 || status === 504) {
        return {
          friendly: `上游响应超时(HTTP ${status})`,
          suggestion: "图片或提示词较大可能导致超时,可降低参考图分辨率后重试",
          category: "timeout"
        };
      }
      return {
        friendly: `上游请求被拒绝(HTTP ${status})`,
        category: "upstream"
      };
    }
  },

  // 超时 --------------------------------------------------------------------
  {
    test: /模型请求超过.*未返回/i,
    build: () => ({
      friendly: "模型超时未返回",
      suggestion: "参考图过大或上游繁忙,可降低分辨率、减少参考图数量后重试",
      category: "timeout"
    })
  },
  {
    test: /ETIMEDOUT|ECONNRESET|ECONNREFUSED|fetch failed|network|socket hang up/i,
    build: () => ({
      friendly: "与上游服务的网络连接异常",
      suggestion: "请检查 Provider Base URL 是否可达,或稍后重试",
      category: "network"
    })
  },

  // 参考图校验 ---------------------------------------------------------------
  {
    test: /Invalid reference image data URL/i,
    build: () => ({
      friendly: "参考图数据格式异常",
      suggestion: "请重新上传参考图",
      category: "validation"
    })
  },
  {
    test: /参考图.*预处理失败/i,
    build: (match) => ({
      friendly: match[0],
      suggestion: "请确认参考图为有效的 PNG/JPEG/WebP 图片",
      category: "validation"
    })
  }
];

/**
 * 把任意原始错误 message 映射成结构化的 ProviderErrorInfo。
 * 未命中返回 null —— 调用方应保留原 message 以便排查未知错误模式。
 */
export function mapProviderError(rawMessage: string | undefined | null): ProviderErrorInfo | null {
  if (!rawMessage) return null;
  const text = String(rawMessage).trim();
  if (!text) return null;

  for (const pattern of PATTERNS) {
    const match = text.match(pattern.test);
    if (match) {
      return pattern.build(match);
    }
  }
  return null;
}

/**
 * 拼成最终展示给用户的一行文案。
 * 调用方通常会带一个阶段前缀(如 "等待模型返回失败：")。
 */
export function formatProviderErrorInfo(info: ProviderErrorInfo): string {
  return info.suggestion ? `${info.friendly}（建议：${info.suggestion}）` : info.friendly;
}
