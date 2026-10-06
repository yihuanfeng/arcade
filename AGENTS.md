# AGENTS.md — Arcade 体感游戏平台开发指南

面向后续在本仓库开发体感游戏的 Agent 与开发者。**先读本文件，再动手。**

## 一、项目是什么

「活力街」风格的 Web 体感游戏平台：浏览器打开，摄像头识别身体/手部，用手势操作 UI 和玩游戏；支持 Mock 输入在电脑上开发测试。当前主打游戏：**打地鼠**（已上线）。目标是未来一页展示 9 个游戏（大厅 3×3 网格）。

运行形态：手机横屏或投屏电视（竖屏会显示旋转提示遮罩）。页面禁止滚动、UI 大字号。

## 二、技术栈与常用命令

- Vue 3.5 + Vite 6 + TypeScript **严格模式**（vue-tsc；**未使用变量 TS6133 会直接阻断构建**，写完代码必须清理无用 import/变量）
- 构建：`export PATH="/Users/cindy/.nvm/versions/node/v22.23.2/bin:$PATH" && cd /Users/cindy/work/Arcade && npm run build`
- 本地预览：`npm run dev`（:5174）；发布预览常驻 `http://127.0.0.1:8932`（vite preview，服务 dist）
- 打开页面带 `?src=mock` 强制 Mock 输入（不开摄像头）；`?src=camera` 摄像头
- 仓库已有 git 提交（身份 Arcade Dev <dev@arcade.local>，仅本仓库配置）

## 三、目录结构

```
src/
├── main.ts / App.vue          # 装配：引擎单例、游戏注册、视图切换、光标层
├── styles/main.css            # 全局：CSS 变量（--fs-hero/title/body/sub/note）、覆盖层
├── core/                      # 引擎层（与具体游戏无关，新游戏不许改坏这里）
│   ├── GameEngine.ts          # 游戏生命周期、canvas、事件、结算
│   ├── GestureEngine.ts       # 全局手势：Provider 切换、转发层平滑、onEvent/onPose
│   ├── gestureUi.ts           # UI 统一交互 hold-to-confirm（进度环光标）
│   ├── AudioManager.ts        # 音频注册与播放
│   ├── ScoreStore.ts          # 每游戏每玩家历史最佳（localStorage）
│   ├── poseRender.ts          # 骨架绘制（PoseOverlay / 测试页共用）
│   ├── types.ts               # GameSpec / GameInstance / GameContext / GestureEvent / MatchConfig…
│   └── providers/
│       ├── MockProvider.ts    # 电脑模拟：鼠标/键盘 → 双手 → 全区坐标
│       └── MediaPipeProvider.ts # 摄像头：MediaPipe 手部 + 骨架
├── components/                # 通用 UI（所有游戏共用，新游戏复用，不要各自重写）
│   ├── GameCenter.vue         # 大厅：大标题 + 人数筛选（右上）+ 3 列游戏网格 + 底部设置
│   ├── ReadyOverlay.vue       # 站位确认：手可见保持 3s 自动开始
│   ├── ResultOverlay.vue      # 结算：hold 交互返回/再来一次
│   ├── PoseOverlay.vue        # 右下角霓虹骨架小窗（全局常驻，P1 蓝 P2 红 P3 紫 P4 绿）
│   └── GestureTestPage.vue    # 体感测试页（骨架预览 + 坐标 + tap 计数）
└── games/                     # 每个游戏一个独立目录（资源按游戏存放）
    └── whack-a-mole/
        ├── WhackAMoleGame.ts  # GameSpec + GameInstance 实现
        └── assets/{img,audio} # 该游戏素材（APK 原版提取）
```

## 四、核心架构（新游戏必须遵守的规则）

