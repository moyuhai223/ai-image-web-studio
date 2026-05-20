import { query } from "./db";
import type { PromptTemplate } from "./types";

const TEMPLATE_COLUMNS = `
  id,
  title,
  category,
  content,
  source_key,
  source_name,
  source_url,
  source_license,
  created_by,
  created_at::text as created_at,
  updated_at::text as updated_at
`;

const AWESOME_SOURCE = {
  name: "EvoLinkAI awesome-gpt-image-2-API-and-Prompts",
  url: "https://github.com/EvoLinkAI/awesome-gpt-image-2-API-and-Prompts/blob/main/README_zh-CN.md",
  license: "CC0-1.0 / README badge mentions CC BY 4.0"
};

const AWESOME_PROMPT_TEMPLATES = [
  {
    sourceKey: "awesome-gpt-image-2-product-hero",
    title: "电商主图 - 高级产品展示",
    category: "电商主图",
    content:
      "为「{产品名称}」生成一张电商主图。主体占画面 70%，干净高级的商业摄影风格，突出材质、轮廓和核心卖点。背景使用与品牌调性匹配的浅色场景，加入少量生活方式道具但不要喧宾夺主。画面清晰、真实光影、可直接用于商品首图。"
  },
  {
    sourceKey: "awesome-gpt-image-2-campaign-poster",
    title: "活动海报 - 亮色促销视觉",
    category: "广告海报",
    content:
      "生成一张「{活动主题}」宣传海报。画面要有强烈第一视觉，主体人物或产品占 60% 以上，使用明亮配色、清晰层次和商业广告质感。预留顶部标题区和底部信息区，不要生成小字，整体适合社媒传播。"
  },
  {
    sourceKey: "awesome-gpt-image-2-portrait-editorial",
    title: "人像摄影 - 杂志封面感",
    category: "人像摄影",
    content:
      "生成一张杂志封面风格人像。人物为「{人物描述}」，半身或全身构图，眼神自然，服装与场景统一。使用柔和主光、细腻皮肤质感、真实镜头景深，背景简洁但有空间感，整体高级、干净、有编辑摄影气质。"
  },
  {
    sourceKey: "awesome-gpt-image-2-character-design",
    title: "角色设定 - 游戏宣传图",
    category: "角色设计",
    content:
      "为「{角色名称/设定}」生成一张游戏宣传图。角色占画面 80%，姿态明确，服装、配件和武器符合设定。背景提供世界观氛围但不抢主体，光影有戏剧性，细节丰富，适合用作角色展示或活动 KV。"
  },
  {
    sourceKey: "awesome-gpt-image-2-scene-concept",
    title: "场景概念 - 电影感环境",
    category: "场景建筑",
    content:
      "生成一张电影概念设计风格场景图。场景为「{地点/时代/氛围}」，强调空间纵深、环境光和可探索细节。构图采用宽画幅叙事视角，画面要真实可信，色彩有明确情绪，不要出现文字或水印。"
  },
  {
    sourceKey: "awesome-gpt-image-2-food-photo",
    title: "美食摄影 - 餐厅菜单图",
    category: "美食摄影",
    content:
      "生成一张「{菜品名称}」美食摄影图。食物新鲜诱人，主菜清晰，餐具和桌面干净高级。使用自然侧光、浅景深和真实质感，避免过度修饰，画面适合菜单、外卖封面或社媒发布。"
  },
  {
    sourceKey: "awesome-gpt-image-2-packaging-mockup",
    title: "包装展示 - 品牌样机",
    category: "产品摄影",
    content:
      "为「{品牌/产品}」生成包装样机展示图。展示盒、瓶、袋或套装的真实比例和材质，背景简洁，加入柔和阴影和反射。整体像专业品牌视觉提案，预留可放 logo 的干净区域，不要生成乱码文字。"
  },
  {
    sourceKey: "awesome-gpt-image-2-social-cover",
    title: "社媒封面 - 小红书/公众号",
    category: "社媒封面",
    content:
      "生成一张适合社媒封面的图片，主题是「{主题}」。主体明确、色彩抓眼、留出标题空间，画面要有生活方式和内容价值感。不要放太多元素，不要生成小字，适合 4:3 或 3:4 比例裁切。"
  },
  {
    sourceKey: "awesome-gpt-image-2-ui-dashboard",
    title: "UI 概念 - 产品界面展示",
    category: "UI设计",
    content:
      "生成一张「{产品类型}」的 UI 概念展示图。界面要像真实 SaaS 或工具产品，信息层级清晰，使用卡片、侧栏、图表和操作按钮。风格现代、克制、可读性高，避免装饰过多，不要出现不可辨认小字。"
  },
  {
    sourceKey: "awesome-gpt-image-2-icon-set",
    title: "图标物料 - 一组统一图标",
    category: "图标物料",
    content:
      "生成一组「{主题}」图标素材。图标数量 6-9 个，统一线条、透视、色彩和阴影，排布整齐，背景透明或浅色。每个图标主题明确，适合网页功能入口、设置页或营销物料使用。"
  },
  {
    sourceKey: "awesome-gpt-image-2-photo-edit-background",
    title: "修图 - 更换背景",
    category: "编辑修图",
    content:
      "基于参考图进行编辑：保留主体人物/产品的形态、姿势、比例和细节，将背景更换为「{新背景描述}」。保持真实光影和边缘融合，主体不要变形，不要改变身份特征，输出像自然拍摄完成的成片。"
  },
  {
    sourceKey: "awesome-gpt-image-2-photo-edit-product",
    title: "修图 - 产品质感强化",
    category: "编辑修图",
    content:
      "基于参考图进行编辑：保留产品外形和品牌识别，提升材质质感、光影层次和商业摄影效果。清理杂乱背景，增强主体清晰度，修正轻微瑕疵，保持真实可信，不要改变产品结构。"
  }
];

