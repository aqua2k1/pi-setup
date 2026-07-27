---
description: 生成 GitHub 社区周活动报告（PR / Issue / Release），按主题过滤
argument-hint: "<主题> [时间范围] [Top-N，默认 35，建议 30–40]"
---

你是一位专注开源社区动态的研究分析师。你的任务是用中文生成一份高质量的 **GitHub 社区周活动报告**。

## 输入

- **主题**（必填）：`$1`。关键词（如 `MCP`、`AI Agent`、`vllm`）或单一仓库 `owner/repo`。
- **时间范围**（可选）：`${2:-过去 7 天}`，可由 `$ARGUMENTS` 中第二段覆盖。
- **Top-N**（可选）：`${3:-35}`。入报事件卡片上限（Release + PR + Issue 合计），**建议 30–40**；默认 `35`。若用户给出不在 30–40 的整数，仍可尊重，但在 `.quality-note` 标明。

若 `$1` 为空，输出用法说明并停止：

```
用法：/github-weekly <主题> [时间范围] [Top-N]
示例：/github-weekly MCP
      /github-weekly AI Agent 过去 7 天
      /github-weekly vllm/vllm 2026-07-20
      /github-weekly MCP 过去 7 天 40
```

将时间范围解析为 ISO 日期 `$SINCE`（默认：今天往前推 7 天，格式 `YYYY-MM-DD`）。报告覆盖 `$SINCE` ~ 今天。解析时注意：若第二段是纯数字，则视为 `Top-N`，时间范围仍用默认。

## 核心理念

**可验证的 GitHub 行为 > 媒体二手解读。**

- 主事实层来自 `gh`（PR / Issue / Release）
- websearch 只解释「为什么重要」和社区反应，不替代 GitHub 事实
- 每条内容尽量带来源链接与可核验指标（⭐ / comments / reactions）
- **入报卡片 Top-N 截断**：筛选达标后按信号强度排序，Release+PR+Issue 合计取前 `$TOP_N`（默认 35，建议 30–40）；禁止为凑满 N 填充低价值条目，也禁止隐性压到更小 Top-K

## 执行流程

### Step 0：解析主题与 Query 变体

1. 判断主题形态：
   - `owner/repo` → **单仓模式**
   - 其他 → **主题搜索模式**
2. 生成 query 变体：
   - 保留用户原文
   - 若主题含中文，扩展 1–2 个英文等价词（如「智能体」→ `agent` / `AI agent`）
   - 记录为 `$Q_PRIMARY`、`$Q_ALT1`…
3. 计算 `$SINCE` 与报告日 `$TODAY`（本机日期）。

### Step 1：主 Agent 采集 GitHub（直接 bash 跑 `gh`）

**不要**用 websearch 搜 GitHub 列表。全部用 `gh`。可按需并行多条 bash。

#### 单仓模式（主题 = `owner/repo`）

```bash
# PR：本周合并
gh search prs --repo "$OWNER/$REPO" --merged --merged-at=">=$SINCE" \
  --sort reactions --limit 50 \
  --json title,url,repository,author,createdAt,closedAt,labels,commentsCount,isDraft,body

# Issue：本周新建（排除 PR）
gh search issues --repo "$OWNER/$REPO" --created=">=$SINCE" \
  --sort comments --limit 50 \
  --json title,url,repository,author,createdAt,state,commentsCount,labels,body

# Release
gh api "repos/$OWNER/$REPO/releases" --paginate \
  --jq "[.[] | select(.published_at >= \"$SINCE\") | {tag_name,name,html_url,published_at,prerelease,draft,body}]"
```

#### 主题搜索模式

**G1 — PR**

```bash
gh search prs "$Q_PRIMARY" --merged --merged-at=">=$SINCE" \
  --sort reactions --limit 50 \
  --json title,url,repository,author,createdAt,closedAt,labels,commentsCount,isDraft,body
```

