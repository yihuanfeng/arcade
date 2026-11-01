# Arcade 体感游戏平台

Web 端体感游戏平台（类似「活力街」）：打开浏览器，用摄像头识别身体与手部，通过手势操作界面和玩游戏。提供电脑端 Mock 输入，便于开发和测试。

适配手机横屏与投屏电视，UI 大字号、深色主题、页面无滚动。

## 功能特性

- **体感操控**：MediaPipe 实时识别人体骨架与双手（33 关键点），手即光标；操作界面统一「按住确认」交互（光标圆形进度条，加载满触发，避免划过误触）
- **多人同玩**：支持 1–4 人，每名玩家双手可用；玩家以霓虹色区分（P1 蓝 / P2 红 / P3 紫 / P4 绿）
- **站位确认**：每局开始前在画面内方形站位区站定 3 秒，边框变绿后自动开局
- **全局骨架小窗**：任意页面右下角常驻识别骨架（半透明无边框），Mock 与摄像头一致
- **数据留存**：每游戏每玩家独立记录历史最高分、总场次、最近 10 局及自定义统计
- **对局保障**：浏览器切后台自动暂停；加载动画、音效命名空间隔离、连击奖励等
- **输入抖动治理**：One-Euro 自适应滤波（静止强平滑、移动跟手），低置信度点防遮挡乱跳
- **引擎分层**：手势引擎 / 游戏引擎 / 通用 UI / 玩法工具箱分离，新游戏按目录独立挂载，大厅自动收录

## 现有游戏

| 游戏 | 人数 | 说明 |
|---|---|---|
| 打地鼠 | 1–3 | 工地场景，双手下拍打地鼠；戴头盔的要打两下；炸弹需触碰灭火否则爆炸；怪物碰触扣命；连击有奖励，难度随对局分 4 阶段递增 |
| 双人合力驾驶 | 1–2 | 双人分轴合体：P1 控上下、P2 控左右，合体飞船躲避流星与激光；能量球需两人同时碰到才得分（单人可降级为单手直控） |

## 技术栈

- Vue 3.5 + Vite 6 + TypeScript（严格模式，`vue-tsc` 校验）
- [MediaPipe Tasks Vision](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker)（`@mediapipe/tasks-vision@0.10.14`，运行时从 CDN 加载 ESM + WASM + 模型）
- Canvas 2D 游戏渲染（逻辑视口 1280×720，等比缩放居中）

## 快速开始

```bash
cd app
npm install
npm run dev        # 开发：http://localhost:5174
npm run build      # 类型检查 + 产物构建（app/dist/）
npm run preview    # 预览构建产物
```

### 打开方式

- `?src=mock`：强制 Mock 输入（不开摄像头，鼠标/键盘模拟双手）
- `?src=camera`：摄像头输入（需在 `localhost` 或 `https` 环境下，浏览器会请求摄像头权限）
- 浏览器缓存旧产物时，可带参数强刷，如 `http://localhost:5174/?src=mock&v=20261101`

### Mock 键位（电脑开发/测试）

| 玩家 | 右手 | 左手 | Tap |
|---|---|---|---|
| P1 | 鼠标 | WASD | 空格 |
| P2 | 方向键 | IJKL | Enter |
| P3 | 数字行（2/4/6/8 移动，5 Tap） | — | 5 |
| P4 | 小键盘（4/6/8/2 移动，5 Tap） | — | 小键盘 5 |

## 目录结构

```
Arcade/
├── app/                      # Vue 工程（整个前端应用）
│   ├── package.json          # 依赖与脚本
│   ├── vite.config.ts        # Vite 配置（base './'，适配 Pages 子路径）
│   ├── index.html
│   └── src/
│       ├── main.ts / App.vue # 装配：引擎单例、游戏注册、视图切换、全局光标层
│       ├── styles/main.css   # 全局样式变量与覆盖层
│       ├── core/             # 引擎层（与具体游戏无关）
│       │   ├── GameEngine.ts # 生命周期、canvas 封装、结算落库、暂停恢复
│       │   ├── GestureEngine.ts # 全局手势：Provider 切换、One-Euro 平滑、事件广播
│       │   ├── gestureUi.ts  # UI 统一 hold-to-confirm 交互
│       │   ├── gameKit.ts    # 通用玩法工具箱（粒子 / 飘字 / 特效）
│       │   ├── AudioManager.ts # 音频注册与播放（按游戏命名空间隔离）
│       │   ├── ScoreStore.ts # 每游戏每玩家历史统一存储
│       │   ├── poseRender.ts # 骨架绘制
│       │   └── providers/    # 输入源：MockProvider / MediaPipeProvider
│       ├── components/       # 通用 UI：游戏中心 / 站位确认 / 结算 / 姿态小窗 / 体感测试页
│       └── games/            # 每个游戏一个独立目录（资源按游戏存放）
│           ├── whack-a-mole/ # 打地鼠
│           └── co-pilot/     # 双人合力驾驶
├── arcade-resources/         # 素材库（APK 原件、解包脚本，git 过滤不入库）
├── .github/workflows/        # GitHub Pages 自动部署
├── README.md / AGENTS.md / ARCHITECTURE.md / LICENSE
└── .gitignore
```

新游戏开发：在 `app/src/games/<id>/` 建目录（素材放 `assets/`），实现 `GameSpec` + `GameInstance`，在 `App.vue` 注册后大厅自动出现卡片。详见 `AGENTS.md`。

## 素材与版权说明

- 游戏美术与音频素材来自作者本地解包 `arcade-resources/active-arcade.apk`（Unity Addressables 工程）的原版资源，仅用于本项目学习与技术演示；**素材版权归原开发者/发行方所有**，请勿用于商业分发。
- 个别原版素材不符合预期（如黑心道具），已用代码绘制替代。
- 骨架识别模型 `pose_landmarker_lite.task` 来自 Google MediaPipe，遵循其模型许可协议。

## 环境要求

- 摄像头模式需要 `localhost` 或 HTTPS 环境（浏览器安全策略）
- 建议 Chrome / Edge 最新版
- 手机横屏或投屏电视体验最佳；竖屏会显示旋转提示

## 许可

代码以 MIT 协议开源（见 `LICENSE`，版权人信息待填写）。素材版权归属见上文说明。