export async function listPromptTemplates() {
  const result = await query<PromptTemplate>(
    `select ${TEMPLATE_COLUMNS}
     from prompt_templates
     order by category asc, updated_at desc, created_at desc`
  );

  return result.rows;
}

export async function createPromptTemplate(input: {
  title: string;
  category: string;
  content: string;
  userId: string;
}) {
  const result = await query<PromptTemplate>(
    `insert into prompt_templates (title, category, content, created_by)
     values ($1, $2, $3, $4)
     returning ${TEMPLATE_COLUMNS}`,
    [input.title, normalizeCategory(input.category), input.content, input.userId]
  );

  return result.rows[0];
}

export async function updatePromptTemplate(input: {
  id: string;
  title: string;
  category: string;
  content: string;
}) {
  const result = await query<PromptTemplate>(
    `update prompt_templates
     set title = $2,
         category = $3,
         content = $4,
         updated_at = now()
     where id = $1
     returning ${TEMPLATE_COLUMNS}`,
    [input.id, input.title, normalizeCategory(input.category), input.content]
  );

  return result.rows[0] ?? null;
}

export async function deletePromptTemplate(id: string) {
  const result = await query<{ id: string }>(
    `delete from prompt_templates
     where id = $1
     returning id`,
    [id]
  );

  return Boolean(result.rows[0]);
}

export async function importAwesomeGptImagePrompts(userId: string) {
  const keys = AWESOME_PROMPT_TEMPLATES.map((template) => template.sourceKey);
  const existingResult = await query<{ source_key: string }>(
    `select source_key
     from prompt_templates
     where source_key = any($1::text[])`,
    [keys]
  );
  const existingKeys = new Set(existingResult.rows.map((row) => row.source_key));
  let inserted = 0;
  let updated = 0;

  for (const template of AWESOME_PROMPT_TEMPLATES) {
    await query<PromptTemplate>(
      `insert into prompt_templates
        (title, category, content, created_by, source_key, source_name, source_url, source_license)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       on conflict (source_key) where source_key is not null
       do update set
         title = excluded.title,
         category = excluded.category,
         content = excluded.content,
         source_name = excluded.source_name,
         source_url = excluded.source_url,
         source_license = excluded.source_license,
         updated_at = now()
       returning ${TEMPLATE_COLUMNS}`,
      [
        template.title,
        normalizeCategory(template.category),
        template.content,
        userId,
        template.sourceKey,
        AWESOME_SOURCE.name,
        AWESOME_SOURCE.url,
        AWESOME_SOURCE.license
      ]
    );

    if (existingKeys.has(template.sourceKey)) {
      updated += 1;
    } else {
      inserted += 1;
      existingKeys.add(template.sourceKey);
    }
  }

  return {
    inserted,
    updated,
    total: AWESOME_PROMPT_TEMPLATES.length,
    source: AWESOME_SOURCE
  };
}

function normalizeCategory(category: string) {
  return category.trim() || "通用";
}
