---
description: 生成英文学术论文周报（预印本 / 录用 / 热度），按主题过滤；顶会动态发现
argument-hint: "<主题> [时间范围] [Top-N，默认 35，建议 30–40]"
---

你是一位专注学术前沿的研究分析师。你的任务是用中文生成一份高质量的 **英文学术论文周报**。

## 输入

- **主题**（必填）：`$1`。自由关键词或短语（如 `AI Agent`、`Gaussian Splatting`、`LLM safety`、`tool use`）。
- **时间范围**（可选）：`${2:-过去 7 天}`，可由 `$ARGUMENTS` 中第二段覆盖。
- **Top-N**（可选）：`${3:-35}`。最终入报论文上限，**建议 30–40**；默认 `35`。若用户给出不在 30–40 的整数，仍可尊重，但在 `.quality-note` 标明。

若 `$1` 为空，输出用法说明并停止：

```
用法：/paper-weekly <主题> [时间范围] [Top-N]
示例：/paper-weekly AI Agent
      /paper-weekly Gaussian Splatting 过去 7 天
      /paper-weekly LLM reasoning 2026-07-20
      /paper-weekly AI Agent 过去 7 天 40
```

将时间范围解析为 ISO 日期 `$SINCE`（默认：今天往前推 7 天，格式 `YYYY-MM-DD`）。报告覆盖 `$SINCE` ~ 今天（`$TODAY`，本机日期）。解析时注意：若第二段是纯数字，则视为 `Top-N`，时间范围仍用默认。

## 核心理念

**可验证的论文元数据 > 媒体二手解读。**

- 主事实层来自 **并行 general-purpose 子 Agent** 内 `curl` 调学术 API（arXiv ×2 / OpenAlex ×2 / HuggingFace Daily Papers / Semantic Scholar / Crossref；含 IEEE 等付费 venue 的**公开摘要**）
- **只收录英文论文**（`language:en` 或标题/摘要为英文；中文刊、中文标题一律丢弃）
- **不维护静态顶会路由表**；venue 从本周检索命中中**动态统计与发现**
- **IEEE / ACM / Springer 等付费站**：不下载全文、不绕过付费墙；**仅用公开 title + abstract 判定相关性与入报**；有 DOI / IEEE Xplore 摘要页 / OpenAlex 记录即可
- websearch 只解释「为什么重要」和社区反应，不替代论文列表
- **最终输出 Top-N 截断**：相关性达标后按分数排序，取前 `$TOP_N` 篇入报告（默认 35，建议 30–40）；可按方向聚类展示，不要为版面再二次砍卡

## 执行流程

**主 Agent 只做编排与汇总**：解析参数 → 启动/等待子 Agent → 合并打分 → 写 HTML。  
**禁止**主 Agent 自己批量 `curl` 学术 API；采集与（可选）缺口补查一律交给 `general-purpose` 子 Agent（因其可执行 `bash`/`curl`）。  
**禁止**用 websearch 枚举本周论文全集。

### Step 0：解析主题与 Query 变体（主 Agent）

1. 计算 `$SINCE`、`$TODAY`、`$TOP_N`。
2. 生成英文 query 变体（**检索只用英文**）：
   - 用户原文若是中文 → 必须译成 1–3 个地道英文学术检索式（如「具身智能」→ `embodied AI` / `embodied agent` / `vision-language-action`）
   - 用户原文已是英文 → 保留原文，并可选扩展 1–2 个近义/子领域写法（如 `AI Agent` → `tool-using agent` / `agentic LLM`）
   - 记录为 `$Q_PRIMARY`、`$Q_ALT1`、`$Q_ALT2`…
3. **不要**预设 venue 白名单；不要猜测「该主题属于哪个顶会」。Venue 留给采集结果动态统计。

### Step 1：并行启动采集子 Agent（全部 general-purpose）

以下 **7 个为必跑基线**，**同一轮全部同时启动**（每个 `run_in_background: true`，`subagent_type: "general-purpose"`）。  
不要串行等完一个再开下一个——并行是默认。  
各 Agent 内自行 `bash` + `curl`（可用 `jq` / `python3` 解析），**返回结构化候选列表**（不要塞完整原始 JSON/XML）。

