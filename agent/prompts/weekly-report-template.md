---
description: 生成垂直 AI Agent 行业周报，核心人物一手观点优先
argument-hint: "[本周 | YYYY-MM-DD 起 | 过去 7 天]"
---

你是一位专注于 AI Agent 行业的研究分析师。你的任务是用中文生成一份高质量周报。时间范围默认为过去 7 天（可由 `$ARGUMENTS` 覆盖）。

## 核心理念

**一手观点 > 二手报道。** CEO/产品负责人的原话比媒体通稿有价值得多。每条内容尽量追溯到人，而不是只报道事件。

## 执行流程

### Step 1：基线并行搜索（5 个 websearch subagent）

以下 5 个为必跑基线，同时启动，每个 `run_in_background: true`：

**Agent B1 — 核心人物一手观点（英文）**
```
subagent_type: "websearch"
description: "基线-人物观点-EN"
prompt: |
  Search for the past 7 days: interviews, podcasts, talks, founder blog posts, open letters, long-form social media posts from founders, CEOs, CTOs, CPOs, heads of research, and key investors of major AI agent companies (e.g., OpenAI, Anthropic, Google DeepMind, Microsoft, Adept, Imbue, LangChain, AutoGPT, CrewAI, Cognition AI, Harvey, Sierra, Cursor, Replit, Bolt, Lovable, etc.). Prioritize original viewpoints on product direction, industry structure, business model, organizational change, technical roadmap, competitive strategy, and future trends. For each item, note: who said it, where, when, and a direct quote or paraphrase of their key argument.
run_in_background: true
```

**Agent B2 — 核心人物一手观点（中文及亚洲）**
```
subagent_type: "websearch"
description: "基线-人物观点-ZH"
prompt: |
  搜索过去 7 天内，中国及亚洲地区主要 AI Agent 公司创始人和核心人物的访谈、播客、演讲、官方博客、公众号长文、即刻/Twitter 长文。重点关注：字节跳动/豆包、百度/文心、阿里/通义、腾讯、智谱、月之暗面、Minimax、阶跃星辰、面壁智能、Coze/Dify/扣子等平台，以及企业级 Agent 创业公司。提取他们对产品方向、行业结构、商业模式、组织变化、技术路线、竞争判断和未来趋势的原创观点。记录：谁说的、在哪里、何时发布、核心观点原文或概括。
run_in_background: true
```

**Agent B3 — 产品发布与重大更新**
```
subagent_type: "websearch"
description: "基线-产品更新"
prompt: |
  Search for the past 7 days: new AI agent product launches, major version upgrades, significant capability changes (e.g., new modalities, tool use, memory, multi-agent orchestration), business model changes (pricing, API access tiers, open-source shifts), and platform strategy moves. Cover both established players and notable startups globally. For each item: what changed, why it matters, and link to official announcement or primary source.
run_in_background: true
```

**Agent B4 — 公司战略、组织与市场动作**
```
subagent_type: "websearch"
description: "基线-战略组织"
prompt: |
  Search for the past 7 days: AI agent company strategy shifts, key hires/departures (C-suite, research leads, product leads), major partnerships, M&A, organizational restructuring, market entry/exit, and notable funding rounds with strategic significance (beyond just "$X raised"). Focus on what the move signals about the company's direction. Include original statements from executives where available.
run_in_background: true
```

**Agent B5 — 行业分析与争议**
```
subagent_type: "websearch"
description: "基线-分析争议"
prompt: |
  Search for the past 7 days: influential industry analysis pieces, thought leader commentary, debate and controversy around AI agents (e.g., reliability, safety, business model viability, enterprise adoption reality vs. hype), and emerging criticism or skepticism from credible voices. Include analyst reports, VC memos, and long-form essays from practitioners. For each item: the core argument, who made it, and why it matters.
run_in_background: true
```

记录每个 agent ID：`$ID_B1`, `$ID_B2`, `$ID_B3`, `$ID_B4`, `$ID_B5`。

### Step 2：等待基线完成

```
get_subagent_result(agent_id: $ID_B1, wait: true)
get_subagent_result(agent_id: $ID_B2, wait: true)
get_subagent_result(agent_id: $ID_B3, wait: true)
get_subagent_result(agent_id: $ID_B4, wait: true)
get_subagent_result(agent_id: $ID_B5, wait: true)
```

### Step 3：缺口评估与补充搜索

对照以下**必覆盖清单**逐项检查基线结果：

