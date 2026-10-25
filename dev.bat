@echo off
chcp 65001 >nul
cd /d "%~dp0"

set "PORT=8000"

where node >nul 2>nul
if errorlevel 1 goto usePython

echo.
echo   正在启动本地服务器 (Node) ...
echo   地址: http://localhost:%PORT%
echo   关闭本窗口即停止服务。
node dev-server.mjs %PORT% --open
goto end

:usePython
where python >nul 2>nul
if errorlevel 1 goto noRuntime

python -c "import sys; sys.exit(0 if sys.version_info >= (3, 8) else 1)" >nul 2>nul
if errorlevel 1 goto pythonTooOld

echo.
echo   正在启动本地服务器 (Python) ...
echo   地址: http://localhost:%PORT%
echo   关闭本窗口即停止服务。
start "" "http://localhost:%PORT%"
python -m http.server %PORT%
goto end

:pythonTooOld
echo.
echo   [错误] 检测到的 Python 版本低于 3.8，无法用于本地服务器。
echo   原因: Python 3.7 在中文主机名下启动服务会触发 UnicodeDecodeError。
echo   解决办法: 安装 Node.js  https://nodejs.org/  或升级 Python 到 3.8 以上。
echo.
pause
exit /b 1

:noRuntime
echo.
echo   [错误] 既没有找到 Node.js，也没有找到 Python。
echo   请安装其一后重试: https://nodejs.org/
echo.
pause
exit /b 1

:end
