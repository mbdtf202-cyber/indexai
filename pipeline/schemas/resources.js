/**
 * resources 层的行 schema（T3.5 · S3.2）。
 *
 * 行来自 `curated/toolkit.json`（人工挑选的工具清单，字段是
 * `id` / `repo` / `use` / `title` / `why`），再由 GitHub API 补星数与更新时间。
 *
 * ⚠️ 标题字段是 **`title`**，不是 `name` —— 与 models / events 的通名不同，
 * schema 必须跟着真实字段走，不能套用别层的习惯。
 */

export const RESOURCE_ROW = {
  id: { type: 'string', required: true },
  repo: { type: 'string', required: true },
  title: { type: 'string', required: true },
  status: { type: 'string', required: true },
  stars: { type: 'number', min: 0 },
  forks: { type: 'number', min: 0 },
};

export const RESOURCE_ROW_RULES = [
  {
    /* repo 必须是 `owner/name` 两段：GitHub API 的路径参数，写成一段会 404。 */
    id: 'repo-shape',
    check: (row) =>
      typeof row.repo === 'string' && row.repo.split('/').length !== 2
        ? `repo=${row.repo} 不是 owner/name`
        : null,
  },
];

export const RESOURCE_QUARANTINE_THRESHOLD = 0.02;
