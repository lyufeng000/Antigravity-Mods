// 周额度多账号插槽（quota-slot.js + quota-main-ipc.js）单测：
// 0 主动请求、双账号常驻展示、登出保留上次额度并正常算倒计时、accounts.json 持久化与清理他人账号痕迹
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { loadDep } from '../patcher/lib/deps.mjs';

const { JSDOM } = loadDep('jsdom');
const here = path.dirname(fileURLToPath(import.meta.url));
const SLOT_CODE = fs.readFileSync(path.resolve(here, '../src/quota-slot.js'), 'utf8');
const MAIN_IPC_TEMPLATE = fs.readFileSync(path.resolve(here, '../src/quota-main-ipc.js'), 'utf8');
const nodeRequire = createRequire(import.meta.url);

const SIDEBAR_HTML = `<!doctype html>
<html><body>
  <div role="navigation" aria-label="Sidebar">
    <div id="workspaces-list">Workspaces</div>
    <div id="footer-block" class="flex flex-col gap-px pt-2 px-2">
      <button data-testid="settings-button">设置</button>
    </div>
  </div>
</body></html>`;

const flush = () => new Promise((r) => setTimeout(r, 25));

function createEnv(t, { html = SIDEBAR_HTML, url = 'http://127.0.0.1:51234/', electronMock = null, preEval = null } = {}) {
  const dom = new JSDOM(html, { url, runScripts: 'outside-only', pretendToBeVisual: true });
  t.after(() => dom.window.close());
  const win = dom.window;
  if (electronMock) {
    win.require = (mod) => (mod === 'electron' ? electronMock : {});
  }
  if (preEval) preEval(win);
  win.eval(SLOT_CODE);
  return { dom, win, doc: win.document };
}

function makeRawLsClient(counters, overrides = {}) {
  return {
    getUserStatus: async () => {
      counters.getUserStatus += 1;
      return overrides.getUserStatus ? overrides.getUserStatus() : { userStatus: { email: 'dev@example.com' } };
    },
    retrieveUserQuotaSummary: async (req) => {
      counters.retrieveUserQuotaSummary += 1;
      return overrides.retrieveUserQuotaSummary ? overrides.retrieveUserQuotaSummary(req) : { response: { groups: [] } };
    },
    signOut: async () => {
      counters.signOut += 1;
      return {};
    },
  };
}

test('初始无记录与未登录态：0 主动 RPC 请求，兼容前置装饰器链，空账号列表隐藏插槽', async (t) => {
  const counters = { getUserStatus: 0, retrieveUserQuotaSummary: 0, signOut: 0, prevDecorated: 0 };
  const { win, doc } = createEnv(t, {
    preEval: (w) => {
      w.__JETSKI_LS_CLIENT_DECORATOR__ = (client) => {
        counters.prevDecorated += 1;
        client.__fromPrev = true;
        return client;
      };
    },
  });

  const lsClient = win.__JETSKI_LS_CLIENT_DECORATOR__(makeRawLsClient(counters, {
    getUserStatus: () => ({ userStatus: { email: '' } }),
  }));
  await flush();

  assert.equal(counters.prevDecorated, 1);
  assert.equal(lsClient.__fromPrev, true);
  assert.equal(counters.getUserStatus, 0, '严禁主动调用 getUserStatus');
  assert.equal(counters.retrieveUserQuotaSummary, 0, '严禁主动调用 retrieveUserQuotaSummary');
  assert.equal(doc.getElementById('agy-weekly-quota-slot'), null);

  await lsClient.getUserStatus({});
  await flush();
  assert.equal(counters.retrieveUserQuotaSummary, 0);
  assert.equal(doc.getElementById('agy-weekly-quota-slot'), null);
});