### 1. 坐标体系：全区归一化直通（最高优先级）
- Provider 输出的手坐标是**视口归一化坐标**（x,y ∈ 0~1，**全区**，不是半区）
- 手在屏幕中间 → x=0.5；游戏内光标/手环直接用 `x = h.x * innerWidth` 换算
- **禁止**再按"玩家区"做半区缩放（历史教训：单人+双人都被半区化过，手到中间就跳右半边）
- 玩家归属（双人）由 Provider 按左右判断（可见腕平均屏幕 x < 0.5 → P0），游戏里不重算
- Mock 键位：鼠标/左键=P1 右手、WASD=P1 左手、方向键=P2 右手、IJKL=P2 左手、空格=P1 tap、Enter=P2 tap（单人时 Enter 归 P1）

### 2. 全局手势与平滑
- `GestureEngine` 是全局单例，**转发层已做指数平滑**（SMOOTH=0.45：手坐标 + 骨架 33 点），新游戏**不要自己再做平滑**
- `gesture.onEvent(cb)` 订阅手势事件（point/tap，含 player/side）；`gesture.onPose(cb)` 订阅骨架帧
- `gesture.start(playerCount, source)` 切换输入源（auto/camera/mock）；切换时平滑缓存自动清空

### 3. UI 统一交互：hold-to-confirm（操作界面全局定义）
- **按钮/卡片等操作界面元素**：光标（圆形）划到不算点击，光标变成**圆形进度条**，加载满（约 0.8s）才触发；移开清零；触发后有 450ms 冷却
- 统一用 `core/gestureUi.ts` 的 `createGestureUiNav({ gesture, targets, keyOf, onActivate, onStateChange })`，**不要手写光标跟随逻辑**
- **游戏内交互是游戏自定义**（打地鼠"碰到即打"由游戏自己的 contactCheck 实现，不走 hold）——引擎提供可靠基础能力（坐标/命中/事件），游戏自己定玩法交互

### 4. 游戏实例接口（types.ts）
```ts
GameSpec { id, name, icon, desc, maxPlayers: 1|2, create(ctx: GameContext): GameInstance }
GameInstance {
  onEnter()          // 进入时初始化、开始回合
  onExit()           // 离开时清理（取消动画/事件/音频）
  update(dt)         // 逻辑帧
  render(ctx, w, h)  // canvas 绘制（引擎已按 16:9 虚拟视口缩放）
  onGesture(e)       // 手势事件分发（tap/point）
  readonly done?: boolean  // true 表示对局结束，引擎收尾出结算
}
```
- 结束对局：游戏内调用 `ctx.engine.endGame(result)`，引擎自动切到结算（ResultOverlay 复用）
- 历史最佳：`ctx.scores.load(gameId, player)` / 结算组件自动展示

### 5. 新游戏注册（三步）
1. 建目录 `src/games/<game-id>/`，放 `assets/{img,audio}`（**素材用 APK 原版**；原版有问题的如黑心 extra-life.png，用代码绘制替代）
2. 实现 `GameSpec` + `GameInstance`（照 whack-a-mole 结构）
3. `App.vue` 顶部：`import { xxSpec, XX_AUDIO_ASSETS }` → `engine.register(xxSpec)` → `audio.register(XX_AUDIO_ASSETS)`
4. 大厅自动出现该游戏卡片（3 列网格，9 个游戏自动排 3×3，无需改布局）

## 五、已验证的经验与坑（打地鼠沉淀，别再踩）

