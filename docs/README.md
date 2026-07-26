# 文档索引

本目录存放 MCU 工具箱的结构与架构说明。业务代码仍以仓库根目录 `README.md` 与 `CLAUDE.md` 为入口。

| 文档 | 说明 |
|------|------|
| [architecture.md](./architecture.md) | 目录职责、进程模型、共享包与扩展关系 |
| [../README.md](../README.md) | 功能概览、快速开始、打包与使用 |
| [../CLAUDE.md](../CLAUDE.md) | 开发约定、命令、改动边界 |

## 本地生成物（不入文档、不入库）

- `toolchain/`：运行时下载的工具链
- `tools/`：Windows busybox 小工具
- `node_modules/`、`dist/`、`renderer/dist/`
- `*.vsix`、`plugins/**/vendor/`

## 维护约定

1. 新增顶层目录时，同步更新本索引与根 `README.md` 项目结构。
2. 架构变更优先改 `architecture.md`，再在 `README.md` 保留精简结构树。
3. 临时方案/设计草稿不要长期堆在仓库根目录；需要保留时放 `docs/` 并在本索引登记。
