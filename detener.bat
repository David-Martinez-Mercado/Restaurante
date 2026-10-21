@echo off
chcp 65001 >nul
title Asador La Brasa - detener
echo Deteniendo los servicios del restaurante y el motor de nomina...
powershell -NoProfile -Command "$n = 0; Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -match 'start-all|--import tsx|dist[\\/]main\.js|vite[\\/]bin|nomina-externo' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; $n++ }; Write-Host ('Procesos detenidos: ' + $n)"
echo.
echo Listo. (PostgreSQL en Docker sigue encendido: para apagarlo, ejecuta  npm run db:down )
pause
