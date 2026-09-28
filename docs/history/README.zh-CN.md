# 提交元数据迁移

[English](README.md)

2026-09-27，主分支修正了 Git 署名：四条提交沿用了工作站的默认身份，十三条提交说明包含 AI 共同作者行。前者的作者和提交者现为 `Sheng Wan <swan0624@uw.edu>`。其余九条原本使用 Sheng Wan 的 GitHub noreply 身份，保持不变。

带注释标签 `launch-2026-09-05` 指向内容相同的新提交。标签注释中的一条 AI 共同作者行已移除；标签署名、日期及其他文字保持不变。原主线提交与该标签均没有签名。

## 校验

十三条迁移后的主线提交均与原提交具有完全相同的文件树，日期和其余提交说明逐字节不变。此次迁移未改变代码、网站内容、媒体、数据或许可证。署名规则及本记录属于单独的文档提交，并标记 `[skip ci]`；没有启动测试、构建或部署。

[commit-map.csv](commit-map.csv) 列出旧编号、新编号及相同的文件树编号。[rewrite-audit.json](rewrite-audit.json) 保存核验结果。原构建、测试和部署记录保留当时的提交编号；映射后的编号表示内容相同，不代表重新执行。经验证的私有备份包含原历史和完整本地工作目录，包括忽略及未跟踪文件。

## 本地同步

保留旧工作目录，将仓库重新克隆到新目录。只迁移必要的本地改动和结果；不要复制旧 `.git` 目录或合并旧主线历史。旧记录中的版本可通过映射表定位。新提交应使用 AGENTS.md 指定的仓库本地身份。

## 贡献者统计

GitHub 的贡献者显示与 Git 提交元数据分别维护。改写历史后，统计通常需要约 24 小时刷新；持续不一致可向 GitHub Support 反馈。参见 [GitHub 贡献者文档](https://docs.github.com/en/repositories/viewing-activity-and-data-for-your-repository/viewing-a-projects-contributors#contributor-data-is-stale-after-history-changes)。

旧提交链接、Actions 记录、PR 引用、缓存和其他克隆可能仍保留原元数据。此次迁移不声称清除这些副本，也不改变项目的实际创作方式。来源归属与许可证继续保留。
