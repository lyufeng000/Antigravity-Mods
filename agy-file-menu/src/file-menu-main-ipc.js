// Antigravity 主进程（dist/main.js）本地文件右键菜单操作模块
// 仅在本地 Hub 窗口响应文件定位、默认程序打开、默认浏览器打开与路径复制，拦截远程 SSH 窗口调用。
(function () {
  'use strict';

  if (globalThis.__AGY_FILE_MENU_MAIN_BOOTED__) return;
  Object.defineProperty(globalThis, '__AGY_FILE_MENU_MAIN_BOOTED__', { value: true });

  var baseRequire = typeof require === 'function'
    ? require
    : (typeof process !== 'undefined' && process && typeof process.getBuiltinModule === 'function'
      ? function (id) { return process.getBuiltinModule(id); }
      : null);
  if (!baseRequire) return;

  var fs = baseRequire('fs');
  var path = baseRequire('path');
  var url = baseRequire('url');
  var childProcess = baseRequire('child_process');
  var BufferCtor = typeof Buffer === 'function' ? Buffer : baseRequire('buffer').Buffer;
  var TextDecoderCtor = typeof TextDecoder === 'function' ? TextDecoder : baseRequire('util').TextDecoder;
  var URLCtor = typeof URL === 'function' ? URL : url.URL;

  var electron = null;
  try {
    var rawElectron = baseRequire('electron');
    if (rawElectron && typeof rawElectron === 'object') {
      electron = rawElectron;
    }
  } catch (_) {}

  var CHANNEL = 'agy-file-menu:exec';
  var ACTIONS = {
    REVEAL_IN_EXPLORER: 'reveal-in-explorer',
    OPEN_WITH_DEFAULT_APP: 'open-with-default-app',
    OPEN_IN_DEFAULT_BROWSER: 'open-in-default-browser',
    COPY_PATH: 'copy-path',
    COPY_TEXT: 'copy-text',
  };

  var BROWSER_CHOICE_KEYS = [
    'HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoiceLatest\\ProgId',
    'HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\http\\UserChoiceLatest\\ProgId',
    'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\.html\\UserChoiceLatest\\ProgId',
    'HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoice',
    'HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\http\\UserChoice',
    'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\.html\\UserChoice',
  ];

  function decodeWinBuffer(buf) {
    if (typeof buf === 'string') return buf;
    if (!buf) return '';
    if (BufferCtor && BufferCtor.isBuffer(buf)) {
      if (typeof TextDecoderCtor === 'function') {
        try {
          return new TextDecoderCtor('utf-8', { fatal: true }).decode(buf);
        } catch (_) {
          try {
            return new TextDecoderCtor('gb18030').decode(buf);
          } catch (_2) {}
        }
      }
      return buf.toString('utf8');
    }
    return String(buf);
  }

  function expandWinEnvVars(input, env) {
    var envMap = env || (typeof process !== 'undefined' && process.env) || {};
    return String(input || '').replace(/%([^%]+)%/g, function (full, varName) {
      if (Object.prototype.hasOwnProperty.call(envMap, varName) && envMap[varName] !== undefined) {
        return String(envMap[varName]);
      }
      var upper = varName.toUpperCase();
      var keys = Object.keys(envMap);
      for (var i = 0; i < keys.length; i++) {
        if (keys[i].toUpperCase() === upper && envMap[keys[i]] !== undefined) {
          return String(envMap[keys[i]]);
        }
      }
      return full;
    });
  }

  function stripLineAnchor(rawPath) {
    if (typeof rawPath !== 'string') return '';
    return rawPath.replace(/#[Ll]\d+(?:[Cc]\d+)?(?:-[Ll]?\d+(?:[Cc]\d+)?)?$/, '');
  }

  function isWindowsAbsoluteLocalPath(candidate) {
    if (typeof candidate !== 'string' || !candidate) return false;
    if (/^[A-Za-z]:[\\/]/.test(candidate)) return true;
    if (/^\\\\\?\\[A-Za-z]:[\\/]/.test(candidate)) return true;
    if (/^\\\\\?\\UNC\\[^\\/?*]+\\[^\\/?*]+/i.test(candidate)) return true;
    if (/^(?:\\\\|\/\/)[^\\/?*]+[\\/][^\\/?*]+/.test(candidate)) return true;
    return false;
  }

  function defaultDistroToWindowsPath(posixPath, distro) {
    return '\\\\wsl.localhost\\' + distro + String(posixPath || '').replace(/\//g, '\\');
  }

  function resolveTargetPath(target, options) {
    if (typeof target !== 'string') return null;
    var raw = target.trim();
    if (!raw || raw.indexOf('\0') !== -1) return null;

    var opts = options || {};
    var effectivePlatform = opts.platform || (typeof process !== 'undefined' ? process.platform : 'win32');
    var urlMod = opts.urlMod || url;
    var pathMod = opts.pathMod || (effectivePlatform === 'win32' ? path.win32 : path.posix);
    var wslMod = opts.wsl;
    if (wslMod === undefined && opts.requireFn) {
      try { wslMod = opts.requireFn('./wsl'); } catch (_) { wslMod = null; }
    }

    var activeDistro = '';
    if (wslMod && typeof wslMod.getActiveWslDistro === 'function') {
      try { activeDistro = wslMod.getActiveWslDistro() || ''; } catch (_) { activeDistro = ''; }
    }
    var toWinWslPath = (wslMod && typeof wslMod.distroToWindowsPath === 'function')
      ? function (p, d) { return wslMod.distroToWindowsPath(p, d); }
      : defaultDistroToWindowsPath;

    // 1. file:// URI 解析（剥离 search 与 hash，兼容中文/空格编码及 WSL 路径映射）
    if (/^file:/i.test(raw)) {
      try {
        var parsed = new URLCtor(raw);
        if (parsed.protocol.toLowerCase() !== 'file:') return null;
        parsed.hash = '';
        parsed.search = '';
        var cleanUrl = parsed.href;
        var host = (parsed.hostname || '').toLowerCase();

        if (activeDistro && (!host || host === 'localhost')) {
          var posixPath = urlMod.fileURLToPath(cleanUrl, { windows: false });
          if (!posixPath || posixPath.indexOf('\0') !== -1) return null;
          // 若 file:///C:/... 本身带 Windows 盘符，直接走本地 Windows 路径解析
          if (/^\/[A-Za-z]:(?:\/|$)/.test(posixPath)) {
            var winDirect = urlMod.fileURLToPath(cleanUrl, { windows: true });
            return path.win32.resolve(winDirect);
          }
          return toWinWslPath(posixPath, activeDistro);
        }

        var localFromUrl = effectivePlatform === (typeof process !== 'undefined' ? process.platform : 'win32')
          ? urlMod.fileURLToPath(cleanUrl)
          : urlMod.fileURLToPath(cleanUrl, { windows: effectivePlatform === 'win32' });
        if (!localFromUrl || localFromUrl.indexOf('\0') !== -1) return null;
        return pathMod.resolve(localFromUrl);
      } catch (_) {
        return null;
      }
    }

    // 2. 拒绝非本地协议（如 http:, https:, mailto:, antigravity:, vscode: 等，保留单字母盘符 C:\）
    if (/^[A-Za-z][A-Za-z0-9+.-]+:/.test(raw)) {
      return null;
    }

    // 3. 剥离末尾行号锚点（如 #L12 或 #L12-L34）
    var stripped = stripLineAnchor(raw).trim();
    if (!stripped || stripped.indexOf('\0') !== -1) return null;

    if (effectivePlatform === 'win32') {
      // 兼容形如 /c:/Users/... 的前端路径表示
      if (/^\/[A-Za-z]:[\\/]/.test(stripped)) {
        stripped = stripped.slice(1);
      }
      if (isWindowsAbsoluteLocalPath(stripped)) {
        return path.win32.resolve(stripped);
      }
      // WSL 激活态下支持直接传入 POSIX 绝对路径（如 /home/user/file.ts）
      if (activeDistro && /^\/(?!\/)/.test(stripped)) {
        var normPosix = path.posix.resolve(stripped);
        return toWinWslPath(normPosix, activeDistro);
      }
      return null;
    }

    // macOS / Linux 仅接受以 / 开头的本地绝对路径（拒绝相对路径）
    if (/^\/(?!\/)/.test(stripped)) {
      return path.posix.resolve(stripped);
    }
    return null;
  }

  function parseProgIdFromRegOutput(output) {
    var text = decodeWinBuffer(output);
    if (!text) return null;
    var m = /^\s*ProgId\s+REG_SZ\s+([^\r\n]+?)\s*$/im.exec(text);
    if (!m || !m[1]) return null;
    var progId = m[1].trim();
    if (!progId || /[\0\r\n]/.test(progId)) return null;
    return progId;
  }

  function parseDefaultValueFromRegOutput(output) {
    var text = decodeWinBuffer(output);
    if (!text) return null;
    var m = /\bREG_(?:EXPAND_)?SZ\s+([^\r\n]+)/i.exec(text);
    if (!m || !m[1]) return null;
    var val = m[1].trim();
    return val || null;
  }

  function parseExeFromCommand(rawCommand, env) {
    if (typeof rawCommand !== 'string') return null;
    var trimmed = rawCommand.trim();
    if (!trimmed || trimmed.indexOf('\0') !== -1) return null;

    var expanded = expandWinEnvVars(trimmed, env).trim();
    var candidate = null;

    if (expanded.charAt(0) === '"') {
      var quoted = /^"([^"]+)"/.exec(expanded);
      if (!quoted || !quoted[1]) return null;
      candidate = quoted[1].trim();
    } else {
      var unquoted = /^([^\r\n"]*?\.exe)(?=\s|$)/i.exec(expanded);
      if (!unquoted || !unquoted[1]) return null;
      candidate = unquoted[1].trim();
    }

    if (!candidate || !/\.exe$/i.test(candidate)) return null;
    if (!isWindowsAbsoluteLocalPath(candidate)) return null;
    return path.win32.normalize(candidate);
  }

  function getCommonWindowsBrowserCandidates(env) {
    var envMap = env || (typeof process !== 'undefined' && process.env) || {};
    var pf86 = envMap['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    var pf = envMap.ProgramFiles || 'C:\\Program Files';
    var localAppData = envMap.LOCALAPPDATA || '';

    var rawList = [
      path.win32.join(pf86, 'Microsoft\\Edge\\Application\\msedge.exe'),
      path.win32.join(pf, 'Microsoft\\Edge\\Application\\msedge.exe'),
      localAppData ? path.win32.join(localAppData, 'Microsoft\\Edge\\Application\\msedge.exe') : '',
      path.win32.join(pf, 'Google\\Chrome\\Application\\chrome.exe'),
      path.win32.join(pf86, 'Google\\Chrome\\Application\\chrome.exe'),
      localAppData ? path.win32.join(localAppData, 'Google\\Chrome\\Application\\chrome.exe') : '',
    ];

    var seen = {};
    var result = [];
    for (var i = 0; i < rawList.length; i++) {
      var item = rawList[i];
      if (!item) continue;
      var key = item.toLowerCase();
      if (!seen[key]) {
        seen[key] = true;
        result.push(item);
      }
    }
    return result;
  }

  function queryRegistrySync(execFileSyncFn, args) {
    try {
      var out = execFileSyncFn('reg.exe', args, {
        stdio: ['ignore', 'pipe', 'ignore'],
        windowsHide: true,
        timeout: 4000,
      });
      return decodeWinBuffer(out);
    } catch (_) {
      return '';
    }
  }

  function resolveWindowsDefaultBrowserExe(options) {
    var opts = options || {};
    var execFileSyncFn = opts.execFileSync || childProcess.execFileSync;
    var existsSyncFn = opts.existsSync || fs.existsSync;
    var envMap = opts.env || (typeof process !== 'undefined' && process.env) || {};

    // 1. 按 Win11 UserChoiceLatest\ProgId 优先于旧版 UserChoice 逐个探测默认浏览器 ProgId，并按 HKCU -> HKLM -> HKCR 查命令
    var triedProgIds = {};
    for (var k = 0; k < BROWSER_CHOICE_KEYS.length; k++) {
      var choiceOut = queryRegistrySync(execFileSyncFn, ['query', BROWSER_CHOICE_KEYS[k], '/v', 'ProgId']);
      var progId = parseProgIdFromRegOutput(choiceOut);
      if (!progId || triedProgIds[progId]) continue;
      triedProgIds[progId] = true;

      var commandKeys = [
        'HKCU\\Software\\Classes\\' + progId + '\\shell\\open\\command',
        'HKLM\\Software\\Classes\\' + progId + '\\shell\\open\\command',
        'HKCR\\' + progId + '\\shell\\open\\command',
      ];
      for (var i = 0; i < commandKeys.length; i++) {
        var cmdOut = queryRegistrySync(execFileSyncFn, ['query', commandKeys[i], '/ve']);
        var cmdRaw = parseDefaultValueFromRegOutput(cmdOut);
        if (!cmdRaw) continue;
        var parsedExe = parseExeFromCommand(cmdRaw, envMap);
        if (parsedExe && existsSyncFn(parsedExe)) {
          return parsedExe;
        }
      }
    }

    // 2. 回退探测常见本机浏览器路径（Edge / Chrome）
    var fallbacks = getCommonWindowsBrowserCandidates(envMap);
    for (var j = 0; j < fallbacks.length; j++) {
      if (existsSyncFn(fallbacks[j])) {
        return fallbacks[j];
      }
    }

    return null;
  }

  function spawnDetached(spawnFn, command, args, options) {
    var child = spawnFn(command, args, options);
    if (child && typeof child.on === 'function') {
      child.on('error', function () {});
    }
    if (child && typeof child.unref === 'function') {
      child.unref();
    }
    return child;
  }

  function resolveLinuxBrowserExe(execFileSyncFn, existsSyncFn) {
    try {
      var raw = execFileSyncFn('xdg-settings', ['get', 'default-web-browser'], {
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 3000,
      });
      var desktop = decodeWinBuffer(raw).trim();
      if (desktop && /\.desktop$/i.test(desktop)) {
        var base = desktop.replace(/\.desktop$/i, '');
        var dirs = ['/usr/bin', '/usr/local/bin', '/snap/bin'];
        for (var i = 0; i < dirs.length; i++) {
          var p = path.posix.join(dirs[i], base);
          if (existsSyncFn(p)) return p;
        }
      }
    } catch (_) {}

    var linuxCandidates = [
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/microsoft-edge',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/usr/bin/firefox',
      '/usr/bin/x-www-browser',
    ];
    for (var j = 0; j < linuxCandidates.length; j++) {
      if (existsSyncFn(linuxCandidates[j])) return linuxCandidates[j];
    }
    return null;
  }

  function resolveDarwinBrowserApp(existsSyncFn) {
    var macApps = [
      '/Applications/Google Chrome.app',
      '/Applications/Microsoft Edge.app',
      '/Applications/Brave Browser.app',
      '/Applications/Arc.app',
      '/Applications/Firefox.app',
      '/Applications/Safari.app',
      '/System/Volumes/Preboot/Cryptexes/App/System/Applications/Safari.app',
    ];
    for (var i = 0; i < macApps.length; i++) {
      if (existsSyncFn(macApps[i])) return macApps[i];
    }
    return null;
  }

  function toStandardFileUrl(resolvedPath, effectivePlatform, urlMod) {
    var runtimePlatform = typeof process !== 'undefined' ? process.platform : 'win32';
    if (effectivePlatform === runtimePlatform) {
      return urlMod.pathToFileURL(resolvedPath).href;
    }
    return urlMod.pathToFileURL(resolvedPath, { windows: effectivePlatform === 'win32' }).href;
  }

  function createExecHandler(deps) {
    var d = deps || {};
    var fsMod = d.fs || fs;
    var urlMod = d.url || url;
    var cpMod = d.childProcess || childProcess;
    var effectivePlatform = d.platform || (typeof process !== 'undefined' ? process.platform : 'win32');
    var pathMod = d.path || (effectivePlatform === 'win32' ? path.win32 : path.posix);
    var envMap = d.env || (typeof process !== 'undefined' && process.env) || {};
    var reqFn = d.requireFn || (typeof require === 'function' ? require : null);

    var getElectron = function () {
      return d.electron || electron;
    };

    var isRemoteSender = function (event) {
      var rws = d.remoteWindowSecurity;
      if (rws === undefined && reqFn) {
        try { rws = reqFn('./remote/remoteWindowSecurity'); } catch (_) { rws = null; }
      }
      if (rws && typeof rws.isRemoteContents === 'function') {
        try {
          if (rws.isRemoteContents(event ? event.sender : undefined)) {
            return true;
          }
        } catch (_) {
          return true;
        }
      }
      return false;
    };

    return async function handleFileMenuExec(event, payload) {
      if (isRemoteSender(event)) {
        return { ok: false, error: 'remote_blocked' };
      }

      if (!payload || typeof payload !== 'object') {
        return { ok: false, error: 'invalid_path' };
      }

      if (payload.action === ACTIONS.COPY_TEXT) {
        var textToCopy = typeof payload.text === 'string' ? payload.text : '';
        if (!textToCopy) return { ok: false, error: 'empty_text' };
        var elForCopy = getElectron();
        var clipForCopy = elForCopy && elForCopy.clipboard;
        if (!clipForCopy || typeof clipForCopy.writeText !== 'function') {
          return { ok: false, error: 'clipboard_unavailable' };
        }
        clipForCopy.writeText(textToCopy);
        return { ok: true };
      }

      var resolvedPath = resolveTargetPath(payload.target, {
        platform: effectivePlatform,
        pathMod: pathMod,
        urlMod: urlMod,
        wsl: d.wsl,
        requireFn: reqFn,
      });

      if (!resolvedPath) {
        return { ok: false, error: 'invalid_path' };
      }

      var el = getElectron();
      var shell = el && el.shell;
      var clipboard = el && el.clipboard;
      var action = payload.action;

      if (action === ACTIONS.REVEAL_IN_EXPLORER) {
        if (!shell) return { ok: false, error: 'shell_unavailable' };
        if (fsMod.existsSync(resolvedPath)) {
          shell.showItemInFolder(resolvedPath);
          return { ok: true, path: resolvedPath };
        }
        var parentDir = pathMod.dirname(resolvedPath);
        if (parentDir && parentDir !== resolvedPath && fsMod.existsSync(parentDir)) {
          var revealErr = await shell.openPath(parentDir);
          if (typeof revealErr === 'string' && revealErr.length > 0) {
            return { ok: false, error: revealErr };
          }
          return { ok: true, path: resolvedPath };
        }
        return { ok: false, error: 'not_found' };
      }

      if (action === ACTIONS.OPEN_WITH_DEFAULT_APP) {
        if (!shell) return { ok: false, error: 'shell_unavailable' };
        var appErr = await shell.openPath(resolvedPath);
        if (typeof appErr === 'string' && appErr.length > 0) {
          return { ok: false, error: appErr };
        }
        return { ok: true, path: resolvedPath };
      }

      if (action === ACTIONS.OPEN_IN_DEFAULT_BROWSER) {
        var fileUrl = toStandardFileUrl(resolvedPath, effectivePlatform, urlMod);

        if (effectivePlatform === 'win32') {
          var winExe = resolveWindowsDefaultBrowserExe({
            execFileSync: cpMod.execFileSync,
            existsSync: function (p) { return fsMod.existsSync(p); },
            env: envMap,
          });
          if (winExe) {
            spawnDetached(cpMod.spawn, winExe, [fileUrl], {
              detached: true,
              stdio: 'ignore',
              windowsHide: false,
            });
            return { ok: true, path: resolvedPath, url: fileUrl };
          }
        } else if (effectivePlatform === 'darwin') {
          var macApp = resolveDarwinBrowserApp(function (p) { return fsMod.existsSync(p); });
          if (macApp) {
            spawnDetached(cpMod.spawn, 'open', ['-a', macApp, fileUrl], {
              detached: true,
              stdio: 'ignore',
            });
            return { ok: true, path: resolvedPath, url: fileUrl };
          }
        } else {
          var linuxExe = resolveLinuxBrowserExe(
            cpMod.execFileSync,
            function (p) { return fsMod.existsSync(p); }
          );
          if (linuxExe) {
            spawnDetached(cpMod.spawn, linuxExe, [fileUrl], {
              detached: true,
              stdio: 'ignore',
            });
            return { ok: true, path: resolvedPath, url: fileUrl };
          }
        }

        if (!shell) return { ok: false, error: 'shell_unavailable' };
        var fallbackErr = await shell.openPath(resolvedPath);
        if (typeof fallbackErr === 'string' && fallbackErr.length > 0) {
          return { ok: false, error: fallbackErr };
        }
        return { ok: true, path: resolvedPath, url: fileUrl };
      }

      if (action === ACTIONS.COPY_PATH) {
        if (!clipboard || typeof clipboard.writeText !== 'function') {
          return { ok: false, error: 'clipboard_unavailable' };
        }
        clipboard.writeText(resolvedPath);
        return { ok: true, path: resolvedPath };
      }

      return { ok: false, error: 'unknown_action' };
    };
  }

  var api = {
    CHANNEL: CHANNEL,
    ACTIONS: ACTIONS,
    stripLineAnchor: stripLineAnchor,
    resolveTargetPath: resolveTargetPath,
    parseProgIdFromRegOutput: parseProgIdFromRegOutput,
    parseDefaultValueFromRegOutput: parseDefaultValueFromRegOutput,
    parseExeFromCommand: parseExeFromCommand,
    getCommonWindowsBrowserCandidates: getCommonWindowsBrowserCandidates,
    resolveWindowsDefaultBrowserExe: resolveWindowsDefaultBrowserExe,
    createExecHandler: createExecHandler,
  };

  Object.defineProperty(globalThis, '__AGY_FILE_MENU_MAIN_API__', {
    value: api,
    configurable: true,
  });

  var ipcMain = electron && electron.ipcMain;
  if (!ipcMain) {
    if (
      typeof module === 'object' &&
      module &&
      module.exports &&
      typeof module.exports === 'object' &&
      Object.keys(module.exports).length === 0
    ) {
      module.exports = api;
    }
    return;
  }

  if (typeof ipcMain.removeHandler === 'function') {
    ipcMain.removeHandler(CHANNEL);
  }
  ipcMain.handle(CHANNEL, createExecHandler());
})();
