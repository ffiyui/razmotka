@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Запуск с выводом ошибок. Не закрывайте это окно, пока работаете в программе.
echo.
where py >nul 2>nul && (py -3 geolink.py) || (python geolink.py)
echo.
echo Программа завершилась. Если выше есть текст ошибки, пришлите его.
pause
