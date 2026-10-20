@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title Asador La Brasa - iniciando

echo ============================================
echo   Asador La Brasa - iniciar todo el sistema
echo ============================================
echo.

rem --- 1. Node.js -----------------------------------------------------------
where node >nul 2>&1
if errorlevel 1 (
  echo [X] No se encontro Node.js. Instalalo desde https://nodejs.org ^(version 22 o superior^).
  goto :fin
)

rem --- 2. Dependencias (solo la primera vez) --------------------------------
if not exist "node_modules" (
  echo [1/5] Instalando dependencias ^(la primera vez tarda unos minutos^)...
  call npm install --no-audit --no-fund
  if errorlevel 1 goto :error
) else (
  echo [1/5] Dependencias listas.
)

rem --- 3. Archivos .env (crea los que falten, sin tocar los existentes) -----
echo [2/5] Revisando la configuracion ^(.env^)...
call node scripts\setup.mjs >nul
if errorlevel 1 goto :error

rem --- 4. Docker + PostgreSQL ------------------------------------------------
echo [3/5] Revisando Docker...
docker info >nul 2>&1
if errorlevel 1 (
  if not exist "C:\Program Files\Docker\Docker\Docker Desktop.exe" (
    echo [X] No se encontro Docker Desktop. Instalalo y vuelve a ejecutar este archivo.
    goto :fin
  )
  echo       Docker esta apagado, abriendolo ^(puede tardar 1-2 minutos^)...
  start "" "C:\Program Files\Docker\Docker\Docker Desktop.exe"
  set /a intentos=0
  goto :esperar_docker
)
goto :docker_listo

:esperar_docker
docker info >nul 2>&1
if not errorlevel 1 goto :docker_listo
set /a intentos+=1
if %intentos% GEQ 60 (
  echo [X] Docker no arranco a tiempo. Abrelo manualmente y vuelve a ejecutar este archivo.
  goto :fin
)
ping -n 4 127.0.0.1 >nul
goto :esperar_docker

:docker_listo
echo       Levantando PostgreSQL...
call docker compose up -d --wait postgres
if errorlevel 1 goto :error

rem --- 5. Prisma (solo si es la primera vez o si se pide: iniciar.bat --db) ---
set "HACER_DB="
if not exist "services\payroll\src\generated" set "HACER_DB=1"
if not exist "services\attendance\src\generated" set "HACER_DB=1"
if /i "%~1"=="--db" set "HACER_DB=1"
if defined HACER_DB (
  echo [4/5] Preparando la base de datos ^(Prisma^)...
  call npm run prisma:generate >nul
  if errorlevel 1 goto :error
  call npm run db:push >nul
  if errorlevel 1 goto :error
) else (
  echo [4/5] Base de datos ya preparada. ^(Si cambiaste los modelos: iniciar.bat --db^)
)

rem --- 5b. Motor de nomina externo (repo SistemaNomina, sin modificar) -----------
if not exist "integraciones\SistemaNomina\payroll-service\node_modules" (
  echo [4b/5] Preparando el motor de nomina externo ^(SistemaNomina^)...
  call node scripts\nomina-externo-setup.mjs
  if errorlevel 1 echo       No se pudo preparar el motor de nomina: el resto arranca, pero la Nomina no podra calcular.
)

rem --- 6. Arranque escalonado -------------------------------------------------
echo [5/5] Arrancando servicios uno por uno ^(evita saturar la memoria^)...
echo.
echo       Cuando diga "Todo arriba" se abre el navegador solo.
echo       Para detener todo: Ctrl+C o cierra esta ventana.
echo       Datos de demostracion ^(solo la primera vez^): ejecuta cargar-datos.bat
echo.
start "" /min cmd /c "for /l %%i in (1,1,150) do (curl -s -o nul http://localhost:5173 && (start http://localhost:5173 & exit) || ping -n 3 127.0.0.1 >nul)"
title Asador La Brasa - en ejecucion
call npm start
goto :fin

:error
echo.
echo [X] Algo fallo en el paso anterior. Revisa el mensaje de arriba.

:fin
echo.
pause
endlocal
