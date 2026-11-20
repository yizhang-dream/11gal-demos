# 拾壹 · 试作陈列室（11gal Showcase）

公开展示网址：<https://yizhang-dream.github.io/11gal-demos/>

本仓库仅用于托管经作者亲自确认公开讨论的阶段性 Demo（交互原型、美术视觉、音频试听、影像片段），与私有剧本/企划创作仓物理隔离。

## 视觉风格与结构

- **宣纸水墨 × 晶透磨砂 × Galgame 陈列室**：昼（晴岚宣纸淡墨）/ 夜（墨夜星湖月影）双境水墨底图，自适应系统主题并支持顶部两态切换；搭配浮墨微尘画布与磨砂玻璃对话框、朱砂印章题签。
- **`demos.json`**：展示清单配置文件；初始 `demos` 为空数组，按作者点名逐步新增。
- **`demos/<slug>/`**：每个上架 Demo 的独立静态资源目录。

## `demos.json` 条目格式

```json
{
  "id": "demo-slug",
  "title": "条目标题",
  "category": "interactive",
  "status": "待商榷",
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
