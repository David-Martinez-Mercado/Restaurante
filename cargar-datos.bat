@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Asador La Brasa - cargar datos de demostracion
echo Cargando menu, mesas, cuentas de demostracion, un pedido en linea y una reservacion...
echo ^(el sistema debe estar corriendo: primero ejecuta iniciar.bat^)
echo.
call npm run seed
echo.
pause