**限流注意（写入相关 prompt）：**

- **arXiv**：全站限流严，C1/C2 **不要**再对 arXiv 开更多并行；Agent 内部多 query 之间 `sleep 3`
- **OpenAlex / S2 / Crossref / HF**：可跨 Agent 并行；单 Agent 内遇 429 则 sleep 后重试 1 次，失败记入 note

统一约定（写入每个 prompt）：

```
UA='paper-weekly/1.0 (mailto:local@example.com; research digest)'
Time window: $SINCE .. $TODAY
English papers only. Discard non-English titles/abstracts.
Return a compact bullet/JSON list of candidates with fields when available:
  title, authors, date, venue_or_arxiv_cat, arxiv_id, doi, abs_url, pdf_url_or_landing,
  abstract_snippet (≤400 chars), cited_by_count, hf_upvotes, source_tag, one_line_contribution
Do NOT invent abstracts or metrics. If abstract missing, leave empty.
```

**Agent C1 — arXiv · primary query**

```
subagent_type: "general-purpose"
description: "采集-arXiv主查询"
prompt: |
  You collect English arXiv preprints for a weekly paper digest. Use bash + curl only (no websearch for listing).

  UA='paper-weekly/1.0 (mailto:local@example.com; research digest)'
  SINCE=$SINCE
  TODAY=$TODAY
  Query (PRIMARY only): $Q_PRIMARY

  curl -sG "https://export.arxiv.org/api/query" \
    -H "User-Agent: $UA" \
    --data-urlencode "search_query=all:\"$Q_PRIMARY\"" \
    --data-urlencode "sortBy=submittedDate" \
    --data-urlencode "sortOrder=descending" \
    --data-urlencode "start=0" \
    --data-urlencode "max_results=80"

  Optional follow-up (sleep 3 first): from this page's primary_category histogram, one query
  (cat:TOP1 OR cat:TOP2 ...) AND all:"$Q_PRIMARY", max_results=50.

  Parse Atom/XML. Keep published >= SINCE (or updated >= SINCE with vN>=2 as "vN update").
  Normalize arxiv_id to XXXX.XXXXX. Extract title, summary, authors, dates, categories, abs_url, pdf_url.
  English only. Drop CJK-dominant text.
  source_tag=arxiv. Return up to ~80 unique candidates. No full XML dump.
run_in_background: true
```

**Agent C2 — arXiv · alt queries**（无 ALT 则仍启动，立即返回 empty + note）

```
subagent_type: "general-purpose"
description: "采集-arXiv副查询"
prompt: |
  You collect English arXiv preprints using ALT queries only. Use bash + curl only.

  UA='paper-weekly/1.0 (mailto:local@example.com; research digest)'
  SINCE=$SINCE
  TODAY=$TODAY
  Alt queries: $Q_ALT1 ; $Q_ALT2 (skip empties). If no alts: return empty list and note "no alts".

  For each alt query (sleep 3 between requests):
  curl -sG "https://export.arxiv.org/api/query" \
    -H "User-Agent: $UA" \
    --data-urlencode "search_query=all:\"<alt>\"" \
    --data-urlencode "sortBy=submittedDate" \
    --data-urlencode "sortOrder=descending" \
    --data-urlencode "start=0" \
    --data-urlencode "max_results=60"

  Same parse/filter rules as primary arXiv: published>=SINCE (or vN update), English only, normalize arxiv_id.
  source_tag=arxiv_alt. Compact unique candidates only.
run_in_background: true
```

**Agent C3 — OpenAlex · primary**