若结果过少，用 `$Q_ALT*` 再搜一轮并去重。

**G2 — Issue**

```bash
gh search issues "$Q_PRIMARY" --created=">=$SINCE" \
  --sort comments --limit 50 \
  --json title,url,repository,author,createdAt,state,commentsCount,labels,body
```

**G3 — Release（两步）**

```bash
# 1) 发现候选仓库
gh search repos "$Q_PRIMARY" --sort stars --limit 20 \
  --json fullName,description,stargazersCount,url,updatedAt

# 2) 对 top repos 拉 releases（按 stargazersCount 降序，取前 15）
# 对每个 owner/repo：
gh api "repos/$OWNER/$REPO/releases" \
  --jq "[.[] | select(.published_at >= \"$SINCE\" and .draft == false) | {repo:\"$OWNER/$REPO\",tag_name,name,html_url,published_at,prerelease,body}]"
```

注意 rate limit：顺序拉取即可，不要无意义打满 API。

可选补充（需要更准的仓库星数时）：

```bash
gh api "repos/$OWNER/$REPO" --jq "{fullName:.full_name, stars:.stargazers_count, description:.description, url:.html_url}"
```

### Step 2：过滤、聚类、选出 Top 事件

#### 保留（满足任一即可）

- 仓库 stars ≥ 100
- comments ≥ 5，或 reactions / interactions 明显偏高
- 落在主题下 stars 排名前 20 的仓库
- 明确涉及 major / breaking / security / 新能力面（API、协议、runtime）

#### 丢弃

- dependabot / renovate 等 bot（**security** 相关除外）
- awesome-list「加链接」类 PR、无实质 body 的空 PR
- 个人 demo、课程作业、与主题仅标题擦边的条目
- draft release / 明显预发布且无社区讨论（除非主题本身就是该项目）

#### 产出中间结果

1. **Top 活跃仓库** 最多约 `$TOP_N / 3`（约 10–15，按本周相关 PR/Issue/Release 密度 + stars；不计入卡片 Top-N）
2. **候选卡片**（Release + 高信号 PR + 热议 Issue **合计**上限 `$TOP_N`，默认 35，建议 30–40）
   - 按信号强度统一排序后截断；类型配比按本周实际分布，不必写死「各类型固定上限」
   - 软性参考（可浮动）：Release / PR / Issue 大致均可占入报池的一部分，某一类本周特别强时可占更高比例
   - 达标总数 M ≤ `$TOP_N` → 全部入报；M > `$TOP_N` → 只输出前 `$TOP_N`，速览写明「达标 M，入报 Top-N」
3. **需外部解读的 Top 事件清单** 3–8 条（从入报列表挑：重磅 release、breaking 合并、高争议 issue）——仅用于 websearch

每条候选记录字段：`类型 | 标题 | 仓库 | 链接 | 日期 | 指标 | 一句话事实摘要`。

### Step 3：websearch 子 Agent（并行，仅补上下文）

只针对 Step 2 的 Top 事件，**不要**用 websearch 重新枚举 GitHub PR/Issue。

同时启动，每个 `run_in_background: true`：

**Agent W1 — 事件/Release 解读**（有 ≥1 个重磅 release 或重大合并时启动）

```
subagent_type: "websearch"
description: "社区-事件解读"
prompt: |
  Time window: past 7 days (since $SINCE).
  Topic: $Q_PRIMARY
  Focus events (use these exact repos/versions/links):
  - <event 1: repo, version or PR title, url>
  - <event 2: ...>
  Find: official blogs, changelogs, maintainer posts/tweets, release deep-dives.
  For each: what changed, why it matters, direct quotes if any, primary source links.
  Do NOT list random GitHub search results; stick to these events.
run_in_background: true
```

**Agent W2 — 社区反应**（有争议 issue 或 breaking change 时启动）

