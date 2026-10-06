# Arcade 体感游戏平台 — 架构说明

> 目标：做一个类似「活力街」的 Web 体感游戏平台，手机/投屏电视大屏显示。
> 打地鼠（Whack-A-Mole）是第一个游戏，素材全部来自活力街 APK 原版解包。
> 架构保证以后加新游戏（跳跃、躲避、运球…）时**不改引擎、只加一个模块**。

## 0. 工程形态

Vue3 + TypeScript + Vite 工程（原单文件版已重构升级）：

- 入口 `index.html` → `src/main.ts` → `src/App.vue`
- 构建 `npm run build`（vue-tsc 严格类型检查，未使用变量会阻断构建）
- 开发 `npm run dev`（5174）；生产预览 `npm run preview`（4173，产物 dist/）
- 素材**按游戏分目录**：`src/games/<gameId>/assets/{img,audio}`，
  由游戏模块 `import.meta.glob` 批量导入，构建时打包进 dist

## 1. 整体分层

```
┌───────────────────────────────────────────────────────────────┐
│ UI 层  App.vue / GameCenter.vue(大厅) / ResultOverlay.vue(结算) │
│        ReadyOverlay.vue(站位确认) / GestureTestPage.vue(测试页) │
│        PoseOverlay.vue(右下角身体姿态小窗)                     │
│        手势光标跟随 + 下压确认，全局大字号主题（适配手机/电视）     │
├───────────────────────────────────────────────────────────────┤
│ 游戏层  src/games/<gameId>/：实现 GameInstance 接口的可插拔模块 │
│         onEnter / onExit / update / render / onGesture        │
│         现状：whack-a-mole（打地鼠，单人/双人同屏）             │
├───────────────────────────────────────────────────────────────┤
│ 引擎层  src/core/                                             │
│         GameEngine   游戏注册表 + 状态机(lobby→ready→playing→   │
│                      over) + rAF 主循环 + 手势路由 + 结果落库   │
│                      ready=站位确认：姿态可见满 3s 自动开始      │
│         GestureEngine 全局体感：选择 camera/mock 源、玩家数切换 │
│                      姿态帧广播(poseFrames/onPose)、预览视频    │
│         AudioManager 音效池（注册/播放/节流/循环/BGM）         │
│         ScoreStore   localStorage 成绩持久化（best/last/…)     │
│         poseRender   共用骨架绘制（测试页/姿态小窗）            │
│         types.ts     Hand/GestureEvent/PoseFrame/Spec/Instance │
├───────────────────────────────────────────────────────────────┤
│ 体感层  src/core/providers/                                   │
│         MediaPipeProvider  真机摄像头（PoseLandmarker 姿态+手） │
│         MockProvider       电脑 Mock（鼠标=P1、方向键+回车=P2， │
│                             含虚拟人姿态帧模拟）                │
└───────────────────────────────────────────────────────────────┘
```

## 2. 游戏模块接口（新游戏只要实现这些）

```ts
// src/core/types.ts
interface GameSpec {
  id: string
  name: string
  desc: string
  icon?: string            // 大厅卡片图标
  maxPlayers: 1 | 2
  create(ctx: GameContext): GameInstance
}

interface GameInstance {
  onEnter(): void          // 进入游戏（重置状态、开始倒计时）
  onExit(): void           // 退出清理
  update(dt: number): void // 每帧逻辑
  render(ctx: CanvasRenderingContext2D, w: number, h: number): void
  onGesture(e: GestureEvent): void  // tap/point 手势回调
}
```

新游戏：在 `src/games/<id>/` 下实现 spec + 素材目录，然后在
`App.vue` 里 `engine.register(spec)`，即自动出现在大厅。

## 3. 体感与手势约定

- **坐标**：Provider 输出「视口归一化」手坐标（x/y ∈ 0..1）；
  `GameEngine.routeGesture` 把 y 换算到「画布显示区归一化」，x 按玩家区归一化。
- **手势事件**：`point`（手移动，多手）+ `tap`（下压确认）。
  游戏内用 tap 判定命中；大厅/结算用 point 移动光标、tap 确认按钮。
- **姿态帧**：`PoseProvider.onPose(PoseFrame[])` 广播身体骨架
  （33 点 MediaPipe Pose 语义，x/y 已镜像；`wristVisible` 供站位确认判定）。
  `GestureEngine.poseFrames` 保存最近一帧，`onPose` 可订阅；
  测试页与右下角姿态小窗用 `core/poseRender.ts` 的 `drawPoseFrames` 绘制。