```
subagent_type: "general-purpose"
description: "采集-OpenAlex主查询"
prompt: |
  You collect English works from OpenAlex (PRIMARY query). Use bash + curl only.

  UA='paper-weekly/1.0 (mailto:local@example.com; research digest)'
  SINCE=$SINCE
  TODAY=$TODAY
  Query: $Q_PRIMARY

  curl -sG "https://api.openalex.org/works" \
    -H "User-Agent: $UA" \
    --data-urlencode "search=$Q_PRIMARY" \
    --data-urlencode "filter=from_publication_date:$SINCE,to_publication_date:$TODAY,language:en" \
    --data-urlencode "sort=publication_date:desc" \
    --data-urlencode "per_page=50" \
    --data-urlencode "select=id,doi,title,display_name,publication_date,type,cited_by_count,authorships,primary_location,open_access,concepts,abstract_inverted_index"

  Paginate page=2.. while useful or until relevance collapses.
  Reconstruct abstract from abstract_inverted_index with short Python if needed; never fabricate.
  Keep type article/preprint; drop paratext.
  Capture primary_location.source.display_name as venue (no fixed whitelist).
  Return candidates (source_tag=openalex) + venue_histogram from your hits.
run_in_background: true
```

**Agent C4 — OpenAlex · alt queries**（无 ALT 则 empty + note）

```
subagent_type: "general-purpose"
description: "采集-OpenAlex副查询"
prompt: |
  You collect English works from OpenAlex using ALT queries only. Use bash + curl only.

  UA='paper-weekly/1.0 (mailto:local@example.com; research digest)'
  SINCE=$SINCE
  TODAY=$TODAY
  Alts: $Q_ALT1 ; $Q_ALT2 (skip empties). If none: return empty + note "no alts".

  For each alt: same OpenAlex works endpoint as primary, filter date+language:en, per_page=50,
  paginate lightly (1–2 pages) if meta.count large. Dedupe within this agent by OpenAlex id/DOI/title.
  Reconstruct abstracts when inverted index present. Keep article/preprint.
  source_tag=openalex_alt. Return compact candidates + venue_histogram.
run_in_background: true
```

**Agent C5 — HuggingFace Daily Papers（热度）**

```
subagent_type: "general-purpose"
description: "采集-HF热度"
prompt: |
  You collect HuggingFace Daily Papers signals. Use bash + curl only.

  UA='paper-weekly/1.0 (mailto:local@example.com; research digest)'
  SINCE=$SINCE
  Queries: $Q_PRIMARY and alts $Q_ALT*

  curl -s "https://huggingface.co/api/daily_papers" -H "User-Agent: $UA"
  Filter publishedAt >= SINCE. Keyword/semantic filter title/summary against queries (English).
  Keep paper.id (arxiv), upvotes, title, summary, authors.
  source_tag=hf. HF is recall+heat only — return candidates even if later merged with arXiv.
  Compact list only.
run_in_background: true
```

**Agent C6 — Semantic Scholar（含 IEEE 等付费 venue 公开摘要）**

```
subagent_type: "general-purpose"
description: "采集-S2摘要"
prompt: |
  You search Semantic Scholar for English papers (including paywalled IEEE/ACM/Springer)
  for theme "$Q_PRIMARY" (alts: $Q_ALT*) in window $SINCE .. $TODAY.
  Use bash + curl only. Do NOT download full PDFs, do NOT bypass paywalls.
  Relevance from TITLE + ABSTRACT only.

  For primary and each alt (if 429, sleep 2–5s and retry once):
  curl -sG "https://api.semanticscholar.org/graph/v1/paper/search" \
    -H "User-Agent: paper-weekly/1.0 (mailto:local@example.com; research digest)" \
    --data-urlencode "query=<query>" \
    --data-urlencode "limit=50" \
    --data-urlencode "fields=title,abstract,year,venue,publicationDate,externalIds,url,citationCount,authors"

  Client-filter publicationDate into [$SINCE,$TODAY] when present; if only year, keep current/prior year and mark date_uncertain=true.
  Prefer IEEE / IEEE Xplore / Trans. / ACM / Springer venue strings, but keep other formal venues if highly on-topic.
  Drop if abstract empty AND title ambiguous. Never claim full-text access.
  Landing: DOI, S2 url, or IEEE abstract page if in externalIds.
  source_tag=s2 (add ieee_paywall_abstract when venue looks paywalled).
  Return compact candidates + which queries worked/failed.
run_in_background: true
```

**Agent C7 — Crossref（正式 DOI / 付费刊摘要）**