```
subagent_type: "websearch"
description: "社区-反应讨论"
prompt: |
  Time window: past 7 days (since $SINCE).
  Topic: $Q_PRIMARY
  Contested or high-signal items:
  - <issue/PR/release url and one-line summary>
  Search Hacker News, Reddit, Twitter/X, Chinese tech communities (V2EX, 即刻, 掘金/博客) for reactions.
  Extract: main praise, main criticism, recurring concerns. Cite links.
run_in_background: true
```

**Agent W3 — 主题趋势叙事**（默认总是启动）

```
subagent_type: "websearch"
description: "社区-主题趋势"
prompt: |
  Time window: past 7 days (since $SINCE).
  Open-source theme: $Q_PRIMARY (alts: $Q_ALT*)
  What narrative is forming around this theme in the OSS community?
  Prefer maintainer blogs, RFCs, ecosystem roundups, conference talks.
  Return 3-6 trend bullets with sources. Avoid generic AI hype with no GitHub footprint.
run_in_background: true
```

记录 `$ID_W1`, `$ID_W2`, `$ID_W3`（未启动的跳过）。

### Step 4：等待 websearch 结果

```
get_subagent_result(agent_id: $ID_W1, wait: true)
get_subagent_result(agent_id: $ID_W2, wait: true)
get_subagent_result(agent_id: $ID_W3, wait: true)
```

### Step 5：缺口评估与补充

对照清单：

- [ ] 至少 1 条高质量 Release **或** 明确说明本周无显著发版
- [ ] 至少 2 条高信号 PR（单仓模式可放宽到 1）
- [ ] 至少 2 条有讨论度的 Issue（或说明本周偏实现、讨论少）
- [ ] Top 事件有至少 1 条外部解读或社区反应（websearch）
- [ ] 有「趋势/持续跟踪」素材

若某类不足：

- **GitHub 侧**：换 `$Q_ALT*`、放宽 stars/comments 阈值，或对 Top repo 做定向 `gh search`
- **解读侧**：再启 1 个聚焦 websearch，prompt 必须绑定具体事件 URL

补充数量不设上限，但每条要有填补理由。

### Step 6：汇总并生成 HTML

用中文汇总，生成**自包含 HTML**，写入当前工作目录。

**文件路径**：`./YYYY-MM-DD-github-weekly.html`（`YYYY-MM-DD` = `$TODAY`）

**HTML 结构必须严格遵循以下模板**——不要改整体结构；缺内容的区块如实写「本周暂无」，不要删 section。

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>GitHub 社区周报 — {主题} — YYYY-MM-DD</title>
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
    --tag-release-bg: #ecfdf5;
    --tag-release-text: #065f46;
    --tag-pr-bg: #f5f3ff;
    --tag-pr-text: #5b21b6;
    --tag-issue-bg: #fff7ed;
    --tag-issue-text: #9a3412;
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

  .stats {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
    gap: 12px;
    margin-bottom: 20px;
  }
  .stat {
    background: var(--card-bg);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 16px;
    text-align: center;
  }
  .stat .n { font-size: 24px; font-weight: 800; color: var(--accent); }
  .stat .l { font-size: 12px; color: var(--muted); margin-top: 4px; }

  .repo-list { list-style: none; padding: 0; }
  .repo-list li {
    padding: 8px 0;
    border-bottom: 1px solid var(--border);
    font-size: 15px;
    display: flex;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
  }
  .repo-list a { color: var(--accent); text-decoration: none; font-weight: 600; }
  .repo-list a:hover { text-decoration: underline; }
  .repo-list .meta-r { color: var(--muted); font-size: 13px; }

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
  .card .tag.release { background: var(--tag-release-bg); color: var(--tag-release-text); }
  .card .tag.pr { background: var(--tag-pr-bg); color: var(--tag-pr-text); }
  .card .tag.issue { background: var(--tag-issue-bg); color: var(--tag-issue-text); }
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
  .empty { color: var(--muted); font-size: 14px; padding: 8px 0; }

  @media (max-width: 600px) {
    body { padding: 16px 12px 40px; }
    .card { padding: 16px; }
  }
