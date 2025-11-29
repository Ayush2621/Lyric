@echo off
echo =================================================
echo   Aggressively cleaning all .mp3 filenames...
echo   Folder: %~dp0
echo =================================================
echo.

REM Run PowerShell script inline (no external .ps1 file needed)
powershell -NoLogo -NoProfile -ExecutionPolicy Bypass ^
  -Command "Set-Location -LiteralPath '%~dp0'; $files = Get-ChildItem -LiteralPath . -Filter *.mp3; if(-not $files){ Write-Host 'No .mp3 files found in this folder.'; exit }; $used=@{}; foreach($f in $files){ $oldPath = $f.FullName; $ext = $f.Extension; $base = [System.IO.Path]::GetFileNameWithoutExtension($f.Name); $new = $base; $new = $new -replace '\([^)]*\)',''; $new = $new -replace '\[[^\]]*\]',''; $junk = @('full video song','full video','official video song','official music video','official video','video song','audio song','lyrics video','lyrical video','128kbit_aac','128kbit aac','t-series','t series','full hd','4k video','hdr video','remix'); foreach($j in $junk){ $pattern = [regex]::Escape($j); $new = [regex]::Replace($new,$pattern,'','IgnoreCase') }; $new = $new -replace '\b(video|song|music|official)\b',''; $new = $new -replace '[\|\x00A6\-\+_=~<>$#@!`]', ' '; $new = $new -replace '\s{2,}',' '; $new = $new.Trim(' .-'); if([string]::IsNullOrWhiteSpace($new)){ $new = $base }; $new = ($new.ToLower().Split(' ') | Where-Object {$_} | ForEach-Object { $_.Substring(0,1).ToUpper() + $_.Substring(1) }) -join ' '; $words = $new.Split(' ') | Where-Object {$_}; if($words.Count -gt 3){ $new = ($words[0..2] -join ' ') } else { $new = ($words -join ' ') }; if($new.Length -gt 30){ $new = $new.Substring(0,30).Trim() }; $candidate = $new + $ext; $key = $candidate.ToLower(); $counter = 2; while((Test-Path -LiteralPath $candidate) -or $used.ContainsKey($key)){ $candidate = $new + ' ' + $counter + $ext; $key = $candidate.ToLower(); $counter++ }; $used[$key] = $true; if($f.Name -ne $candidate){ Write-Host ('RENAME: ' + $f.Name + '  -->  ' + $candidate); Rename-Item -LiteralPath $oldPath -NewName $candidate -Force } else { Write-Host ('SKIP (already clean): ' + $f.Name) } }"

echo.
echo ================================
echo   Done. Check names above.
echo ================================
pause