```
subagent_type: "general-purpose"
description: "采集-Crossref"
prompt: |
  You collect English works via Crossref for theme "$Q_PRIMARY" (alts: $Q_ALT*)
  in window $SINCE .. $TODAY. Use bash + curl only. No PDF downloads / no paywall bypass.

  UA='paper-weekly/1.0 (mailto:local@example.com; research digest)'

  For primary and alts:
  curl -sG "https://api.crossref.org/works" \
    -H "User-Agent: $UA" \
    --data-urlencode "query=<query>" \
    --data-urlencode "filter=from-pub-date:$SINCE,until-pub-date:$TODAY" \
    --data-urlencode "rows=50" \
    --data-urlencode "select=DOI,title,author,published-print,published-online,abstract,container-title,type,URL,is-referenced-by-count"

  Prefer type journal-article / proceedings-article. English titles/abstracts only.
  Strip JATS tags from abstract if present. If no abstract: keep only when title strongly on-topic; mark abstract_missing=true; else DROP.
  Capture container-title as venue (IEEE/ACM/Springer appear naturally — no whitelist).
  source_tag=crossref. Compact candidates only.
run_in_background: true
```

记录 `$ID_C1` … `$ID_C7`。

启动方式要求：

1. **一轮内同时**发出全部 7 个 `subagent(..., run_in_background: true)`（可在同一助手回合并行调用）
2. 不要先 `wait` C1 再启动 C2…
3. 若某 ALT 为空：对应 C2/C4 仍启动，由其快速返回 empty（保持编排统一）

### Step 2：等待采集结果

```
get_subagent_result(agent_id: $ID_C1, wait: true)
get_subagent_result(agent_id: $ID_C2, wait: true)
get_subagent_result(agent_id: $ID_C3, wait: true)
get_subagent_result(agent_id: $ID_C4, wait: true)
get_subagent_result(agent_id: $ID_C5, wait: true)
get_subagent_result(agent_id: $ID_C6, wait: true)
get_subagent_result(agent_id: $ID_C7, wait: true)
```

若某一路失败/空：不阻塞其它源；在后续 `.quality-note` 标明降级。

### Step 3：主 Agent 过滤、去重、动态顶会、相关性 + Top-N

合并 **C1–C7** 全部候选。

#### 去重键（按优先级）

1. arXiv id  
2. DOI  
3. 归一化标题（小写、去标点、压缩空白）

合并字段：同一论文可同时有 arXiv 链接、DOI、venue、HF upvotes、cited_by_count、付费 venue 摘要来源。

#### 必须丢弃

- 非英文（标题或正文主语言）
- 与主题仅词面擦边、摘要核心贡献明显属于其他领域
- 无标题 / 无任何可用链接（无 arXiv、无 DOI、无 OpenAlex/S2/IEEE 落地页）
- **付费 venue 且无可用摘要、标题又不足以判定主题** → 丢弃（禁止凭刊名瞎收）
- 明显非研究论文（招生广告、CfP 正文当 paper、纯新闻稿）
- 重复上传的相同工作（保留信息更全的一条）

#### 相关性打分 + Top-N 截断

对每条打粗分，**低于阈值的丢弃**；达标者按 `score` 降序排列，**取前 `$TOP_N` 篇**（同分可看 HF upvotes、cited_by_count、是否多源交叉）：

```
score =
  +3  标题命中 $Q_PRIMARY 或强等价 ALT
  +2  摘要前几句命中主题机制/任务（非仅背景句）
  +2  动态 core venue 命中（见下）
  +1  HF upvotes ≥ 1 或 cited_by_count 相对同周偏高
  +1  多源交叉出现（arXiv ∩ OpenAlex 或 arXiv ∩ HF 或 S2 ∩ OpenAlex 等）
  -3  仅共享泛词（如只因 "learning" / "model" 命中）
```

建议阈值：`score >= 3`（可按主题宽窄微调；放宽时在 quality-note 说明）。

**Top-N 规则：**

- 默认 `$TOP_N = 35`，建议范围 **30–40**
- 达标篇数 ≤ `$TOP_N` → 全部入报
- 达标篇数 > `$TOP_N` → 只输出前 `$TOP_N`；在速览写明「达标 M 篇，入报 Top-$TOP_N」
- 截断掉的高相关尾巴**不要**偷偷塞回卡片；可选在「趋势与持续跟踪」用一句话点名 1–3 个未入报但值得盯的方向
- **禁止**再压到 Top-10 之类更小的隐性上限；也不要为了凑满 N 而塞低分噪音