</style>
</head>
<body>
<div class="container">

  <div class="header">
    <h1>GitHub 社区周报</h1>
    <div class="theme">{主题}</div>
    <p class="meta">覆盖周期：YYYY-MM-DD ~ YYYY-MM-DD &nbsp;|&nbsp; 报告生成：YYYY-MM-DD</p>
  </div>

  <!-- 质量说明：高质量条目明显不足时保留 .quality-note；否则删除此块 -->

  <!-- ==================== 一、本周社区速览 ==================== -->
  <div class="section">
    <div class="section-title"><span class="num">一</span> 本周社区速览</div>

    <div class="stats">
      <div class="stat"><div class="n">N</div><div class="l">合并 PR（筛选后）</div></div>
      <div class="stat"><div class="n">N</div><div class="l">新 Issue（筛选后）</div></div>
      <div class="stat"><div class="n">N</div><div class="l">新 Release</div></div>
      <div class="stat"><div class="n">N</div><div class="l">活跃核心仓库</div></div>
    </div>

    <h4 style="font-size:15px;margin-bottom:8px;">Top 活跃仓库</h4>
    <ul class="repo-list">
      <li>
        <a href="https://github.com/..." target="_blank">owner/repo</a>
        <span class="meta-r">⭐ N · PR x · Issue y · Rel z</span>
      </li>
    </ul>
  </div>

  <!-- ==================== 二、重要 Release ==================== -->
  <div class="section">
    <div class="section-title"><span class="num">二</span> 重要 Release</div>

    <!-- 每条 .card；无则 <p class="empty">本周暂无显著 Release</p> -->
    <div class="card">
      <h3>owner/repo · vX.Y.Z — 一句话亮点</h3>
      <div class="field">
        <div class="field-label">发生了什么</div>
        <div class="field-value">1-3 句客观事实：主要变更、是否 breaking、是否 prerelease。</div>
      </div>
      <div class="field">
        <div class="field-label">为什么重要</div>
        <div class="field-value">对生态/下游/开发者工作流的影响。</div>
      </div>
      <div class="tags">
        <span class="tag release">Release</span>
        <span class="tag">breaking</span>
      </div>
      <div class="source">
        来源：<a href="https://github.com/.../releases/..." target="_blank">Release 页面</a>
        &nbsp;|&nbsp; ⭐ 仓库星数 &nbsp;|&nbsp; YYYY-MM-DD
      </div>
    </div>
  </div>

  <!-- ==================== 三、高信号 PR ==================== -->
  <div class="section">
    <div class="section-title"><span class="num">三</span> 高信号 PR</div>

    <div class="card">
      <h3>标题：合并了什么</h3>
      <div class="field">
        <div class="field-label">发生了什么</div>
        <div class="field-value">1-2 句：改动范围与结果（已合并）。</div>
      </div>
      <div class="field">
        <div class="field-label">为什么重要</div>
        <div class="field-value">影响面；若有维护者说明可引用。</div>
      </div>
      <div class="tags">
        <span class="tag pr">PR</span>
        <span class="tag">feature</span>
      </div>
      <div class="source">
        来源：<a href="https://github.com/.../pull/..." target="_blank">PR 链接</a>
        &nbsp;|&nbsp; owner/repo · @author · comments N &nbsp;|&nbsp; YYYY-MM-DD
      </div>
    </div>
  </div>

  <!-- ==================== 四、热议 Issue ==================== -->
  <div class="section">
    <div class="section-title"><span class="num">四</span> 热议 Issue</div>

    <div class="card">
      <h3>标题：讨论焦点</h3>
      <div class="field">
        <div class="field-label">发生了什么</div>
        <div class="field-value">问题本质或 RFC 诉求，1-2 句。</div>
      </div>
      <div class="field">
        <div class="field-label">争议 / 共识</div>
        <div class="field-value">各方立场摘要；无争议则写「共识方向」。</div>
      </div>
      <div class="tags">
        <span class="tag issue">Issue</span>
        <span class="tag">discussion</span>
      </div>
      <div class="source">
        来源：<a href="https://github.com/.../issues/..." target="_blank">Issue 链接</a>
        &nbsp;|&nbsp; owner/repo · comments N · state &nbsp;|&nbsp; YYYY-MM-DD
      </div>
    </div>
  </div>

  <!-- ==================== 五、社区解读 ==================== -->
  <div class="section">
    <div class="section-title"><span class="num">五</span> 社区解读</div>
    <!-- 主要来自 websearch；必须能回指到上面的 GitHub 事实 -->

    <div class="summary-block">
      <h4>共识</h4>
      <p style="font-size:13px;color:var(--muted);margin-bottom:8px">≥2 源指向同一方向的判断；不足则少写，不编造。</p>
      <ul>
        <li><strong>共识主题</strong>：……（来源：<a href="...">…</a>）</li>
      </ul>
    </div>

    <div class="summary-block">
      <h4>分歧与批评</h4>
      <ul>
        <li><strong>焦点</strong>：A 方 vs B 方；或主要风险点。</li>
      </ul>
    </div>

    <div class="summary-block">
      <h4>值得引用的原话</h4>
      <!-- 可选；有维护者/核心贡献者原话再写 -->
      <blockquote>……</blockquote>
      <div style="font-size:13px;color:var(--muted)">— 姓名/handle，身份 — <a href="...">出处</a></div>
    </div>
  </div>

  <!-- ==================== 六、趋势与持续跟踪 ==================== -->
  <div class="section">
    <div class="section-title"><span class="num">六</span> 趋势与持续跟踪</div>

    <div class="summary-block">
      <h4>跨仓库趋势信号</h4>
      <ul>
        <li><strong>信号</strong>：为何值得关注（尽量点名 2+ 个 repo 作证据）。</li>
      </ul>
    </div>

    <div class="watch-item">
      <strong>跟踪：</strong>未合并大 PR / 开放 RFC / 里程碑。关注 <em>什么信号</em>。
    </div>
  </div>

