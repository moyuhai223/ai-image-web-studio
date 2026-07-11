import { z } from "zod";
import { config } from "./config";

export const generateSchema = z.object({
  prompt: z.string().trim().min(1, "请输入提示词").max(4000, "提示词太长"),
  model: z.string().trim().min(1),
  // 接受预设档或自定义 WxH;实际值由服务端 normalizeImageSize 自动裁剪成合规尺寸(/16、限最大、像素预算)
  size: z.string().trim().regex(/^(auto|\d{2,5}x\d{2,5})$/i, "尺寸格式无效"),
  count: z.coerce.number().int().min(1).max(4),
  /** 模型所属的模型组 id;未传或空串则服务端回退默认组 */
  groupId: z
    .string()
    .trim()
    .max(120)
    .optional()
    .transform((value) => (value && value.length > 0 ? value : undefined))
});

/**
 * 对外 OpenAI 兼容接口 POST /v1/images/generations 的请求体。
 * 可选字段用 nullish(缺失/显式 null 都等同未传——OpenAI 语义,不少第三方客户端会把未填字段序列化为 null);
 * n 由调用方夹紧 1..4(宽容兼容)。多余字段(quality/style 等)被 z.object 默认 strip,不报错。
 */
export const openAiImagesGenerationsSchema = z.object({
  prompt: z.string().trim().min(1, "prompt 不能为空").max(4000, "prompt 太长"),
  model: z.string().trim().min(1).max(120).nullish().transform((value) => value ?? undefined),
  n: z.number().int().nullish().transform((value) => value ?? undefined),
  size: z.string().trim().max(20).nullish().transform((value) => value ?? "auto"),
  response_format: z.enum(["b64_json", "url"]).nullish().transform((value) => value ?? "b64_json"),
  user: z.string().max(256).nullish().transform((value) => value ?? undefined)
});

export const loginSchema = z.object({
  username: z.string().trim().min(1),
  password: z.string().min(1)
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "请输入当前密码"),
  newPassword: z.string().min(8, "新密码至少 8 位").max(128, "新密码太长")
});

export const upscaleSchema = z.object({
  // 仅 ai:走编辑接口 AI 高清重绘(固定 gpt-image-2,原生 4K,不足直接失败)。
  // fast(sharp 插值放大)已于 v0.8.7 移除——插值不产生新细节,只会出「假 4K」。
  mode: z.enum(["ai"])
});

export const createUserSchema = z.object({
  username: z.string().trim().min(2).max(64),
  password: z.string().min(8).max(128),
  role: z.enum(["admin", "member"])
});

export const updateUserSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("setActive"),
    active: z.boolean()
  }),
  z.object({
    action: z.literal("resetPassword"),
    password: z.string().min(8).max(128)
  }),
  z.object({
    action: z.literal("setRole"),
    role: z.enum(["admin", "member"])
  })
]);

export const promptTemplateSchema = z.object({
  title: z.string().trim().min(1, "请输入模板名称").max(80, "模板名称太长"),
  category: z.string().trim().max(40, "分类太长").default("通用"),
  content: z.string().trim().min(1, "请输入模板内容").max(4000, "模板内容太长")
});

export const updatePromptTemplateSchema = promptTemplateSchema.extend({
  id: z.string().uuid("模板 ID 无效")
});

export const deletePromptTemplateSchema = z.object({
  id: z.string().uuid("模板 ID 无效")
});

// 标准 MIME → 文件扩展名 映射(覆盖 config.allowedImageMimes 中可能出现的类型)
const MIME_EXTENSION_MAP: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif"
};

function extensionForMime(mime: string): string {
  if (MIME_EXTENSION_MAP[mime]) return MIME_EXTENSION_MAP[mime];
  const part = mime.split("/")[1]?.toLowerCase() ?? "bin";
  return part === "jpeg" ? "jpg" : part;
}

/**
 * 允许的图片 MIME → 文件扩展名 映射。
 * 在模块加载时从 config.allowedImageMimes 派生,与 config 同生命周期。
 * 后续若要换用动态读取(支持配置热更新)再改 getAllowedImageTypes() 函数。
 */
export const allowedImageTypes = new Map<string, string>(
  config.allowedImageMimes.map((mime) => [mime, extensionForMime(mime)])
);