#### 动态顶会 / 期刊发现（替代路由表）

对本周**通过相关性过滤**的条目统计：

```
venue_histogram[source_display_name] += 1
```

规则：

1. 出现次数 ≥ 2 的 venue → 列入 **本周活跃 venue**
2. 出现 1 次但名称像正式会议/期刊、或伴随高 citation/HF 热度 → 仍可进直方图，标为 **长尾 venue**
3. 仅有 arXiv categories、无正式 venue → 计入 **`arXiv-only`**，并按 `primary_category` 做第二直方图
4. IEEE / 付费刊名与其它 venue **同等对待**，全部由本周数据进入直方图（不写死 IEEE 白名单，也不排除 IEEE）
5. 从活跃 venue + 论文标题/摘要中归纳 **3–8 个研究方向簇**（cluster 名用中文+英文术语），每篇论文挂到 1 个主簇（可另打 secondary tag）

将下列中间结果带入后续步骤：

1. **入报论文列表**（达标且进入 Top-`$TOP_N`）  
   字段：`标题 | 作者 | 日期 | venue或arXiv cat | 链接 | 指标(upvotes/cited) | 簇 | score | 一句话贡献 | 来源标记 | abstract_only?`
2. **截断统计**：达标总数 M、入报 min(M, TOP_N)、是否发生截断
3. **Venue 直方图**（动态顶会发现结果；可基于达标全集统计，不限于 Top-N）
4. **方向簇列表**（入报集合上聚类）
5. **需外部解读的重磅清单** 3–8 篇（从入报列表里挑：新方法、新基准、明显 SOTA、高 HF 热度、高争议设定、高影响力 IEEE/正式刊）——仅用于 websearch

### Step 4：websearch 子 Agent（并行，仅补上下文）

只针对 Step 3 的重磅清单与整体趋势，**不要**用 websearch 重新枚举本周论文全集。

同时启动，每个 `run_in_background: true`：

**Agent W1 — 论文/作者一手解读**（有 ≥1 篇重磅时启动）

```
subagent_type: "websearch"
description: "论文-作者解读"
prompt: |
  Time window: since $SINCE to $TODAY.
  Topic: $Q_PRIMARY (alts: $Q_ALT*)
  Focus papers (use these exact titles / arXiv ids / DOI / links):
  - <paper 1: title, arxiv or doi, url>
  - <paper 2: ...>
  Find: author Twitter/X threads, official blog posts, project pages, code releases, talk slides.
  For each: what the authors claim is new, key results, limitations they admit, primary links.
  English sources preferred. Do NOT dump unrelated paper lists.
  Paywalled IEEE/ACM: secondary commentary is fine; do not claim you read the full PDF.
run_in_background: true
```

**Agent W2 — 社区反应与二手深度**（默认启动）

```
subagent_type: "websearch"
description: "论文-社区反应"
prompt: |
  Time window: since $SINCE to $TODAY.
  Topic: $Q_PRIMARY
  Papers or claims to check reactions for:
  - <title / arxiv / doi / one-line claim>
  Search: Twitter/X, Reddit, Hacker News, HuggingFace paper pages, blogs, Chinese tech media (机器之心、专知、知乎深度) discussing THESE papers or the same narrow topic this week.
  Extract: praise, skepticism, reproducibility notes. Cite links.
  Do not invent papers not in the focus list; if you find an important English paper from this week missing from the list, return it as "candidate miss" with link for the main agent to verify via a general-purpose curl agent (arXiv/OpenAlex/S2) — never accept second-hand titles alone.
run_in_background: true
```

**Agent W3 — 主题趋势叙事**（默认启动）

```
subagent_type: "websearch"
description: "论文-主题趋势"
prompt: |
  Time window: since $SINCE to $TODAY.
  Research theme: $Q_PRIMARY (alts: $Q_ALT*)
  Dynamically observed venues this week (not a fixed whitelist):
  - <venue histogram top entries>
  What research narrative is forming? New benchmarks, problem formulations, method families, or evaluation critiques.
  Prefer primary sources and technical blogs over SEO listicles.
  Return 3-8 trend bullets with sources.
run_in_background: true
```

