# THUAI-9 Web Frontend

这是“璃月黄金交易所”的无依赖 Web SPA 骨架，用于 observer 观战页和 player 调试控制台。

## 运行

```bash
cd web
python3 -m http.server 5173 -d .
```

打开：

- `http://localhost:5173/?mode=observer`
- `http://localhost:5173/?mode=player&token=player1`

默认 WebSocket 服务端为 `ws://localhost:14514`。页面会优先发送 `HELLO`，服务端尚未支持握手时仍可进入 legacy 联调状态。

## 目录

- `index.html`：SPA 入口。
- `styles.css`：响应式仪表盘样式。
- `src/main.js`：启动、连接管理、表单事件。
- `src/store.js`：消息归约与集中状态。
- `src/candles.js`：K 线聚合。
- `src/render.js`：DOM 与 canvas 渲染。
- `src/actions.js`：Client -> Server 动作消息。
- `src/sample-data.js`：离线演示数据。
- `tests/candles.test.mjs`：K 线聚合单元测试。

## 验证

```bash
cd web
npm test
```
