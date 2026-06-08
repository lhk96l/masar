@echo off
REM MASAR — نسخة احتياطية يومية مجدولة لقاعدة D1
cd /d C:\Users\IT\masar
call npm run db:backup >> C:\Users\IT\masar\backups\backup-log.txt 2>&1
