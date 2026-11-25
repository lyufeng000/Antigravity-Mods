import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const MAIN_SCRIPT = path.resolve(here, '../src/win-notify-main.js');

function loadWinNotifyModule() {
  let exported = null;
  const code = fs.readFileSync(MAIN_SCRIPT, 'utf8');
  const sandbox = {
    console,
    process,
    Buffer,
    setTimeout,
    clearTimeout,
    WeakMap,
    Set,
    Map,
    Object,
    Array,
    String,
    Boolean,
    Number,
    Math,
    Error,
  };
  sandbox.globalThis = sandbox;
  sandbox.__AGY_WIN_NOTIFY_TEST_HOOK__ = (api) => {
    exported = api;
  };
  vm.runInNewContext(code, sandbox, { filename: MAIN_SCRIPT });
  assert.ok(exported, '测试钩子应成功捕获 win-notify-main API');
  return exported;
}

function createFakeClock() {
  let now = 0;
  let seq = 0;
  const tasks = new Map();
  return {
    get now() { return now; },
    get size() { return tasks.size; },
    setTimeout(fn, ms = 0) {
      const id = ++seq;
      const item = { id, fn, due: now + ms, unreffed: false };
      tasks.set(id, item);
      return {
        id,
        unref() { item.unreffed = true; return this; },
      };
    },
    clearTimeout(handle) {
      if (handle && typeof handle === 'object' && 'id' in handle) {
        tasks.delete(handle.id);
      }
    },
    tick(ms) {
      const target = now + ms;
      while (true) {
        let next = null;
        for (const item of tasks.values()) {
          if (item.due <= target && (!next || item.due < next.due || (item.due === next.due && item.id < next.id))) {
            next = item;
          }
        }
        if (!next) break;
        tasks.delete(next.id);
        now = next.due;
        next.fn();
      }
      now = target;
    },
  };
}

function createMockContents(id, { destroyed = false } = {}) {
  const sent = [];
  const calls = [];
  return {
    id,
    sent,
    calls,
    _destroyed: destroyed,
    isDestroyed() { return this._destroyed; },
    focus() { calls.push('contents.focus'); },
    send(channel, payload) { sent.push({ channel, payload }); },
  };
}

function createMockWindow(name, {
  minimized = false,
  alwaysOnTop = false,
  destroyed = false,
  withDirectWebContents = true,
  hubContents = null,
} = {}) {
  const calls = [];
  let stateAlwaysOnTop = alwaysOnTop;
  let stateMinimized = minimized;
  let stateDestroyed = destroyed;
  const win = {
    name,
    calls,
    isDestroyed() { return stateDestroyed; },
    setDestroyed(v) { stateDestroyed = v; },
    isMinimized() { return stateMinimized; },
    isAlwaysOnTop() { return stateAlwaysOnTop; },
    flashFrame(flag) { calls.push(['flashFrame', flag]); },
    restore() { stateMinimized = false; calls.push(['restore']); },
    show() { calls.push(['show']); },
    setAlwaysOnTop(flag, level) {
      stateAlwaysOnTop = Boolean(flag);
      calls.push(level !== undefined ? ['setAlwaysOnTop', flag, level] : ['setAlwaysOnTop', flag]);
    },
    moveTop() { calls.push(['moveTop']); },
    focus() { calls.push(['focus']); },
  };
  if (withDirectWebContents && hubContents) {
    win.webContents = hubContents;
  }
  return win;
}

