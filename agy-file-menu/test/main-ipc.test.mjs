// Electron 主进程本地文件右键菜单模块（file-menu-main-ipc.js）单元测试
// 全程 Mock shell / clipboard / child_process.spawn，零外部弹窗副作用；临时目录固定写入 D:\Data\.temp
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const MAIN_IPC_FILE = path.resolve(here, '../src/file-menu-main-ipc.js');
const MAIN_IPC_CODE = fs.readFileSync(MAIN_IPC_FILE, 'utf8');
const nodeRequire = createRequire(import.meta.url);

const TEMP_BASE = fs.existsSync('D:\\Data\\.temp') ? 'D:\\Data\\.temp' : os.tmpdir();

function createTempDir(t) {
  fs.mkdirSync(TEMP_BASE, { recursive: true });
  const dir = fs.mkdtempSync(path.join(TEMP_BASE, 'agy-file-menu-ipc-test-'));
  t.after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

// 消除 vm.createContext 跨 Realm 原型链差异，便于 assert.deepEqual 精确断言字段结构
function toHostPlain(val) {
  return JSON.parse(JSON.stringify(val));
}

function bootMainIpcInVm({
  shellMock = null,
  clipboardMock = null,
  remoteWindowSecurityMock = undefined,
  wslMock = undefined,
  fsOverride = null,
  cpOverride = null,
} = {}) {
  const handlers = new Map();
  const removedChannels = [];
  let handleRegisterCount = 0;

  const electronMock = {
    ipcMain: {
      removeHandler: (ch) => {
        removedChannels.push(ch);
        handlers.delete(ch);
      },
      handle: (ch, fn) => {
        handleRegisterCount += 1;
        handlers.set(ch, fn);
      },
    },
    shell: shellMock || {
      showItemInFolder: () => {},
      openPath: async () => '',
    },
    clipboard: clipboardMock || {
      writeText: () => {},
    },
  };

  const sandboxGlobal = {};
  const customRequire = (id) => {
    if (id === 'electron') return electronMock;
    if (id === './remote/remoteWindowSecurity') {
      if (remoteWindowSecurityMock !== undefined) return remoteWindowSecurityMock;
      const err = new Error(`Cannot find module '${id}'`);
      err.code = 'MODULE_NOT_FOUND';
      throw err;
    }
    if (id === './wsl') {
      if (wslMock !== undefined) return wslMock;
      const err = new Error(`Cannot find module '${id}'`);
      err.code = 'MODULE_NOT_FOUND';
      throw err;
    }
    if (id === 'fs' && fsOverride) return fsOverride;
    if (id === 'child_process' && cpOverride) return cpOverride;
    return nodeRequire(id);
  };

  const context = vm.createContext({
    globalThis: sandboxGlobal,
    process,
    require: customRequire,
  });

  vm.runInContext(MAIN_IPC_CODE, context);

  return {
    context,
    sandboxGlobal,
    api: sandboxGlobal.__AGY_FILE_MENU_MAIN_API__,
    handlers,
    removedChannels,
    getHandleRegisterCount: () => handleRegisterCount,
    execHandler: handlers.get('agy-file-menu:exec'),
  };
}

test('模块基础契约：不含注入起止标记、语法合法、防重入保护生效且先 removeHandler 再 handle', async () => {
  const beginMarker = '/*' + 'AGY-FILE-MENU-MAIN-BEGIN' + '*/';
  const endMarker = '/*' + 'AGY-FILE-MENU-MAIN-END' + '*/';
  assert.equal(MAIN_IPC_CODE.includes(beginMarker), false, '源码自身严禁包含 BEGIN 注入标记');
  assert.equal(MAIN_IPC_CODE.includes(endMarker), false, '源码自身严禁包含 END 注入标记');

  execFileSync(process.execPath, ['--check', MAIN_IPC_FILE], { stdio: 'pipe' });

  const booted = bootMainIpcInVm();
  assert.equal(booted.sandboxGlobal.__AGY_FILE_MENU_MAIN_BOOTED__, true);
  assert.deepEqual(booted.removedChannels, ['agy-file-menu:exec']);
  assert.equal(booted.getHandleRegisterCount(), 1);
  assert.equal(typeof booted.execHandler, 'function');

  // 同上下文重复执行应被防重入保护直接拦截
  vm.runInContext(MAIN_IPC_CODE, booted.context);
  assert.equal(booted.getHandleRegisterCount(), 1, '重复注入执行不应二次注册 IPC 处理器');
  assert.equal(booted.removedChannels.length, 1);

  // 直接在 Node 环境加载同样可挂载测试钩子且不抛错
  await import(pathToFileURL(MAIN_IPC_FILE).href);
  assert.equal(globalThis.__AGY_FILE_MENU_MAIN_BOOTED__, true);
  assert.equal(typeof globalThis.__AGY_FILE_MENU_MAIN_API__.resolveWindowsDefaultBrowserExe, 'function');
});

test('URI 与本地路径解析：覆盖中文、空格、#L10-L20 行号锚点、?key=1 查询参数、WSL 映射与非法协议拦截', async () => {
  const { api } = bootMainIpcInVm();

  // 1. file:/// URI（含百分号编码中文与空格、?key=1 查询参数、#L10-L20 行号锚点）
  const encodedUri = 'file:///F:/Code/%E4%B8%AD%E6%96%87%20%E7%A9%BA%E6%A0%BC/readme.md?key=1&mode=preview#L10-L20';
  assert.equal(
    api.resolveTargetPath(encodedUri, { platform: 'win32' }),
    'F:\\Code\\中文 空格\\readme.md'
  );

  // 2. file:/// URI（含未编码中文空格与转义盘符冒号 %3A）
  assert.equal(
    api.resolveTargetPath('file:///f%3A/Code/中文 目录/notes.md#L5', { platform: 'win32' }),
    'f:\\Code\\中文 目录\\notes.md'
  );

  // 3. WSL 激活态下通过真实注册的 IPC 通道验证 require('./wsl') 路径转换
  const copiedInWsl = [];
  const wslBooted = bootMainIpcInVm({
    clipboardMock: { writeText: (t) => copiedInWsl.push(t) },
    wslMock: {
      getActiveWslDistro: () => 'Ubuntu-24.04',
      distroToWindowsPath: (posixPath, distro) => `\\\\wsl.localhost\\${distro}${posixPath.replace(/\//g, '\\')}`,
    },
  });
  const wslRes = await wslBooted.execHandler(
    {},
    { action: 'copy-path', target: 'file:///home/dev/%E9%A1%B9%E7%9B%AE%20A/src/main.ts?key=1#L10-L20' }
  );
  assert.deepEqual(toHostPlain(wslRes), {
    ok: true,
    path: '\\\\wsl.localhost\\Ubuntu-24.04\\home\\dev\\项目 A\\src\\main.ts',
  });
  assert.deepEqual(copiedInWsl, ['\\\\wsl.localhost\\Ubuntu-24.04\\home\\dev\\项目 A\\src\\main.ts']);

  // WSL 激活态下若点击的仍是 Windows 盘符 file:///C:/...，保持本地盘符路径
  const wslWinRes = await wslBooted.execHandler(
    {},
    { action: 'copy-path', target: 'file:///C:/Users/dev/notes.md#L12' }
  );
  assert.deepEqual(toHostPlain(wslWinRes), {
    ok: true,
    path: 'C:\\Users\\dev\\notes.md',
  });

  // 4. 本地 Windows 绝对路径（盘符反斜杠、盘符正斜杠、UNC 路径、末尾 #L12 / #L12-L34 剥离）
  assert.equal(
    api.resolveTargetPath('C:\\Users\\lyufeng\\Documents\\测试 文件\\spec.md#L12', { platform: 'win32' }),
    'C:\\Users\\lyufeng\\Documents\\测试 文件\\spec.md'
  );
  assert.equal(
    api.resolveTargetPath('f:/Code/Antigravity/src/../README.md#L12-L34', { platform: 'win32' }),
    'f:\\Code\\Antigravity\\README.md'
  );
  assert.equal(
    api.resolveTargetPath('\\\\fileserver\\shared\\docs\\report.pdf#L99', { platform: 'win32' }),
    '\\\\fileserver\\shared\\docs\\report.pdf'
  );
  // 文件名自身含 #（非行号后缀）不应误删
  assert.equal(
    api.resolveTargetPath('F:\\Code\\C#Guide\\index.md#L8-L16', { platform: 'win32' }),
    'F:\\Code\\C#Guide\\index.md'
  );

  // 5. POSIX 平台绝对路径解析
  assert.equal(
    api.resolveTargetPath('file:///Users/alice/My%20Docs/%E7%AC%94%E8%AE%B0.md?key=1#L10-L20', { platform: 'darwin' }),
    '/Users/alice/My Docs/笔记.md'
  );
  assert.equal(
    api.resolveTargetPath('/home/alice/project/app.js#L12-L34', { platform: 'linux' }),
    '/home/alice/project/app.js'
  );

  // 6. 拒绝非本地协议与相对路径
  const invalidTargets = [
    '',
    '   ',
    null,
    undefined,
    'https://github.com/org/repo/blob/main/README.md#L10-L20',
    'http://127.0.0.1:3000/index.html',
    'mailto:test@example.com',
    'antigravity://open?file=C:/a.txt',
    'javascript:alert(1)',
    './relative/file.js',
    '../parent/file.js',
    'src/file-menu-main-ipc.js',
    'C:drive-relative.txt',
    'C:',
    'C:\\bad\0null.txt',
  ];
  for (const bad of invalidTargets) {
    assert.equal(api.resolveTargetPath(bad, { platform: 'win32' }), null, `应拒绝非法目标: ${String(bad)}`);
  }
});

test('安全边界：远程 SSH 窗口调用直接返回 remote_blocked，不触发任何本地操作', async () => {
  let shellCalled = false;
  let clipboardCalled = false;
  const remoteSender = { id: 42 };
  const localSender = { id: 1 };

  const booted = bootMainIpcInVm({
    shellMock: {
      showItemInFolder: () => { shellCalled = true; },
      openPath: async () => { shellCalled = true; return ''; },
    },
    clipboardMock: {
      writeText: () => { clipboardCalled = true; },
    },
    remoteWindowSecurityMock: {
      isRemoteContents: (wc) => wc === remoteSender,
    },
  });

  const blockedRes = await booted.execHandler(
    { sender: remoteSender },
    { action: 'copy-path', target: 'F:\\Code\\Antigravity\\README.md' }
  );
  assert.deepEqual(toHostPlain(blockedRes), { ok: false, error: 'remote_blocked' });
  assert.equal(shellCalled, false);
  assert.equal(clipboardCalled, false);

  const allowedRes = await booted.execHandler(
    { sender: localSender },
    { action: 'copy-path', target: 'F:\\Code\\Antigravity\\README.md' }
  );
  assert.deepEqual(toHostPlain(allowedRes), { ok: true, path: 'F:\\Code\\Antigravity\\README.md' });
  assert.equal(clipboardCalled, true);

  clipboardCalled = false;
  const blockedCopyTextRes = await booted.execHandler(
    { sender: remoteSender },
    { action: 'copy-text', text: '选中的代码片段' }
  );
  assert.deepEqual(toHostPlain(blockedCopyTextRes), { ok: false, error: 'remote_blocked' });
  assert.equal(clipboardCalled, false);
});

test('Windows 注册表命令解析与默认浏览器探测优先级（HKCU -> HKLM -> HKCR -> 常见路径兜底）', () => {
  const { api } = bootMainIpcInVm();

  // 1. 带双引号与启动参数的命令行
  assert.equal(
    api.parseExeFromCommand('"C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe" --single-argument %1'),
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
  );

  // 2. 无引号路径（含空格目录名及后续参数）
  assert.equal(
    api.parseExeFromCommand('C:\\Program Files\\Mozilla Firefox\\firefox.exe -osint -url "%1"'),
    'C:\\Program Files\\Mozilla Firefox\\firefox.exe'
  );
  assert.equal(
    api.parseExeFromCommand('D:\\PortableApps\\Chrome\\chrome.exe -- "%1"'),
    'D:\\PortableApps\\Chrome\\chrome.exe'
  );
  assert.equal(api.parseExeFromCommand('msedge.exe %1'), null, '非绝对路径应拒绝');

  // 3. REG_EXPAND_SZ 环境变量展开与中文注册表输出（(默认)）解析
  assert.equal(
    api.parseExeFromCommand('"%LOCALAPPDATA%\\Programs\\Opera\\launcher.exe" -- "%1"', {
      LOCALAPPDATA: 'C:\\Users\\Alice\\AppData\\Local',
    }),
    'C:\\Users\\Alice\\AppData\\Local\\Programs\\Opera\\launcher.exe'
  );

  const zhRegOut = '\r\nHKEY_LOCAL_MACHINE\\Software\\Classes\\MSEdgeHTM\\shell\\open\\command\r\n    (默认)    REG_SZ    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --single-argument %1\r\n';
  assert.equal(
    api.parseDefaultValueFromRegOutput(zhRegOut),
    '"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --single-argument %1'
  );

  // 4. Win11 UserChoiceLatest\ProgId 优先于旧版 UserChoice（后者可能残留出厂 MSEdgeHTM）
  const win11Queries = [];
  const win11Existing = new Set([
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ]);
  const win11Exe = api.resolveWindowsDefaultBrowserExe({
    execFileSync: (_cmd, args) => {
      win11Queries.push(args.join(' '));
      const key = args[1];
      if (key === 'HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoiceLatest\\ProgId') {
        return '    ProgId    REG_SZ    ChromeHTML\r\n';
      }
      if (key === 'HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoice') {
        return '    ProgId    REG_SZ    MSEdgeHTM\r\n';
      }
      if (key === 'HKLM\\Software\\Classes\\ChromeHTML\\shell\\open\\command') {
        return '    (Default)    REG_SZ    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --single-argument %1\r\n';
      }
      if (key === 'HKLM\\Software\\Classes\\MSEdgeHTM\\shell\\open\\command') {
        return '    (Default)    REG_SZ    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe" --single-argument %1\r\n';
      }
      throw new Error('not found');
    },
    existsSync: (p) => win11Existing.has(p),
    env: {},
  });
  assert.equal(win11Exe, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe');
  assert.deepEqual(win11Queries, [
    'query HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoiceLatest\\ProgId /v ProgId',
    'query HKCU\\Software\\Classes\\ChromeHTML\\shell\\open\\command /ve',
    'query HKLM\\Software\\Classes\\ChromeHTML\\shell\\open\\command /ve',
  ]);

  // 5. 验证注册表查询顺序：无 UserChoiceLatest 时回退旧 UserChoice，且 HKCU 指向已卸载路径时回退 HKLM
  const queriedKeys = [];
  const existingSet = new Set(['C:\\Browsers\\Firefox\\firefox.exe']);
  const regExe = api.resolveWindowsDefaultBrowserExe({
    execFileSync: (_cmd, args) => {
      queriedKeys.push(args.join(' '));
      const key = args[1];
      if (key.endsWith('https\\UserChoice')) {
        return '    ProgId    REG_SZ    FirefoxURL-123\r\n';
      }
      if (key === 'HKCU\\Software\\Classes\\FirefoxURL-123\\shell\\open\\command') {
        return '    (Default)    REG_SZ    "C:\\Stale\\Missing\\firefox.exe" "%1"\r\n';
      }
      if (key === 'HKLM\\Software\\Classes\\FirefoxURL-123\\shell\\open\\command') {
        return '    (默认)    REG_SZ    "C:\\Browsers\\Firefox\\firefox.exe" -osint -url "%1"\r\n';
      }
      throw new Error('not found');
    },
    existsSync: (p) => existingSet.has(p),
    env: {},
  });

  assert.equal(regExe, 'C:\\Browsers\\Firefox\\firefox.exe');
  assert.deepEqual(queriedKeys, [
    'query HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoiceLatest\\ProgId /v ProgId',
    'query HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\http\\UserChoiceLatest\\ProgId /v ProgId',
    'query HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\.html\\UserChoiceLatest\\ProgId /v ProgId',
    'query HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoice /v ProgId',
    'query HKCU\\Software\\Classes\\FirefoxURL-123\\shell\\open\\command /ve',
    'query HKLM\\Software\\Classes\\FirefoxURL-123\\shell\\open\\command /ve',
  ]);

  // 6. 注册表完全未命中时，回退探测本机常见浏览器路径（Edge / Chrome）
  const fallbackEdge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  const fallbackExe = api.resolveWindowsDefaultBrowserExe({
    execFileSync: () => { throw new Error('reg failed'); },
    existsSync: (p) => p === fallbackEdge,
    env: {
      'ProgramFiles(x86)': 'C:\\Program Files (x86)',
      ProgramFiles: 'C:\\Program Files',
    },
  });
  assert.equal(fallbackExe, fallbackEdge);

  // 7. 本机只读实测：不 spawn 进程，验证在当前 Windows 环境准确识别出系统默认浏览器（Chrome）
  if (process.platform === 'win32') {
    const realExe = api.resolveWindowsDefaultBrowserExe();
    assert.ok(realExe && fs.existsSync(realExe), '本机应能解析出存在的默认浏览器可执行文件');
    assert.equal(realExe.toLowerCase(), 'c:\\program files\\google\\chrome\\application\\chrome.exe');
  }
});

test('4 个固定 action 分发完整闭环（全 Mock 无弹窗副作用，覆盖 Windows / macOS / Linux）', async (t) => {
  const tempDir = createTempDir(t);
  const subDir = path.join(tempDir, '中文 子目录');
  fs.mkdirSync(subDir, { recursive: true });
  const existingMd = path.join(subDir, '设计说明 草案.md');
  fs.writeFileSync(existingMd, '# Hello\n', 'utf8');
  const deletedFileInExistingDir = path.join(subDir, '已删除文件.ts');

  const shownItems = [];
  const openedPaths = [];
  const copiedTexts = [];
  const spawnedCalls = [];
  let unrefCalled = 0;
  let nextOpenPathError = '';

  const electronMock = {
    ipcMain: { removeHandler: () => {}, handle: () => {} },
    shell: {
      showItemInFolder: (p) => { shownItems.push(p); },
      openPath: async (p) => {
        openedPaths.push(p);
        return nextOpenPathError;
      },
    },
    clipboard: {
      writeText: (txt) => { copiedTexts.push(txt); },
    },
  };

  const mockBrowserExe = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const booted = bootMainIpcInVm({
    shellMock: electronMock.shell,
    clipboardMock: electronMock.clipboard,
    remoteWindowSecurityMock: { isRemoteContents: () => false },
    fsOverride: {
      existsSync: (p) => p === mockBrowserExe || fs.existsSync(p),
    },
    cpOverride: {
      execFileSync: (_file, args) => {
        if (args[1].endsWith('https\\UserChoice')) {
          return '    ProgId    REG_SZ    ChromeHTML\r\n';
        }
        if (args[1] === 'HKCR\\ChromeHTML\\shell\\open\\command') {
          return `    (默认)    REG_SZ    "${mockBrowserExe}" --single-argument %1\r\n`;
        }
        throw new Error('miss');
      },
      spawn: (exe, args, opts) => {
        spawnedCalls.push({ exe, args, opts });
        return {
          on: () => {},
          unref: () => { unrefCalled += 1; },
        };
      },
    },
  });

  const handler = booted.execHandler;
  const mdUriWithHash = `${pathToFileURL(existingMd).href}?ts=123#L1-L5`;

  // 1. reveal-in-explorer：目标文件存在 -> 调用 showItemInFolder
  const resReveal1 = await handler({}, { action: 'reveal-in-explorer', target: mdUriWithHash });
  assert.deepEqual(toHostPlain(resReveal1), { ok: true, path: existingMd });
  assert.deepEqual(shownItems, [existingMd]);
  assert.equal(openedPaths.length, 0);

  // 1b. reveal-in-explorer：目标文件不存在但父目录存在 -> 回退 shell.openPath(dirname)
  const resReveal2 = await handler({}, { action: 'reveal-in-explorer', target: `${deletedFileInExistingDir}#L20` });
  assert.deepEqual(toHostPlain(resReveal2), { ok: true, path: deletedFileInExistingDir });
  assert.deepEqual(openedPaths, [subDir]);

  // 2. open-with-default-app：成功与返回错误消息两种分支
  openedPaths.length = 0;
  const resOpenOk = await handler({}, { action: 'open-with-default-app', target: mdUriWithHash });
  assert.deepEqual(toHostPlain(resOpenOk), { ok: true, path: existingMd });
  assert.deepEqual(openedPaths, [existingMd]);

  nextOpenPathError = 'No application is associated with the specified file';
  const resOpenFail = await handler({}, { action: 'open-with-default-app', target: existingMd });
  assert.deepEqual(toHostPlain(resOpenFail), { ok: false, error: nextOpenPathError });
  nextOpenPathError = '';

  // 3. open-in-default-browser：对 .md 文件强制走系统默认浏览器打开标准 file:/// URL，不走文本编辑器
  openedPaths.length = 0;
  const expectedFileUrl = pathToFileURL(existingMd).href;
  const resBrowser = await handler({}, { action: 'open-in-default-browser', target: mdUriWithHash });
  assert.deepEqual(toHostPlain(resBrowser), {
    ok: true,
    path: existingMd,
    url: expectedFileUrl,
  });
  assert.equal(openedPaths.length, 0, '命中默认浏览器时不应回退 shell.openPath');
  assert.equal(spawnedCalls.length, 1);
  assert.equal(spawnedCalls[0].exe, mockBrowserExe);
  assert.deepEqual(toHostPlain(spawnedCalls[0].args), [expectedFileUrl]);
  assert.deepEqual(toHostPlain(spawnedCalls[0].opts), {
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
  });
  assert.equal(unrefCalled, 1);

  // 3b. open-in-default-browser：当注册表与常见浏览器路径全部未命中时，回退 shell.openPath
  const fallbackHandler = booted.api.createExecHandler({
    electron: electronMock,
    platform: 'win32',
    fs: { existsSync: () => false },
    childProcess: {
      execFileSync: () => { throw new Error('no reg'); },
      spawn: () => { throw new Error('should not spawn'); },
    },
  });
  const resBrowserFallback = await fallbackHandler({}, { action: 'open-in-default-browser', target: existingMd });
  assert.deepEqual(toHostPlain(resBrowserFallback), {
    ok: true,
    path: existingMd,
    url: expectedFileUrl,
  });
  assert.deepEqual(openedPaths, [existingMd]);

  // 3c. macOS 与 Linux 默认浏览器兜底逻辑（全 Mock）
  const posixSpawns = [];
  const macHandler = booted.api.createExecHandler({
    electron: electronMock,
    platform: 'darwin',
    fs: { existsSync: (p) => p === '/Applications/Safari.app' },
    childProcess: {
      execFileSync: () => '',
      spawn: (exe, args, opts) => {
        posixSpawns.push({ exe, args, opts });
        return { on: () => {}, unref: () => {} };
      },
    },
  });
  const macRes = await macHandler({}, { action: 'open-in-default-browser', target: '/Users/dev/notes.md#L3' });
  assert.deepEqual(toHostPlain(macRes), {
    ok: true,
    path: '/Users/dev/notes.md',
    url: 'file:///Users/dev/notes.md',
  });
  assert.equal(posixSpawns[0].exe, 'open');
  assert.deepEqual(toHostPlain(posixSpawns[0].args), ['-a', '/Applications/Safari.app', 'file:///Users/dev/notes.md']);

  const linuxHandler = booted.api.createExecHandler({
    electron: electronMock,
    platform: 'linux',
    fs: { existsSync: (p) => p === '/usr/bin/firefox' },
    childProcess: {
      execFileSync: () => 'firefox.desktop\n',
      spawn: (exe, args, opts) => {
        posixSpawns.push({ exe, args, opts });
        return { on: () => {}, unref: () => {} };
      },
    },
  });
  const linuxRes = await linuxHandler({}, { action: 'open-in-default-browser', target: '/home/dev/spec.json' });
  assert.deepEqual(toHostPlain(linuxRes), {
    ok: true,
    path: '/home/dev/spec.json',
    url: 'file:///home/dev/spec.json',
  });
  assert.equal(posixSpawns[1].exe, '/usr/bin/firefox');
  assert.deepEqual(toHostPlain(posixSpawns[1].args), ['file:///home/dev/spec.json']);

  // 4. copy-path：复制规范化后的本地文件绝对路径
  const resCopy = await handler({}, { action: 'copy-path', target: mdUriWithHash });
  assert.deepEqual(toHostPlain(resCopy), { ok: true, path: existingMd });
  assert.deepEqual(copiedTexts, [existingMd]);

  // 4b. copy-text：直接写入主进程剪贴板文本（沙箱窗口复制兜底），无需 target
  copiedTexts.length = 0;
  const resCopyText = await handler({}, { action: 'copy-text', text: '选中的代码片段' });
  assert.deepEqual(toHostPlain(resCopyText), { ok: true });
  assert.deepEqual(copiedTexts, ['选中的代码片段']);

  const resCopyEmptyText = await handler({}, { action: 'copy-text', text: '' });
  assert.deepEqual(toHostPlain(resCopyEmptyText), { ok: false, error: 'empty_text' });

  // 5. 非法路径与未知 action 容错
  const resInvalidPath = await handler({}, { action: 'copy-path', target: 'https://example.com/a.md' });
  assert.deepEqual(toHostPlain(resInvalidPath), { ok: false, error: 'invalid_path' });

  const resUnknownAction = await handler({}, { action: 'unknown-op', target: existingMd });
  assert.deepEqual(toHostPlain(resUnknownAction), { ok: false, error: 'unknown_action' });
});
