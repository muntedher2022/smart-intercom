# Smart Intercom System Launcher
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "   Smart Intercom System Launcher" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Function to start a process in background
function Start-BackgroundProcess {
    param([string]$command, [string]$workingDir)
    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = "cmd.exe"
    $startInfo.Arguments = "/k $command"
    $startInfo.WorkingDirectory = $workingDir
    $startInfo.UseShellExecute = $true
    $startInfo.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Normal
    [System.Diagnostics.Process]::Start($startInfo) | Out-Null
}

Write-Host "Starting Backend Server..." -ForegroundColor Green
Start-BackgroundProcess "npm start" "$PSScriptRoot\backend"

Write-Host "Waiting 3 seconds for backend to initialize..." -ForegroundColor Gray
Start-Sleep -Seconds 3

Write-Host "Starting Frontend Server..." -ForegroundColor Green
Start-BackgroundProcess "npm run dev" "$PSScriptRoot\frontend"

Write-Host ""
Write-Host "Both servers are starting..." -ForegroundColor Yellow
Write-Host ""
Write-Host "Backend: http://192.168.100.9:3000" -ForegroundColor Blue
Write-Host "Frontend: http://192.168.100.9:5173" -ForegroundColor Blue
Write-Host ""
Write-Host "Press Enter to exit..." -ForegroundColor Gray
Read-Host