/**
 * 无依赖截图工具：用 CDP 驱动本机 Chromium（Edge/Chrome）抓真实渲染结果。
 *
 * 为什么不用现成方案：项目要能在任何一台只有 Edge 的 Windows 上验证，
 * 而 Puppeteer/Playwright 都要额外下载一个上百 MB 的浏览器。这里直接用
 * Node 22 内置的 WebSocket 说 CDP，零安装。
 *
 * 用法：
 *   node tools/shot.mjs --url=http://127.0.0.1:8123 --steps=shots/steps.json
 *
 * steps.json 是一个数组，按顺序执行（同一页面内连续操作，不用反复启动浏览器）：
 *   [{ "js": "…要执行的代码（可 await）…", "wait": 800, "out": "shots/01.png" }]
 *
 * 每次 evaluate 会等待 Promise；页面里的 JS 报错会被收集并在末尾打印，
 * 这比看截图猜"为什么不动"快得多。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];

function findBrowser() {
  for (const p of CANDIDATES) if (fs.existsSync(p)) return p;
  throw new Error('找不到 Chrome/Edge');
}

function parseArgs(argv) {
  const out = {};
  for (const a of argv) {
    if (!a.startsWith('--')) continue;
    const i = a.indexOf('=');
    if (i < 0) out[a.slice(2)] = true;
    else out[a.slice(2, i)] = a.slice(i + 1);
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const URL_ = args.url || 'http://127.0.0.1:8123';
const PORT = Number(args.port || 9333);
const W = Number(args.w || 960);
const H = Number(args.h || 720);
const DPR = Number(args.dpr || 2);
const steps = args.steps ? JSON.parse(fs.readFileSync(args.steps, 'utf8')) : [{ wait: 1500, out: args.out || 'shot.png' }];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shot-cdp-'));
const browser = spawn(
  findBrowser(),
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${userDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--hide-scrollbars',
    '--mute-audio',
    `--window-size=${W},${H}`,
    'about:blank',
  ],
  { stdio: 'ignore' }
);

/** 轮询等 CDP 端口就绪 */
async function waitPort(timeoutMs = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (r.ok) return r.json();
    } catch {}
    await sleep(150);
  }
  throw new Error('CDP 端口没起来');
}

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.logs = [];
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
        return;
      }
      if (msg.method === 'Runtime.consoleAPICalled') {
        const text = (msg.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ');
        this.logs.push(`[${msg.params.type}] ${text}`);
      } else if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params.exceptionDetails;
        this.logs.push(`[exception] ${d.text} ${d.exception?.description || ''}`);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
}

function open(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.addEventListener('open', () => resolve(ws));
    ws.addEventListener('error', (e) => reject(new Error('WS 连接失败')));
  });
}

let code = 0;
try {
  await waitPort();
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = list.find((t) => t.type === 'page');
  if (!page) throw new Error('没有可用页面');

  const cdp = new CDP(await open(page.webSocketDebuggerUrl));
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: W,
    height: H,
    deviceScaleFactor: DPR,
    mobile: false,
  });

  // --slow：限速到 6 Mbps / 150ms 延迟，用来复现"弱网首屏"。
  // 本机 localhost 下 3.6MB 素材是瞬间到位的，不加限速根本看不到加载层
  // （加这个参数就是为了验证"图片没下完就不许撤加载层"到底生不生效）
  if (args.slow) {
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 150,
      downloadThroughput: (6 * 1024 * 1024) / 8,
      uploadThroughput: (2 * 1024 * 1024) / 8,
    });
  }

  await cdp.send('Page.navigate', { url: URL_ });
  await sleep(1000); // 给模块加载和图片解码留时间

  for (const [i, step] of steps.entries()) {
    if (step.js) {
      const res = await cdp.send('Runtime.evaluate', {
        expression: step.js,
        awaitPromise: true,
        returnByValue: true,
      });
      if (res.exceptionDetails) {
        console.log(`步骤 ${i} 抛错: ${res.exceptionDetails.text} ${res.exceptionDetails.exception?.description || ''}`);
        code = 1;
      } else if (res.result && res.result.value !== undefined) {
        console.log(`步骤 ${i} 返回:`, JSON.stringify(res.result.value));
      }
    }
    await sleep(step.wait ?? 600);
    if (step.out) {
      // clip 给的是页面 CSS 坐标，用来放大看局部细节（比如"边缘那条缝"）
      const params = { format: 'png' };
      if (step.clip) params.clip = { ...step.clip, scale: step.clip.scale ?? DPR };
      const { data } = await cdp.send('Page.captureScreenshot', params);
      fs.mkdirSync(path.dirname(step.out), { recursive: true });
      fs.writeFileSync(step.out, Buffer.from(data, 'base64'));
      console.log(`截图 ${step.out}`);
    }
  }

  if (cdp.logs.length) {
    console.log('\n页面日志：');
    for (const l of cdp.logs) console.log('  ' + l);
  }
} catch (e) {
  console.error('失败:', e.message);
  code = 1;
} finally {
  browser.kill();
  await sleep(300);
  try {
    fs.rmSync(userDir, { recursive: true, force: true });
  } catch {}
  process.exit(code);
}