test('双账号常驻展示：切换或登出账号时保留所有账号卡片，登出账号冻结上次额度并继续算倒计时', async (t) => {
  const counters = { getUserStatus: 0, retrieveUserQuotaSummary: 0, signOut: 0 };
  const { win, doc } = createEnv(t);

  let activeEmail = 'acc1@gmail.com';
  let activeFrac = 0.97;
  let activeResetSec = BigInt(Math.floor((Date.now() + (6 * 86400 + 22 * 3600 + 1800) * 1000) / 1000));

  const lsClient = win.__JETSKI_LS_CLIENT_DECORATOR__(makeRawLsClient(counters, {
    getUserStatus: () => ({ userStatus: { email: activeEmail } }),
    retrieveUserQuotaSummary: () => ({
      response: {
        groups: [
          {
            displayName: 'Claude and GPT models',
            buckets: [{ window: 'weekly', remaining: { case: 'remainingFraction', value: 0.11 }, resetTime: { seconds: activeResetSec, nanos: 0 } }],
          },
          {
            displayName: 'Gemini Models',
            buckets: [
              { window: '5h', remaining: { case: 'remainingFraction', value: 0.05 }, resetTime: { seconds: activeResetSec, nanos: 0 } },
              { window: 'weekly', remaining: { case: 'remainingFraction', value: activeFrac }, resetTime: { seconds: activeResetSec, nanos: 0 } },
            ],
          },
        ],
      },
    }),
  }));

  // 1. 登录账号 1 并同步额度
  await lsClient.getUserStatus({});
  await lsClient.retrieveUserQuotaSummary({});
  await flush();

  // 2. 切到账号 2 并同步额度
  activeEmail = 'acc2@gmail.com';
  activeFrac = 0.20;
  activeResetSec = BigInt(Math.floor((Date.now() + (5 * 86400 + 14 * 3600 + 1800) * 1000) / 1000));
  await lsClient.getUserStatus({});
  await lsClient.retrieveUserQuotaSummary({});
  await flush();

  const slot = doc.getElementById('agy-weekly-quota-slot');
  assert.ok(slot);
  const cards = slot.querySelectorAll('[data-account-email]');
  assert.equal(cards.length, 2, '两个账号应同时常驻显示在左下角');

  const card1 = slot.querySelector('[data-account-email="acc1@gmail.com"]');
  const card2 = slot.querySelector('[data-account-email="acc2@gmail.com"]');
  assert.equal(card1.querySelector('[data-role="email"]').style.fontSize, '15px', '账号字号应放大为 15px');
  assert.equal(card1.querySelector('[data-role="pct"]').textContent, '剩余 97%', '已登出的账号 1 保留上次查询额度');
  assert.equal(card1.querySelector('[data-role="reset"]').textContent, 'Resets in 6d 22h', '已登出的账号 1 正常计算倒计时');
  assert.equal(card1.style.opacity, '0.78', '已登出账号弱化透明度区分在线态');

  assert.equal(card2.querySelector('[data-role="pct"]').textContent, '剩余 20%');
  assert.equal(card2.querySelector('[data-role="reset"]').textContent, 'Resets in 5d 14h');
  assert.match(card2.querySelector('[data-role="ring-fg"]').getAttribute('class'), /stroke-yellow-500/);
  assert.equal(card2.style.opacity, '1', '当前登录账号保持全亮');

  // 3. 全部登出后两个账号依然常驻保留上次额度与倒计时
  await lsClient.signOut();
  await flush();
  assert.notEqual(slot.style.display, 'none', '登出后已记录账号不隐藏');
  assert.equal(slot.querySelectorAll('[data-account-email]').length, 2);
  assert.equal(card1.querySelector('[data-role="pct"]').textContent, '剩余 97%');
  assert.equal(card2.querySelector('[data-role="pct"]').textContent, '剩余 20%');
});

