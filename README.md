# 11gal · Demo 展示与讨论页

公开展示网址：<https://yizhang-dream.github.io/11gal-demos/>

本仓库仅用于托管经作者亲自确认公开讨论的阶段性 Demo（交互原型、美术视觉、音频试听、视频片段），与私有剧本/企划创作仓物理隔离。

## 目录结构

- `index.html`、`assets/`：纯静态展示框架，自动适应浅色/深色系统主题，支持分类筛选与原生 `<dialog>` 讨论详情弹窗。
- `demos.json`：展示清单配置文件；初始 `demos` 为空数组，按作者点名逐步新增。
- `demos/<slug>/`：每个上架 Demo 的独立静态资源目录。

## `demos.json` 条目格式

```json
{
  "id": "demo-slug",
  "title": "条目标题",
  "category": "interactive",
  "status": "待讨论",
  "date": "2026-11-20",
  "summary": "一句话说明本条 Demo 想讨论或验证什么。",
  "cover": "./demos/demo-slug/cover.jpg",
  "url": "./demos/demo-slug/",
  "media": {
    "type": "image",
    "src": "./demos/demo-slug/preview.png"
  },
  "tags": ["Live 2.5D", "三渲二"],
  "notes": [
    "讨论点 1：机位与景别是否合适",
    "讨论点 2：立绘光影融合度"
  ]
}
```