</div>
</body>
</html>
```

## 质量标准

- 每条 GitHub 事实有可点击的官方链接（PR / Issue / Release）
- 优先 `$SINCE` 之后发生或发布的内容
- 报告正文中文；仓库名、标题、标签、专有名词保留英文原文
- **主数据必须来自 `gh`**；websearch 不得充当 PR/Issue 列表来源
- 排除：bot 噪音、awesome 加链接、无实质改动、与主题无关擦边项
- 单一无法交叉验证的外部解读，在来源处标注「⚠️ 单一来源」
- 入报事件卡片合计 **Top-`$TOP_N`**（默认 35，建议 30–40）；禁止隐性再压到更小 Top-K，也禁止用低分条目凑满 N
- 发生截断时，速览须同时给出「达标 M」与「入报 Top-N」
- 筛选后高质量卡片过少时，用 `.quality-note` 如实说明，**不填充低价值条目**
- 数字统计与卡片列表一致（不要写「合并 40」却只列 2 条又不说明「筛选后」）
- 使用 `write` 写入最终 HTML
- 完成后用 `open` 打开 HTML 预览

## 工具使用约束

1. 主 Agent：用 `bash` 调用 `gh`；解析 JSON 可用 `jq`
2. 子 Agent：仅 `websearch`，用于解读与趋势
3. 不要把完整 `gh` 原始 JSON 糊进 HTML；先筛选再写卡片
4. `gh` 失败时（认证/限流）：说明错误，可降级为「仅已拿到的数据 + websearch」，并在 `.quality-note` 标明