1. **坐标 2 倍偏移**：光标/手环层必须 `width:100vw; height:100vh`（`#hand-cursor-layer`），否则坐标翻倍、手到中间光标到最右
2. **后台标签页 rAF 冻结**：浏览器后台 tab 的 requestAnimationFrame 会停 → Mock 姿态停发 → 站位 3s 永远过不去。验证时必须先把目标 tab 切前台（new_tab + switch_tab），不能只 navigate
3. **preview 缓存旧 JS**：dist 更新后浏览器可能仍加载旧 hash 的 JS（如 index-BRH7Y4Wc），页面表现与代码不符时，带 `?src=mock&v=<新参数>` 强制刷新，并核对 `<script src>` 是否为最新 dist 产物
4. **合成事件不可靠**：`dispatchEvent(new MouseEvent('mousemove'))` 可能不触发 Mock 输入（实际输入源是真鼠标）；验证交互用真实输入（bu.click_xy 等）
5. **素材黑心**：原版 extra-life.png 是黑心白底，HUD/加命道具都用代码画红心（#ff2d55 贝塞尔 + 高光）
6. **弹窗/覆盖层层级**：设置面板等浮层会挡底层点击 → 命中检测要层级优先（gestureUi 的 targets 先收集浮层 `[data-act]` 再底层 `[data-gid]`）；手势光标 z-index 90
7. **页面禁滚动**：html/body/覆盖层 overflow:hidden；测试页/站位页内容要压缩，右侧信息过多会把返回按钮挤出去（布局改动后必须检查无滚动条、按钮在视口内）
8. **大字 + 深色**：UI 用 CSS 变量字号（--fs-hero/title/body/sub/note），电视投屏也清晰；不要小字号
9. **炸弹逻辑**：炸弹按自身引信计时必爆炸（2.2s），不随目标寿命消失；碰到=灭火，没灭就爆掉全场 1 滴血
10. **刷怪节奏**：双人刷怪间隔 = SPAWN_START/人数，人多要加速，否则不够打
11. **连击奖励**：连击里程碑给 +N 醒目提示（打地鼠 COMBO_MILESTONE=5 每 +50），数值要收敛（普通分值别设太高，用户反馈过"得分太高调低点"）
12. **站位确认**：每局开始前站位 3 秒（ReadyOverlay），识别到身体保持 3s 才开；右下角 PoseOverlay 全局显示（Mock/摄像头一致，无边框半透明，靠 P1-P4 霓虹色分辨人）
13. **构建严格**：vue-tsc 严格模式下未使用变量即失败；模板 ref 未声明也可能报错，改完先 build

## 六、验证方法（交付前必做）

- `npm run build` 通过（无 TS 错误）
- 浏览器打开 `http://127.0.0.1:8932/?src=mock&v=<时间戳>` 验证：布局无滚动、按钮在视口内、光标进度环出现、hold 能触发、站位能过、对局能跑、结算能返回
- 关键 DOM 断言（bu.js）：`#gesture-cursor .ring-fill` 的 stroke-dasharray（周长 276.5，progress*276.5）、`#game-canvas` 可见性、`#ready` 站位遮罩、页面 scrollHeight 与 clientHeight
- 手感类交互（打中判定、挥动灵敏度、进度时长）**由用户本人实测**，助手做代码与静态验证即可，不擅自替用户定手感

## 七、用户偏好硬约束（历史指令沉淀，违反会被批评）

- **禁用「最终」「完美」「无错」等夸张词**；说话客观、有依据
- 用户指令要**严格全量执行**，不擅自缩小范围、不擅自改变指令、**不"乱搞东西"**（不做用户没要求的改动）
- 素材**必须用原版**（APK 解包），代码绘制只做替代（如黑心红心）
- 大字号、深色，适配手机横屏/投屏；页面禁滚动
- 开发内容风格舒缓，颜色不过分夸张（水墨/真实风格优先）
- 回答问题要客观有据，不靠网络谣言或主观推测
- 交互/手感类测试由用户亲自做，助手说明改动即可

## 八、多人游戏要点（平台已支持）

- `playerCount: 1 | 2`（GameCenter 右上筛选）；每玩家**双手**都可用
- 打地鼠采用**全区共享场地**（targets 为共享数组，任何手可打任何洞）；炸弹爆炸全场 -1♥
- 新游戏做双人时：优先考虑全区共享交互；如果按人分区，坐标必须仍用全区直通，只在逻辑上划归属
