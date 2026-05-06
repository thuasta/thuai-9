import express from "express";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 5173;

app.use(express.static(__dirname));

app.listen(PORT, () => {
  console.log(`华清街大亨 · 前端服务已启动 → http://localhost:${PORT}`);
});
