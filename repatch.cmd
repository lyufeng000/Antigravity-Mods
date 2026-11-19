@echo off
chcp 65001 >nul
setlocal
title Antigravity 五补丁一键恢复 (汉化 + 周额度 + 文件菜单 + Tokens + 周期表)

echo ========================================================
echo   Antigravity 五补丁恢复工具
echo   agy-zh-cn / agy-weekly-quota / agy-file-menu / agy-token-meter / agy-periodic-model
echo ========================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 未检测到 Node.js 环境，请确认 node 已加入 PATH。
  pause
  exit /b 1
)

node "%~dp0repatch-all.mjs" %*
if errorlevel 1 (
  echo.
  echo [失败] 补丁预检或执行未通过，请查看上方报错信息。
  pause
  exit /b 1
)

echo.
pause