test('主进程 accounts.json 配置文件：自动迁移清理旧缓存痕迹，手动删改配置文件实时移除他人账号', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-quota-cfg-'));
  const cfgPath = path.join(tmpDir, 'accounts.json');
  t.after(() => {
    fs.unwatchFile(cfgPath);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // 搭建真实执行 quota-main-ipc.js 的主进程 + 渲染进程 IPC 闭环
  const syncHandlers = new Map();
  const asyncHandlers = new Map();
  const rendererListeners = new Map();
  const appStorageDisk = {
    agy_weekly_quota_cache_v1: JSON.stringify({
      'mine@gmail.com': { remainingFraction: 0.88, resetTimeMs: Date.now() + 86400_000 * 4, disabled: false, ts: Date.now() },
    }),
  };

  const electronMainMock = {
    ipcMain: {
      removeAllListeners: (ch) => syncHandlers.delete(ch),
      on: (ch, fn) => syncHandlers.set(ch, fn),
      removeHandler: (ch) => asyncHandlers.delete(ch),
      handle: (ch, fn) => asyncHandlers.set(ch, fn),
    },
    BrowserWindow: {
      getAllWindows: () => [{
        webContents: {
          isDestroyed: () => false,
          send: (ch, payload) => {
            for (const fn of rendererListeners.get(ch) || []) fn({}, payload);
          },
        },
      }],
    },
  };

  const mainCode = MAIN_IPC_TEMPLATE.replace(/__AGY_QUOTA_CONFIG_FILE__/g, JSON.stringify(cfgPath));
  vm.runInNewContext(mainCode, {
    globalThis: {},
    process,
    require: (id) => (id === 'electron' ? electronMainMock : nodeRequire(id)),
  });

  const makeRendererElectron = (targetWin) => ({
    ipcRenderer: {
      sendSync: (ch) => {
        if (ch === 'storage:get-items-sync') return { ...appStorageDisk };
        const fn = syncHandlers.get(ch);
        if (!fn) return null;
        const ev = { returnValue: null };
        fn(ev);
        return ev.returnValue;
      },
      invoke: async (ch, payload) => {
        if (ch === 'storage:update-items') {
          for (const [k, v] of Object.entries(payload)) {
            if (v === null) delete appStorageDisk[k];
            else appStorageDisk[k] = v;
          }
          return;
        }
        const fn = asyncHandlers.get(ch);
        return fn ? fn({}, payload) : null;
      },
      on: (ch, fn) => {
        if (!rendererListeners.has(ch)) rendererListeners.set(ch, []);
        rendererListeners.get(ch).push(fn);
      },
    },
    webFrame: {
      executeJavaScript: (code) => targetWin.eval(code),
    },
  });

  const dom = new JSDOM(SIDEBAR_HTML, { url: 'http://127.0.0.1:59001/', runScripts: 'outside-only', pretendToBeVisual: true });
  t.after(() => dom.window.close());
  dom.window.require = (m) => (m === 'electron' ? makeRendererElectron(dom.window) : {});
  dom.window.eval(SLOT_CODE);
  await flush();

  // 1. 旧版 app_storage.json 中的痕迹已被自动迁移至 accounts.json 并从 app_storage.json 中彻底删除
  assert.equal('agy_weekly_quota_cache_v1' in appStorageDisk, false, '应彻底清除 app_storage.json 中的旧缓存痕迹');
  assert.ok(fs.existsSync(cfgPath), '应生成独立的 accounts.json 配置文件');

  // 2. 模拟临时登录了他人的账号 stranger@gmail.com，随后登出切回自己的账号
  let cur = 'stranger@gmail.com';
  const counters = { getUserStatus: 0, retrieveUserQuotaSummary: 0, signOut: 0 };
  const ls = dom.window.__JETSKI_LS_CLIENT_DECORATOR__(makeRawLsClient(counters, {
    getUserStatus: () => ({ userStatus: { email: cur } }),
    retrieveUserQuotaSummary: () => ({
      response: {
        groups: [{ displayName: 'Gemini Models', buckets: [{ window: 'weekly', remainingFraction: 0.5, resetTime: { seconds: Math.floor((Date.now() + 86400_000) / 1000), nanos: 0 } }] }],
      },
    }),
  }));
  await ls.getUserStatus({});
  await ls.retrieveUserQuotaSummary({});
  await flush();

  cur = 'mine@gmail.com';
  await ls.getUserStatus({});
  await flush();

  const doc = dom.window.document;
  assert.equal(doc.querySelectorAll('[data-account-email]').length, 2);

  // 3. 用户直接编辑 accounts.json 删除 stranger@gmail.com，通知刷新后卡片立即消失
  const edited = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  assert.ok(edited.accounts['stranger@gmail.com']);
  delete edited.accounts['stranger@gmail.com'];
  fs.writeFileSync(cfgPath, JSON.stringify(edited, null, 2));
  // 模拟 watchFile 广播刷新
  for (const fn of rendererListeners.get('agy-quota:config-changed') || []) fn({}, edited);
  await flush();

  assert.equal(doc.querySelector('[data-account-email="stranger@gmail.com"]'), null, '从配置文件移除后界面痕迹应立即消失');
  assert.ok(doc.querySelector('[data-account-email="mine@gmail.com"]'), '自己的账号继续保留');
});
