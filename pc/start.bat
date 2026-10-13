@echo off
chcp 65001 >nul
cd /d "%~dp0"
where pyw >nul 2>nul && (start "" pyw -3 geolink.py & exit /b)
where pythonw >nul 2>nul && (start "" pythonw geolink.py & exit /b)
where python >nul 2>nul && (python geolink.py & exit /b)
echo.
echo Python не найден.
echo Установите Python 3 с сайта python.org, при установке отметьте "Add python.exe to PATH",
echo затем запустите start.bat ещё раз.
echo.
pause