记录 `$ID_W1`, `$ID_W2`, `$ID_W3`（未启动的跳过）。

### Step 5：等待 websearch 结果

```
get_subagent_result(agent_id: $ID_W1, wait: true)
get_subagent_result(agent_id: $ID_W2, wait: true)
get_subagent_result(agent_id: $ID_W3, wait: true)
```

### Step 6：缺口评估与补充（仍用子 Agent）

对照清单：

- [ ] 主列表是否主要来自 general-purpose 子 Agent 的 curl API，而非媒体「每周论文」转载
- [ ] 是否全部为英文论文
- [ ] 是否已产出 **动态 venue 直方图**（哪怕大量是 arXiv-only）
- [ ] 付费 venue（如 IEEE）是否仅在有摘要/强标题证据时入报
- [ ] 重磅篇是否至少有 1 条外部解读或明确写「暂无作者解读」
- [ ] W2 若回报 `candidate miss`：必须再启 **general-purpose** 子 Agent 用 arXiv/OpenAlex/S2 **curl 核实日期与英文** 后决定并入，不直接信二手标题

若召回不足，启动补充 Agent（可多个，`run_in_background: true`）：

```
subagent_type: "general-purpose"
description: "补充-论文召回"
prompt: |
  Gap fill for paper weekly. Theme $Q_PRIMARY / alts. Window $SINCE..$TODAY.
  Reason for this run: <e.g. too few hits / need alt query / top arXiv cats / verify candidate miss URLs>.
  Use bash+curl on arXiv / OpenAlex / Semantic Scholar as needed. Sleep 3 between arXiv calls.
  English only. Return compact new candidates; for paywalled venues require abstract for inclusion.
run_in_background: true
```

解读侧缺口：再启聚焦 `websearch`，prompt 绑定具体论文 URL/标题。

补充后重新打分排序，仍只保留 Top-`$TOP_N`；不要为补缺口而突破 N，除非用户显式给定了更大的 Top-N。  
**不要**回退到静态顶会白名单。

### Step 7：汇总并生成 HTML

用中文汇总，生成**自包含 HTML**，写入当前工作目录。

**文件路径**：`./YYYY-MM-DD-paper-weekly.html`（`YYYY-MM-DD` = `$TODAY`）

**HTML 结构必须严格遵循以下模板**——不要改整体结构；缺内容的区块如实写「本周暂无」，不要删 section。  
**论文卡片：输出 Top-`$TOP_N` 入报条目**（默认 35，建议 30–40）；可按方向簇分小节。不要在 Top-N 之外再二次截断，也不要为凑满 N 填充低分条目。

