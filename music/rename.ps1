# rename_songs.ps1
# Run via rename_songs.bat

$files = Get-ChildItem -LiteralPath . -Filter *.mp3

if (-not $files) {
    Write-Host "No .mp3 files found in this folder."
    exit
}

Write-Host "Found $($files.Count) mp3 files.`n"

$usedNames = @{}

foreach ($f in $files) {
    $oldPath = $f.FullName
    $ext     = $f.Extension
    $base    = [System.IO.Path]::GetFileNameWithoutExtension($f.Name)

    # Start from original base name
    $new = $base

    # Remove ( ... ) and [ ... ]
    $new = $new -replace '\([^)]*\)', ''
    $new = $new -replace '\[[^\]]*\]', ''

    # Remove common junk phrases (case-insensitive)
    $junk = @(
        'full video song',
        'full video',
        'official video song',
        'official music video',
        'official video',
        'video song',
        'audio song',
        'lyrics video',
        'lyrical video',
        '128kbit_aac',
        '128kbit aac',
        't-series',
        't series',
        'full hd',
        '4k video',
        'hdr video',
        'remix'
    )

    foreach ($j in $junk) {
        $pattern = [regex]::Escape($j)
        $new = [regex]::Replace($new, $pattern, '', 'IgnoreCase')
    }

    # Remove words like "video", "song", "music" if still alone
    $new = $new -replace '\b(video|song|music|official)\b', ''

    # Replace weird symbols with space
    $new = $new -replace '[\|\x00A6\-\+_=~<>%$#@!`]', ' '

    # Collapse multiple spaces
    $new = $new -replace '\s{2,}', ' '

    # Trim leading/trailing spaces, dots, dashes
    $new = $new.Trim(" .-")

    if ([string]::IsNullOrWhiteSpace($new)) {
        $new = $base
    }

    # Title case (Gallan Goodiyaan)
    $new = ($new.ToLower().Split(' ') | Where-Object { $_ } |
        ForEach-Object { $_.Substring(0,1).ToUpper() + $_.Substring(1) }) -join ' '

    # Ensure unique final name
    $candidate = "$new$ext"
    $key = $candidate.ToLower()

    $counter = 2
    while (Test-Path -LiteralPath $candidate -or $usedNames.ContainsKey($key)) {
        $candidate = "$new $counter$ext"
        $key = $candidate.ToLower()
        $counter++
    }

    $usedNames[$key] = $true

    if ($f.Name -eq $candidate) {
        Write-Host "SKIP (already clean): $($f.Name)"
        continue
    }

    Write-Host "RENAME: $($f.Name)  -->  $candidate"

    try {
        Rename-Item -LiteralPath $oldPath -NewName $candidate -Force
    } catch {
        Write-Host "  ERROR renaming $($f.Name): $($_.Exception.Message)" -ForegroundColor Red
    }
}

Write-Host "`nDone renaming files."