function createMockEnv({
  platform = 'win32',
  appName = 'Antigravity',
  env = {},
  localWins = [],
  lastFocusedWin = undefined,
  remoteBySender = new Map(),
  windowBySender = new Map(),
  hubContentsByWin = new Map(),
} = {}) {
  const clock = createFakeClock();
  const appEvents = new EventEmitter();
  const aumidCalls = [];
  const appFocusCalls = [];
  const ipcHandlers = new Map();
  const createdNotifications = [];

  class MockNotification extends EventEmitter {
    constructor(opts) {
      super();
      this.options = opts;
      this.shown = false;
      createdNotifications.push(this);
    }
    show() {
      this.shown = true;
    }
  }

  const electron = {
    app: {
      getName: () => appName,
      setAppUserModelId: (id) => { aumidCalls.push(id); },
      focus: (opts) => { appFocusCalls.push(opts); },
      on: (ev, fn) => appEvents.on(ev, fn),
    },
    ipcMain: {
      handle: (ch, fn) => { ipcHandlers.set(ch, fn); },
    },
    Notification: MockNotification,
    BaseWindow: {
      getAllWindows: () => localWins,
    },
    BrowserWindow: {
      getAllWindows: () => [],
      fromWebContents: (sender) => windowBySender.get(sender),
    },
  };

  const utils = {
    getLocalHubWindows: () => localWins,
    getLastFocusedLocalHubWindow: () => lastFocusedWin,
    getHubWebContents: (win) => hubContentsByWin.get(win),
    resolveHubWindowFromWebContents: (sender) => windowBySender.get(sender),
  };

  const remoteWindowSecurity = {
    isRemoteContents: (sender) => remoteBySender.has(sender),
  };

  const windowBackends = {
    remoteBackendOf: (sender) => remoteBySender.get(sender),
  };

  const api = loadWinNotifyModule();
  const runtime = api.installWinNotifyFix({
    electron,
    utils,
    remoteWindowSecurity,
    windowBackends,
    platform,
    env,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
  });

  // 模拟后续 dist/ipcHandlers.js 注册原版 handler
  electron.ipcMain.handle('notification:send', () => {
    throw new Error('原版 handler 不应被注册');
  });

  return {
    api,
    runtime,
    clock,
    appEvents,
    aumidCalls,
    appFocusCalls,
    ipcHandlers,
    createdNotifications,
    electron,
  };
}

test('1. Windows 启动同步绑定 electron.app.Antigravity AUMID，非 Windows 不绑定', () => {
  const winEnv = createMockEnv({ platform: 'win32', appName: 'Antigravity' });
  assert.deepEqual(winEnv.aumidCalls, ['electron.app.Antigravity']);
  assert.equal(winEnv.runtime.aumid, 'electron.app.Antigravity');

  assert.equal(winEnv.api.resolveAumid({ getName: () => 'antigravity' }), 'electron.app.Antigravity');
  assert.equal(winEnv.api.resolveAumid({ getName: () => 'Antigravity Insiders' }), 'electron.app.Antigravity Insiders');

  const macEnv = createMockEnv({ platform: 'darwin', appName: 'Antigravity' });
  assert.deepEqual(macEnv.aumidCalls, []);
  assert.equal(macEnv.runtime.aumid, null);
});

test('2. Notification 实例被全局 Set 保活，在 click / close / failed / 超时后幂等释放', () => {
  const c1 = createMockContents(1);
  const w1 = createMockWindow('w1', { hubContents: c1 });
  const env = createMockEnv({
    localWins: [w1],
    windowBySender: new Map([[c1, w1]]),
    hubContentsByWin: new Map([[w1, c1]]),
  });

  const handler = env.ipcHandlers.get('notification:send');
  assert.equal(typeof handler, 'function');

  handler({ sender: c1 }, { title: '完成', body: 'ok' });
  handler({ sender: c1 }, { title: '关闭', body: 'ok' });
  handler({ sender: c1 }, { title: '失败', body: 'ok' });
  handler({ sender: c1 }, { title: '超时', body: 'ok' });

  assert.equal(env.createdNotifications.length, 4);
  assert.equal(env.runtime.activeNotifications.size, 4);
  assert.ok(env.createdNotifications.every((n) => n.shown));

  // click 释放（且重复触发 click 不报错）
  env.createdNotifications[0].emit('click');
  env.createdNotifications[0].emit('click');
  assert.equal(env.runtime.activeNotifications.size, 3);

  // close 释放
  env.createdNotifications[1].emit('close');
  assert.equal(env.runtime.activeNotifications.size, 2);

  // failed 释放
  env.createdNotifications[2].emit('failed', {}, 'err');
  assert.equal(env.runtime.activeNotifications.size, 1);

  // 30 分钟超时兜底释放
  env.clock.tick(30 * 60 * 1000);
  assert.equal(env.runtime.activeNotifications.size, 0);
});