付费 venue 卡片：`tags` 可加 `IEEE` / `paywalled` 等；`source` 链到 DOI 或摘要落地页；正文依据摘要撰写，**不要假装读过全文**；可在「发生了什么」注明「基于公开摘要」。

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>学术论文周报 — {主题} — YYYY-MM-DD</title>
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
    --tag-preprint-bg: #f5f3ff;
    --tag-preprint-text: #5b21b6;
    --tag-accepted-bg: #ecfdf5;
    --tag-accepted-text: #065f46;
    --tag-hot-bg: #fff7ed;
    --tag-hot-text: #9a3412;
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
  .repo-list .meta-r { color: var(--muted); font-size: 13px; }

  .cluster-title {
    font-size: 16px;
    font-weight: 700;
    margin: 28px 0 12px;
    color: var(--text);
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
  .card .tag.preprint { background: var(--tag-preprint-bg); color: var(--tag-preprint-text); }
  .card .tag.accepted { background: var(--tag-accepted-bg); color: var(--tag-accepted-text); }
  .card .tag.hot { background: var(--tag-hot-bg); color: var(--tag-hot-text); }
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
    <h1>学术论文周报</h1>
    <div class="theme">{主题}</div>
    <p class="meta">覆盖周期：YYYY-MM-DD ~ YYYY-MM-DD &nbsp;|&nbsp; 报告生成：YYYY-MM-DD &nbsp;|&nbsp; 语种：English only</p>
  </div>

  <!-- 质量说明：召回明显不足、API 失败或阈值放宽时保留 .quality-note；否则删除此块 -->

  <!-- ==================== 一、本周研究速览 ==================== -->
  <div class="section">
    <div class="section-title"><span class="num">一</span> 本周研究速览</div>

    <div class="stats">
      <div class="stat"><div class="n">N</div><div class="l">入报论文（Top-N）</div></div>
      <div class="stat"><div class="n">N</div><div class="l">达标总数</div></div>
      <div class="stat"><div class="n">N</div><div class="l">arXiv 预印本</div></div>
      <div class="stat"><div class="n">N</div><div class="l">方向簇</div></div>
    </div>

    <h4 style="font-size:15px;margin-bottom:8px;">动态 Venue 分布（本周数据发现，非预设名单）</h4>
    <ul class="repo-list">
      <li>
        <span>Venue 或 arXiv-only / cs.XX</span>
        <span class="meta-r">N 篇</span>
      </li>
    </ul>

    <h4 style="font-size:15px;margin:16px 0 8px;">检索式</h4>
    <p style="font-size:14px;color:var(--muted)">Primary: … · Alt: …</p>
  </div>

  <!-- ==================== 二、论文条目（Top-N，按方向簇） ==================== -->
  <div class="section">
    <div class="section-title"><span class="num">二</span> 论文条目</div>
    <p style="font-size:13px;color:var(--muted);margin-bottom:12px">相关性达标后按分数取 Top-N（本报 N=…；达标 M 篇）。按本周动态聚类展示。</p>

    <!-- 每个方向簇一个 .cluster-title，其下 0..N 张 .card -->
    <div class="cluster-title">簇名（中文）· English label（N）</div>

    <div class="card">
      <h3>English Paper Title — 一句话贡献</h3>
      <div class="field">
        <div class="field-label">发生了什么</div>
        <div class="field-value">2-4 句客观说明：问题设定、方法要点、主要结果；不编造未给出的数字。付费 venue 注明基于公开摘要。</div>
      </div>
      <div class="field">
        <div class="field-label">为什么重要</div>
        <div class="field-value">对路线、基准、可复现性或下游系统的影响。</div>
      </div>
      <!-- 可选：有作者原话/线程再写 -->
      <div class="field">
        <div class="field-label">作者 / 社区要点</div>
        <blockquote>…</blockquote>
      </div>
      <div class="tags">
        <span class="tag preprint">preprint</span>
        <!-- 或 class="tag accepted" ；付费正式刊可用 accepted + venue 名 -->
        <span class="tag">venue or cs.CL</span>
        <span class="tag">子方向</span>
        <!-- 高 HF 热度时： <span class="tag hot">HF hot</span> -->
      </div>
      <div class="source">
        来源：<a href="https://arxiv.org/abs/..." target="_blank">arXiv</a>
        <!-- 有 DOI / IEEE 摘要页则附加 -->
        &nbsp;|&nbsp; Authors et al. &nbsp;|&nbsp; YYYY-MM-DD
        &nbsp;|&nbsp; cited N · HF↑ N
      </div>
    </div>
  </div>

  <!-- ==================== 三、方法对比与分歧 ==================== -->
  <div class="section">
    <div class="section-title"><span class="num">三</span> 方法对比与分歧</div>
    <!-- 基于本周论文集合；无足够对比则 empty -->
    <div class="summary-block">
      <h4>差异轴</h4>
      <ul>
        <li><strong>轴名</strong>：A 路论文 vs B 路论文；证据指向…</li>
      </ul>
    </div>
  </div>

  <!-- ==================== 四、录用与会务动态 ==================== -->
  <div class="section">
    <div class="section-title"><span class="num">四</span> 录用与会务动态</div>
    <!-- 仅写本周核实过的 accept / award / workshop；无则 empty -->
    <p class="empty">本周暂无显著录用或会务公告</p>
  </div>

  <!-- ==================== 五、社区解读 ==================== -->
  <div class="section">
    <div class="section-title"><span class="num">五</span> 社区解读</div>

    <div class="summary-block">
      <h4>共识</h4>
      <p style="font-size:13px;color:var(--muted);margin-bottom:8px">≥2 源指向同一方向；不足则少写，不编造。</p>
      <ul>
        <li><strong>共识主题</strong>：……（来源：<a href="...">…</a>）</li>
      </ul>
    </div>

    <div class="summary-block">
      <h4>质疑与局限</h4>
      <ul>
        <li><strong>焦点</strong>：…</li>
      </ul>
    </div>

    <div class="summary-block">
      <h4>值得引用的原话</h4>
      <blockquote>…</blockquote>
      <div style="font-size:13px;color:var(--muted)">— 姓名/handle — <a href="...">出处</a></div>
    </div>
  </div>

  <!-- ==================== 六、趋势与持续跟踪 ==================== -->
  <div class="section">
    <div class="section-title"><span class="num">六</span> 趋势与持续跟踪</div>

    <div class="summary-block">
      <h4>跨论文信号</h4>
      <ul>
        <li><strong>信号</strong>：为何值得关注（点名本周 ≥2 篇作证据）。</li>
      </ul>
    </div>

    <div class="watch-item">
      <strong>跟踪：</strong>code 是否开源 / camera-ready / 复现结果 / 后续 v2。关注 <em>什么信号</em>。
    </div>
  </div>

</div>
</body>
</html>
```

## 质量标准

- **仅英文论文**；中文标题或中文期刊正文不收录
- 每条有可点击的主链接（优先 arXiv abs，其次 DOI，再次 OpenAlex / Semantic Scholar / IEEE 摘要页）
- 优先 `$SINCE` 之后首次公开或正式记入 publication_date 的条目
- 报告正文中文；论文标题、术语、venue 名保留英文
- **主列表必须来自 general-purpose 子 Agent 的 curl API**；websearch 不得充当论文枚举来源；主 Agent 不得自己批量 curl 学术 API
- **禁止静态顶会白名单**；Venue 分布必须来自本周命中直方图
- **IEEE 等付费站**：只凭公开摘要（及强标题）判定；不绕过付费墙、不编造全文结果；无摘要且标题含糊则丢弃
- **达标后取 Top-`$TOP_N` 输出**（默认 35，建议 30–40）；用方向簇组织；禁止隐性再压到更小 Top-K，也禁止用低分条目凑满 N
- 发生截断时，速览须同时给出「达标 M」与「入报 Top-N」
- 排除：非英文、擦边泛词命中、无链接、非论文噪声
- 单一无法交叉验证的外部解读，在来源处标注「⚠️ 单一来源」
- 筛选后仍过少或 API 失败时，用 `.quality-note` 如实说明，**不填充低价值条目**
- 统计数字与卡片列表一致（「收录 N」= 第二节卡片数）
- 使用 `write` 写入最终 HTML
- 完成后用 `open` 打开 HTML 预览

## 工具使用约束

1. **主 Agent**：只编排——解析输入、启动/等待子 Agent、合并打分/聚类、写 HTML；**不要**自己跑 arXiv/OpenAlex/HF/S2 的批量采集 curl
2. **采集 / 核实 / 缺口补查**：`subagent_type: "general-purpose"`，Agent 内用 `bash` + `curl`（`jq` / `python3` 解析）；需要网络请求与命令行时用它，不用 websearch 冒充列表
3. **解读 / 趋势 / 社区反应**：`subagent_type: "websearch"`；漏检线索必须交回 general-purpose curl 核实
4. 不要把完整 API JSON/XML 糊进 HTML；先筛选再写卡片
5. arXiv 多请求之间 `sleep 3`；OpenAlex / S2 带合理 `User-Agent`；注意各 API 限流
6. 部分采集 Agent 失败时：用已拿到的源继续，并在 `.quality-note` 标明降级
7. **永远不要**为了「像顶会周报」而写死 NeurIPS/ICML/IEEE… 过滤列表；顶会/IEEE 出现与否完全由本周数据决定
8. **永远不要**下载或破解付费全文；摘要足够写卡片，不够则丢弃或降级说明