- **站位确认（ready）**：`GameEngine.startGame` 先进入 `ready` 状态，
  所有玩家 `wristVisible` 持续满 `READY_SECONDS(3)` 后自动 `onEnter` + `playing`；
  未识别到会重置计时。`ReadyOverlay.vue` 显示进度与骨架预览。
- **身体姿态小窗**：游戏进行中 `PoseOverlay.vue` 固定右下角，
  显示摄像头画面（真机）或深色底（Mock）+ 实时骨架。
- **体感测试页**：大厅「🧪 体感测试」进入 `GestureTestPage.vue`，
  大画布预览（摄像头画面/骨架）、每玩家手坐标与可见性、tap 计数、输入源切换。
- **玩家区**：单人全区；双人左/右各半区，每玩家独立场（洞、命、分、连击）。
- **输入源**：`auto`（优先摄像头、失败自动降级 Mock）/ `camera` / `mock`。
  设置按钮在 GameCenter 左下，URL `?src=mock` 可强制 Mock。

### Mock 体感（电脑开发/测试用，无需摄像头）

| 输入 | 作用 |
|---|---|
| 鼠标移动 | P1 手位置 |
| 鼠标左键 / 空格 | P1 下压 tap |
| 方向键（按住） | P2 手位置（0.55/秒，松手停止） |
| 回车 | P2 下压 tap |

Mock 与真机输出同一套 GestureEvent，业务层无感知差异；
画面上叠加虚拟手瞄准环 + 右下角按键提示。

## 4. 打地鼠玩法参数（src/games/whack-a-mole/）

| 参数 | 值 | 说明 |
|---|---|---|
| DURATION | 60s | 一局时长 |
| LIVES | 3 | 每玩家命数 |
| HOLE_COUNT | 5 | 每人半区 5 洞（随机空闲洞刷新；椭圆洞位于场地底部） |
| 命中方式 | 接触即打 | 手/光标碰到目标即触发（不需下压），左右手独立判定 |
| 普通地鼠 | 50 | 基础分 |
| 头盔地鼠 | 30 + 80 | 先击落头盔再击本体 |
| 炸弹 | 灭火 | 碰到不掉血，打它=浇水灭火；引信 2.2s 没灭掉就爆炸掉 1 命 |
| 怪物（UFO） | 掉 1 命 | 坏目标，碰到扣命、连击清零 |
| 额外生命 | +1 命 +30 | 小概率 |
| 连击加成 | 5%/次 | 封顶 20 连；每 5 连触发里程碑 +50 并大字提醒 |
| 飘字反馈 | +N / 灭火！/ 连击×N / 爆炸 | 命中、灭火、扣血均有大字飘字 |
| 倒计时 | 3.2s | 4→3→2→1 |

成绩存 `localStorage['arcade.score.whack-a-mole.p<玩家>']`
（best / last / plays / recent[]），结算面板显示最高/击中/连击最高/新纪录。

## 5. 目录速览

```
src/
├── main.ts / App.vue            # 装配：引擎单例、画布、竖屏提示、加载遮罩
├── styles/main.css              # 全局大字号主题（clamp 体系、深色、覆盖层）
├── core/
│   ├── types.ts                 # 公共类型（Hand/GestureEvent/Spec/Instance）
│   ├── GameEngine.ts            # 注册表/状态机/主循环/手势路由/结果落库
│   ├── GestureEngine.ts         # 体感源选择、playerCount 切换、事件广播
│   ├── AudioManager.ts / ScoreStore.ts
│   └── providers/
│       ├── MediaPipeProvider.ts # 摄像头（MediaPipe PoseLandmarker）
│       └── MockProvider.ts      # 鼠标/键盘 Mock
├── components/
│   ├── GameCenter.vue           # 大厅：人数/游戏卡片/输入源/手势光标
│   └── ResultOverlay.vue        # 结算：分数/纪录/再来一次/返回
└── games/whack-a-mole/
    ├── WhackAMoleGame.ts        # 游戏实现（双人同屏）
    └── assets/{img,audio}/      # 活力街原版素材（42 图 + 11 音效）
```

## 6. 运行

```bash
npm ci && npm run dev      # 开发（5174）
npm run build && npm run preview   # 生产（4173）
```

- 浏览器验证建议前台标签页打开（后台标签 rAF 会被浏览器冻结）。
- 真机体感：Chrome/Edge 摄像头授权后选择「自动/摄像头」；手机横屏或投屏。