- [ ] 至少 1 条来自 CEO/创始人级别的一手观点
- [ ] 至少 1 条来自中文/亚洲市场的独立内容（非翻译）
- [ ] 至少 1 条产品/能力层面的实质性更新
- [ ] 至少 1 条涉及商业模式或组织变化的分析
- [ ] 至少 1 条行业批评/争议/不同意见

**如果某项缺失**，启动补充 agent：

```
subagent_type: "websearch"
description: "补充-<维度名>"
prompt: |
  <针对缺失维度，用更窄或换角度的 query 深挖>
run_in_background: true
```

**如果本周有重大事件**（如头部公司发布重磅产品、核心高管离职、重大收购等），即使基线已覆盖该事件，也应启动 1-2 个聚焦该事件的深度补充 agent，例如：搜该事件的二级评论、竞争对手反应、投资人解读。

补充 agent 数量不设上限，但每个都应有明确的填补理由。记录 ID 为 `$ID_S1`, `$ID_S2`, ...。

### Step 4：等待补充结果（如有）

```
get_subagent_result(agent_id: $ID_S1, wait: true)
...
```

### Step 5：汇总并生成 HTML 周报

用中文汇总全部搜索结果，生成一份自包含的 HTML 文件，写入当前工作目录。

**文件路径**：`./YYYY-MM-DD-weekly-report.html`，其中 `YYYY-MM-DD` 为本周日的日期。

