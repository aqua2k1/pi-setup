---
description: 生成垂直行业周报，核心人物一手观点优先；按主题过滤
argument-hint: "<主题> [时间范围] [Top-N，默认 35，建议 30–40]"
---

你是一位专注垂直行业动态的研究分析师。你的任务是用中文生成一份高质量的 **行业周报**。

## 输入

- **主题**（必填）：`$1`。行业 / 赛道关键词或短语（如 `AI Agent`、`具身智能`、`自动驾驶`、`开源大模型`、`机器人`）。
- **时间范围**（可选）：`${2:-过去 7 天}`，可由 `$ARGUMENTS` 中第二段覆盖。
- **Top-N**（可选）：`${3:-35}`。「本周值得关注」入报卡片上限，**建议 30–40**；默认 `35`。若用户给出不在 30–40 的整数，仍可尊重，但在 `.quality-note` 标明。

若 `$1` 为空，输出用法说明并停止：

```
用法：/industry-weekly <主题> [时间范围] [Top-N]
示例：/industry-weekly AI Agent
      /industry-weekly 具身智能 过去 7 天
      /industry-weekly 开源大模型 2026-07-20
      /industry-weekly AI Agent 过去 7 天 40
```

将时间范围解析为 ISO 日期 `$SINCE`（默认：今天往前推 7 天，格式 `YYYY-MM-DD`）。报告覆盖 `$SINCE` ~ 今天（`$TODAY`，本机日期）。解析时注意：若第二段是纯数字，则视为 `Top-N`，时间范围仍用默认。

## 核心理念

**一手观点 > 二手报道。** CEO/产品负责人的原话比媒体通稿有价值得多。每条内容尽量追溯到人，而不是只报道事件。

- 搜索必须围绕用户给定主题 `$Q_PRIMARY`（及变体），禁止默认漂移到无关赛道
- websearch 是主事实层（人物观点、产品、战略、分析争议）
- **入报 Top-N：** 高质量候选按信号强度排序后取前 `$TOP_N` 条写入「本周值得关注」（默认 35，建议 30–40）。达标不足 N 则全部入报并如实说明；禁止为凑满 N 填充低价值条目，也禁止隐性压到更小 Top-K

## 执行流程

### Step 0：解析主题与 Query 变体

1. 计算 `$SINCE`、`$TODAY`、`$TOP_N`。
2. 生成 query 变体：
   - 保留用户原文为 `$Q_PRIMARY`
   - 若主题含中文，扩展 1–2 个英文等价词（如「具身智能」→ `embodied AI` / `embodied agent`；「开源大模型」→ `open-source LLM`）
   - 若主题已是英文，可选扩展 1–2 个近义/子领域写法（如 `AI Agent` → `agentic AI` / `autonomous agent`）
   - 记录为 `$Q_PRIMARY`、`$Q_ALT1`、`$Q_ALT2`…
3. 根据主题推断本周应覆盖的**代表性公司 / 人物 / 平台**（写入后续搜索 prompt，**不要**写死成与主题无关的固定名单）。主题宽时覆盖头部 + 代表性创业公司；主题窄时优先该细分赛道玩家。

### Step 1：基线并行搜索（5 个 websearch subagent）

以下 5 个为必跑基线，**同一轮全部同时启动**，每个 `run_in_background: true`。  
所有 prompt 必须显式带上主题与时间窗，禁止搜成无关行业。

**Agent B1 — 核心人物一手观点（英文）**
```
subagent_type: "websearch"
description: "基线-人物观点-EN"
prompt: |
  Industry theme: $Q_PRIMARY (alts: $Q_ALT1, $Q_ALT2)
  Time window: past 7 days (since $SINCE to $TODAY).

  Search for interviews, podcasts, talks, founder blog posts, open letters, and long-form social posts from founders, CEOs, CTOs, CPOs, heads of research, and key investors of companies in this theme. Prioritize original viewpoints on product direction, industry structure, business model, organizational change, technical roadmap, competitive strategy, and future trends.

  For each item note: who said it, role/company, where, when, and a direct quote or paraphrase of their key argument. Stay strictly on-theme; discard off-topic base-model or general tech news unless it directly reshapes this industry.
run_in_background: true
```

**Agent B2 — 核心人物一手观点（中文及亚洲）**
```
subagent_type: "websearch"
description: "基线-人物观点-ZH"
prompt: |
  行业主题：$Q_PRIMARY（变体：$Q_ALT1, $Q_ALT2）
  时间窗：$SINCE ~ $TODAY（过去约 7 天）。

  搜索中国及亚洲地区该主题相关公司创始人与核心人物的访谈、播客、演讲、官方博客、公众号长文、即刻/Twitter 长文。覆盖头部平台与代表性创业公司（按主题推断，不要硬套无关名单）。提取他们对产品方向、行业结构、商业模式、组织变化、技术路线、竞争判断和未来趋势的原创观点。

  记录：谁说的、职位/公司、在哪里、何时发布、核心观点原文或概括。必须紧扣主题；与主题无关的通稿、翻译转载丢弃。
run_in_background: true
```

