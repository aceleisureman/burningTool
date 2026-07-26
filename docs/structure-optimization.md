# 结构优化记录

## 本轮目标

- 降低超大文件复杂度。
- 恢复可执行的 lint/CI 质量门禁。
- 保持 IPC 通道、业务行为和公共模块导出兼容。
- 清理未使用的大体积副本和构建产物。

## 已完成

| 区域 | 优化结果 |
|---|---|
| `renderer/src/App.vue` | 页面模板拆到 `views/`，根组件保留装配与切换 |
| `renderer/styles.css` | 拆到 `styles/base.css`、`layout.css`、`tools/*.css` |
| `src/main/index.js` | IPC 拆到五个 registrar，入口聚焦生命周期 |
| `toolchain/toolchain.js` | 改为兼容门面，内部拆为 paths/status/installer/system-path |
| `flash/flasher.js` | 改为兼容门面，内部拆为 probe/project/build/runner |
| ESLint | 使用 flat config，Vue/Node/ESM 均可检查 |
| CI | 发布前执行 `npm run check` |
| HTTP 测试 | 支持 `port: 0` 随机端口，避免与运行中的应用冲突 |
| 字体 | 删除未引用 TTF 和 WOFF，仅保留 WOFF2 |
| 本地目录 | 清理 `resources/` 重复副本和历史 `dist/` 产物 |
| 依赖安全 | 非强制补丁升级 15 个间接依赖，生产依赖审计为 0 |

## 后续建议

1. 分批消除现有 `no-unused-vars` warning，再将 lint 提升为零 warning 门禁。
2. 为 IPC registrar 增加 handler 清单测试，防止 preload 与主进程漂移。
3. 评估渲染主包拆分，按工具页面异步加载，降低初始 JS 体积。
4. Electron、electron-builder、Vite、ESLint 的剩余开发/构建链告警需要单独进行主版本迁移，避免直接使用破坏性 `npm audit fix --force`。
5. Git 对象库约 1.1 GB，后续可在确认历史保留策略后单独执行仓库压缩或历史清理。