**HTML 结构必须严格遵循以下模板**——不要修改整体结构，缺内容的区块留空，不要删除。

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>AI Agent 行业周报 — YYYY-MM-DD</title>
<style>
  :root {
    --bg: #fafafa;
    --card-bg: #ffffff;
    --text: #1a1a2e;
    --muted: #6b7280;
    --accent: #2563eb;
    --border: #e5e7eb;
    --tag-bg: #eff6ff;
    --tag-text: #1e40af;
    --quote-bg: #f9fafb;
    --quote-border: #2563eb;
    --radius: 8px;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif;
    background: var(--bg);
    color: var(--text);
    line-height: 1.75;
    padding: 40px 20px 80px;
  }
  .container { max-width: 800px; margin: 0 auto; }
  .header {
    text-align: center;
    padding: 48px 0 32px;
    border-bottom: 2px solid var(--border);
    margin-bottom: 40px;
  }
  .header h1 { font-size: 28px; font-weight: 800; margin-bottom: 8px; letter-spacing: -0.5px; }
  .header .meta { color: var(--muted); font-size: 14px; }

  .section { margin-bottom: 48px; }
  .section-title {
    font-size: 20px;
    font-weight: 700;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--border);
    margin-bottom: 20px;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .section-title .num {
    background: var(--accent);
    color: #fff;
    font-size: 12px;
    padding: 2px 8px;
    border-radius: 12px;
  }

  .card {
    background: var(--card-bg);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 24px;
    margin-bottom: 16px;
  }
  .card h3 { font-size: 17px; font-weight: 700; margin-bottom: 12px; }
  .card .field { margin-bottom: 10px; }
  .card .field-label { font-size: 12px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: 0.5px; }
  .card .field-value { font-size: 15px; margin-top: 2px; }
  .card blockquote {
    background: var(--quote-bg);
    border-left: 3px solid var(--quote-border);
    padding: 10px 14px;
    margin: 8px 0;
    font-size: 14px;
    color: #374151;
    border-radius: 0 var(--radius) var(--radius) 0;
  }
  .card .tags { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
  .card .tag {
    background: var(--tag-bg);
    color: var(--tag-text);
    font-size: 12px;
    padding: 2px 10px;
    border-radius: 12px;
  }
  .card .source {
    margin-top: 12px;
    font-size: 13px;
    color: var(--muted);
  }
  .card .source a { color: var(--accent); text-decoration: none; }
  .card .source a:hover { text-decoration: underline; }

  .summary-block { margin-bottom: 20px; }
  .summary-block h4 { font-size: 16px; font-weight: 700; margin-bottom: 8px; }
  .summary-block ul { padding-left: 20px; }
  .summary-block li { margin-bottom: 6px; font-size: 15px; }

  .watch-item { margin-bottom: 12px; }
  .watch-item strong { color: var(--accent); }

  .quality-note {
    background: #fef3c7;
    border: 1px solid #fcd34d;
    border-radius: var(--radius);
    padding: 12px 16px;
    font-size: 14px;
    color: #92400e;
    margin-bottom: 32px;
  }

  @media (max-width: 600px) {
    body { padding: 16px 12px 40px; }
    .card { padding: 16px; }
  }
</style>
</head>
<body>
<div class="container">

  <!-- Header -->
  <div class="header">
    <h1>AI Agent 行业周报</h1>
    <p class="meta">覆盖周期：YYYY-MM-DD ~ YYYY-MM-DD &nbsp;|&nbsp; 报告生成：YYYY-MM-DD</p>
  </div>

  <!-- 质量说明：如本周高质量条目不足 5 条，在此用 .quality-note 说明；否则删除此块 -->

  <!-- ==================== 一、本周值得关注 ==================== -->
  <div class="section">
    <div class="section-title"><span class="num">一</span> 本周值得关注</div>

    <!-- 每条用 .card 包裹，5-10 个。不足 5 条时如实说明，不填充 -->
    <div class="card">
      <h3>标题：一句话概括事件</h3>
      <div class="field">
        <div class="field-label">发生了什么</div>
        <div class="field-value">1-2 句客观事实，不含评价。</div>
      </div>
      <div class="field">
        <div class="field-label">核心人物观点</div>
        <blockquote>直接引用或准确概括核心论点。</blockquote>
        <div class="field-value" style="font-size:13px;color:var(--muted)">— 姓名，职位，公司</div>
      </div>
      <div class="field">
        <div class="field-label">为什么重要</div>
        <div class="field-value">对产品方向、行业结构、竞争格局或商业模式的隐含影响（2-3 句）。</div>
      </div>
      <div class="tags">
        <span class="tag">垂直行业 1</span>
        <span class="tag">垂直行业 2</span>
      </div>
      <div class="source">
        来源：<a href="https://..." target="_blank">文章/播客/视频标题</a> &nbsp;|&nbsp; 人物身份 &nbsp;|&nbsp; YYYY-MM-DD
      </div>
    </div>
    <!-- /card -->

  </div>

  <!-- ==================== 二、核心人物观点总结 ==================== -->
  <div class="section">
    <div class="section-title"><span class="num">二</span> 核心人物观点总结</div>

    <div class="summary-block">
      <h4>共识</h4>
      <p style="font-size:13px;color:var(--muted);margin-bottom:8px">本周来自 ≥2 个不同来源、指向同一方向的判断。至少 2 项。</p>
      <ul>
        <li><strong>共识主题</strong>：……（代表人物：姓名，职位，公司 — <a href="...">出处</a>）</li>
      </ul>
    </div>

    <div class="summary-block">
      <h4>分歧</h4>
      <p style="font-size:13px;color:var(--muted);margin-bottom:8px">本周出现的明确对立或张力。至少 1 项。</p>
      <ul>
        <li><strong>分歧焦点</strong>：……（A 方：姓名 — 立场；B 方：姓名 — 立场）</li>
      </ul>
    </div>

    <div class="summary-block">
      <h4>潜在趋势信号</h4>
      <p style="font-size:13px;color:var(--muted);margin-bottom:8px">尚未被广泛讨论但值得关注的早期信号。1-3 个。</p>
      <ul>
        <li><strong>信号</strong>：为什么值得关注。</li>
      </ul>
    </div>
  </div>

  <!-- ==================== 三、持续跟踪议题 ==================== -->
  <div class="section">
    <div class="section-title"><span class="num">三</span> 持续跟踪议题</div>

    <!-- 3-5 个 -->
    <div class="watch-item">
      <strong>议题：</strong>为什么重要。关注 <em>什么信号</em>。
    </div>
  </div>

</div>
</body>
</html>
```

## 质量标准

- 每条内容有可核验的原始来源链接
- 优先选择过去 7 天内发生或发布的信息
- 搜索覆盖中英文及其他主要语言源
- 排除：模型基座新闻（除非直接影响 Agent 产品形态）、低质量转载/营销稿、只有金额无战略解读的融资通稿、纯技术教程
- 如果某条信息只有一个来源且无法交叉验证，在来源处标注「⚠️ 单一来源」
- 如果本周内容不足以支撑 5 条高质量条目，在文件顶部用 `.quality-note` 如实说明，不要填充低价值内容
- 使用 `write` 工具将最终 HTML 写入工作目录
- 完成后使用 `open` tool 打开生成的 HTML 文件，在浏览器中查看效果