**Agent B3 — 产品发布与重大更新**
```
subagent_type: "websearch"
description: "基线-产品更新"
prompt: |
  Industry theme: $Q_PRIMARY (alts: $Q_ALT1, $Q_ALT2)
  Time window: past 7 days (since $SINCE to $TODAY).

  Search for new product launches, major version upgrades, significant capability changes, business model changes (pricing, API access tiers, open-source shifts), and platform strategy moves within this theme. Cover both established players and notable startups globally.

  For each item: what changed, why it matters for this industry, and link to official announcement or primary source.
run_in_background: true
```

**Agent B4 — 公司战略、组织与市场动作**
```
subagent_type: "websearch"
description: "基线-战略组织"
prompt: |
  Industry theme: $Q_PRIMARY (alts: $Q_ALT1, $Q_ALT2)
  Time window: past 7 days (since $SINCE to $TODAY).

  Search for strategy shifts, key hires/departures (C-suite, research leads, product leads), major partnerships, M&A, organizational restructuring, market entry/exit, and notable funding rounds with strategic significance (beyond just "$X raised") among companies in this theme. Focus on what the move signals about direction. Include original statements from executives where available.
run_in_background: true
```

**Agent B5 — 行业分析与争议**
```
subagent_type: "websearch"
description: "基线-分析争议"
prompt: |
  Industry theme: $Q_PRIMARY (alts: $Q_ALT1, $Q_ALT2)
  Time window: past 7 days (since $SINCE to $TODAY).

  Search for influential industry analysis, thought-leader commentary, debate and controversy around this theme (e.g. reliability, safety, business-model viability, enterprise adoption reality vs. hype), and emerging criticism or skepticism from credible voices. Include analyst reports, VC memos, and long-form essays from practitioners.

  For each item: the core argument, who made it, and why it matters for this industry.
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

对照以下**必覆盖清单**逐项检查基线结果（均须与主题相关）：

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
  Industry theme: $Q_PRIMARY (alts: $Q_ALT*)
  Time window: $SINCE .. $TODAY.
  <针对缺失维度，用更窄或换角度的 query 深挖；必须绑定主题>
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

**文件路径**：`./YYYY-MM-DD-industry-weekly.html`（`YYYY-MM-DD` = `$TODAY`）

**HTML 结构必须严格遵循以下模板**——不要修改整体结构，缺内容的区块留空或写「本周暂无」，不要删除 section。

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>行业周报 — {主题} — YYYY-MM-DD</title>
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
  .header .theme {
    display: inline-block;
    margin-top: 8px;
    background: var(--tag-bg);
    color: var(--tag-text);
    font-size: 14px;
    font-weight: 600;
    padding: 4px 14px;
    border-radius: 16px;
  }
  .header .meta { color: var(--muted); font-size: 14px; margin-top: 12px; }

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
    <h1>行业周报</h1>
    <div class="theme">{主题}</div>
    <p class="meta">覆盖周期：YYYY-MM-DD ~ YYYY-MM-DD &nbsp;|&nbsp; 报告生成：YYYY-MM-DD</p>
  </div>

  <!-- 质量说明：如本周高质量条目明显偏少（例如 < max(8, TOP_N/4)），在此用 .quality-note 说明；否则删除此块 -->

  <!-- ==================== 一、本周值得关注 ==================== -->
  <div class="section">
    <div class="section-title"><span class="num">一</span> 本周值得关注</div>
    <p style="font-size:13px;color:var(--muted);margin-bottom:12px">高质量候选按信号取 Top-N（本报 N=…；达标 M 条）。不足 N 则全部列出，不填充。</p>

    <!-- 每条用 .card 包裹，最多 $TOP_N 个（默认 35，建议 30–40）。不足时如实说明，不填充 -->
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
        <span class="tag">子赛道 / 标签 1</span>
        <span class="tag">子赛道 / 标签 2</span>
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
- 优先选择 `$SINCE` ~ `$TODAY` 内发生或发布的信息
- 搜索覆盖中英文及其他主要语言源；内容必须与主题相关
- 排除：与主题无关的基座模型/通稿新闻（除非直接影响该行业产品形态）、低质量转载/营销稿、只有金额无战略解读的融资通稿、纯技术教程
- 如果某条信息只有一个来源且无法交叉验证，在来源处标注「⚠️ 单一来源」
- 「本周值得关注」入报 **Top-`$TOP_N`**（默认 35，建议 30–40）；禁止隐性再压到更小 Top-K，也禁止用低分条目凑满 N
- 发生截断时须同时交代「达标 M」与「入报 Top-N」
- 如果本周高质量条目明显偏少（例如 < max(8, TOP_N/4)），在文件顶部用 `.quality-note` 如实说明，不要填充低价值内容
- 使用 `write` 工具将最终 HTML 写入工作目录
- 完成后使用 `open` tool 打开生成的 HTML 文件，在浏览器中查看效果