test('3. BaseWindow 无 win.webContents 时通过 getHubWebContents 派发 notification:clicked 不抛异常', () => {
  const c1 = createMockContents(10);
  // withDirectWebContents: false 模拟原生 BaseWindow（win.webContents === undefined）
  const baseWin = createMockWindow('baseWin', {
    withDirectWebContents: false,
    hubContents: c1,
  });
  assert.equal(baseWin.webContents, undefined);

  const env = createMockEnv({
    localWins: [baseWin],
    windowBySender: new Map([[c1, baseWin]]),
    hubContentsByWin: new Map([[baseWin, c1]]),
  });

  const handler = env.ipcHandlers.get('notification:send');
  handler({ sender: c1 }, {
    title: '回合完成',
    body: '点击跳转',
    payload: { cascadeId: 'conv-123' },
  });

  assert.doesNotThrow(() => env.createdNotifications[0].emit('click'));
  assert.deepEqual(c1.sent, [
    { channel: 'notification:clicked', payload: { cascadeId: 'conv-123' } },
  ]);
  assert.ok(c1.calls.includes('contents.focus'));
});

test('4. 多窗口优先聚焦发送通知的窗口；发送窗口销毁时回退最近聚焦本地窗口', () => {
  const c1 = createMockContents(1);
  const c2 = createMockContents(2);
  const w1 = createMockWindow('w1', { hubContents: c1 });
  const w2 = createMockWindow('w2', { hubContents: c2 });

  const env = createMockEnv({
    localWins: [w1, w2],
    lastFocusedWin: w1,
    windowBySender: new Map([[c1, w1], [c2, w2]]),
    hubContentsByWin: new Map([[w1, c1], [w2, c2]]),
  });

  const handler = env.ipcHandlers.get('notification:send');

  // 由第 2 个窗口发出，应优先聚焦 w2 而非 w1
  handler({ sender: c2 }, { title: '来自窗口2', payload: { cascadeId: 'c-2' } });
  env.createdNotifications[0].emit('click');
  assert.ok(w2.calls.some((c) => c[0] === 'focus'));
  assert.equal(w1.calls.length, 0);
  assert.deepEqual(c2.sent, [{ channel: 'notification:clicked', payload: { cascadeId: 'c-2' } }]);

  // 窗口2关闭后，另一条未绑定存活窗口的通知应回退 lastFocusedWin（w1）
  w2.setDestroyed(true);
  c2._destroyed = true;
  handler({ sender: c2 }, { title: '窗口2已销毁', payload: { cascadeId: 'c-fallback' } });
  env.createdNotifications[1].emit('click');
  assert.ok(w1.calls.some((c) => c[0] === 'focus'));
  assert.deepEqual(c1.sent, [{ channel: 'notification:clicked', payload: { cascadeId: 'c-fallback' } }]);
});

test('5. SSH 远程窗口保留标签前缀与截断，远程窗口销毁后绝不唤醒本地窗口或泄漏 payload', () => {
  const localC = createMockContents(1);
  const localWin = createMockWindow('local', { hubContents: localC });
  const remoteC = createMockContents(99);
  const remoteWin = createMockWindow('ssh-dev', { hubContents: remoteC });

  const env = createMockEnv({
    localWins: [localWin],
    lastFocusedWin: localWin,
    remoteBySender: new Map([[remoteC, { label: 'ProdBox' }]]),
    windowBySender: new Map([[localC, localWin], [remoteC, remoteWin]]),
    hubContentsByWin: new Map([[localWin, localC], [remoteWin, remoteC]]),
  });

  const handler = env.ipcHandlers.get('notification:send');
  const longTitle = 'A'.repeat(250);
  const longBody = 'B'.repeat(1200);
  handler({ sender: remoteC }, { title: longTitle, body: longBody, payload: { secret: 'ssh-only' } });

  const n1 = env.createdNotifications[0];
  assert.ok(n1.options.title.startsWith('ProdBox: '));
  assert.equal(n1.options.title.length, 200);
  assert.ok(n1.options.title.endsWith('\u2026'));
  assert.equal(n1.options.body.length, 1000);
  assert.ok(n1.options.body.endsWith('\u2026'));

  // 远程窗口仍存活时：唤醒远程窗口
  n1.emit('click');
  assert.ok(remoteWin.calls.some((c) => c[0] === 'focus'));
  assert.equal(localWin.calls.length, 0);
  assert.deepEqual(remoteC.sent, [{ channel: 'notification:clicked', payload: { secret: 'ssh-only' } }]);

  // 远程窗口已销毁时：绝不回退到本地窗口
  handler({ sender: remoteC }, { title: '已关闭远程', body: 'hi', payload: { secret: 'never-leak' } });
  remoteWin.setDestroyed(true);
  remoteC._destroyed = true;
  env.createdNotifications[1].emit('click');
  assert.equal(localWin.calls.length, 0);
  assert.equal(localC.sent.length, 0);
});

test('6. Windows 强力前置序列、连续点击防永久置顶、原置顶窗口不被取消置顶', () => {
  // 6a: 最小化 + 非置顶窗口完整前置序列
  const c1 = createMockContents(1);
  const w1 = createMockWindow('w1', { minimized: true, alwaysOnTop: false, hubContents: c1 });
  const env = createMockEnv({
    localWins: [w1],
    windowBySender: new Map([[c1, w1]]),
    hubContentsByWin: new Map([[w1, c1]]),
  });
  const handler = env.ipcHandlers.get('notification:send');

  handler({ sender: c1 }, { title: 't1' });
  handler({ sender: c1 }, { title: 't2' });

  // 第一次点击
  env.createdNotifications[0].emit('click');
  assert.deepEqual(w1.calls, [
    ['flashFrame', false],
    ['restore'],
    ['show'],
    ['setAlwaysOnTop', true, 'screen-saver'],
    ['moveTop'],
    ['focus'],
  ]);
  assert.equal(env.appFocusCalls.length, 1);
  assert.equal(env.appFocusCalls[0].steal, true);
  assert.equal(w1.isAlwaysOnTop(), true);

  // 70ms 后（尚未到 140ms）连续第二次点击：不得把当前临时 true 误记为原状态
  env.clock.tick(70);
  assert.equal(w1.isAlwaysOnTop(), true);
  env.createdNotifications[1].emit('click');

  // 第一个 140ms 时已被重入取消，必须再等满 140ms 才取消置顶
  env.clock.tick(70);
  assert.equal(w1.isAlwaysOnTop(), true);

  env.clock.tick(70);
  assert.equal(w1.isAlwaysOnTop(), false);
  const lastThree = w1.calls.slice(-3);
  assert.deepEqual(lastThree, [
    ['setAlwaysOnTop', false],
    ['moveTop'],
    ['focus'],
  ]);

  // 6b: 原先已是 alwaysOnTop=true 的窗口不被误取消置顶
  const c2 = createMockContents(2);
  const wPinned = createMockWindow('pinned', { alwaysOnTop: true, hubContents: c2 });
  const env2 = createMockEnv({
    localWins: [wPinned],
    windowBySender: new Map([[c2, wPinned]]),
    hubContentsByWin: new Map([[wPinned, c2]]),
  });
  env2.ipcHandlers.get('notification:send')({ sender: c2 }, { title: 'pinned' });
  env2.createdNotifications[0].emit('click');
  env2.clock.tick(200);
  assert.equal(wPinned.isAlwaysOnTop(), true);
  assert.equal(wPinned.calls.some((c) => c[0] === 'setAlwaysOnTop'), false);
});

test('7. second-instance Toast 激活延迟前置本地窗口，--ssh-host= 不误抢焦，headless 不注册', () => {
  const c1 = createMockContents(1);
  const w1 = createMockWindow('w1', { minimized: true, hubContents: c1 });
  const env = createMockEnv({
    localWins: [w1],
    windowBySender: new Map([[c1, w1]]),
    hubContentsByWin: new Map([[w1, c1]]),
  });

  // --ssh-host=dev 跳过本地抢焦
  env.appEvents.emit('second-instance', {}, ['Antigravity.exe', '--ssh-host=dev']);
  env.clock.tick(100);
  assert.equal(w1.calls.length, 0);

  // -ToastActivated 30ms 后触发本地前置
  env.appEvents.emit('second-instance', {}, ['Antigravity.exe', '-ToastActivated']);
  env.clock.tick(20);
  assert.equal(w1.calls.length, 0);
  env.clock.tick(15);
  assert.ok(w1.calls.some((c) => c[0] === 'restore'));
  assert.ok(w1.calls.some((c) => c[0] === 'setAlwaysOnTop' && c[1] === true));
  env.clock.tick(140);
  assert.equal(w1.isAlwaysOnTop(), false);

  // headless 模式不监听 second-instance
  const cHeadless = createMockContents(2);
  const wHeadless = createMockWindow('wHeadless', { hubContents: cHeadless });
  const headlessEnv = createMockEnv({
    env: { ELECTRON_OZONE_PLATFORM_HINT: 'headless' },
    localWins: [wHeadless],
    hubContentsByWin: new Map([[wHeadless, cHeadless]]),
  });
  assert.equal(headlessEnv.appEvents.listenerCount('second-instance'), 0);
});
