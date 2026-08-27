param(
    [switch]$Apply,
    [string]$Python = ""
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = (Resolve-Path -LiteralPath (Split-Path -Parent $PSScriptRoot)).Path
$DataRoot = (Resolve-Path -LiteralPath (Join-Path $ProjectRoot 'data')).Path
$MainDb = (Resolve-Path -LiteralPath (Join-Path $DataRoot 'risk_data.sqlite')).Path
$Prefix = $ProjectRoot + [IO.Path]::DirectorySeparatorChar

if (-not $Python) {
    $Python = (Get-Command python -ErrorAction Stop).Source
}

& $Python (Join-Path $PSScriptRoot 'verify_single_master_db.py') --db $MainDb
if ($LASTEXITCODE -ne 0) {
    throw 'Master database verification failed. Refusing cleanup.'
}

$Databases = @(
    Get-ChildItem -LiteralPath $ProjectRoot -Recurse -File -ErrorAction Stop |
        Where-Object {
            $_.Extension -in @('.sqlite', '.sqlite3', '.db') -and
            $_.FullName -ne $MainDb
        }
)

foreach ($Database in $Databases) {
    $Resolved = (Resolve-Path -LiteralPath $Database.FullName).Path
    if (-not $Resolved.StartsWith($Prefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Database outside project root detected: $Resolved"
    }
    if ($Resolved -eq $MainDb) {
        throw 'Main database entered the deletion list. Refusing cleanup.'
    }
}

$TotalBytes = ($Databases | Measure-Object Length -Sum).Sum
foreach ($Database in ($Databases | Sort-Object Length -Descending)) {
    Write-Output ("{0} | {1:N3} GB | {2:yyyy-MM-dd HH:mm:ss}" -f $Database.FullName, ($Database.Length / 1GB), $Database.LastWriteTime)
}

Write-Output ("Secondary databases: {0}; total size: {1:N3} GB" -f $Databases.Count, ($TotalBytes / 1GB))

if (-not $Apply) {
    Write-Output 'Preview only. Re-run with -Apply to delete the listed databases.'
    exit 0
}

foreach ($Database in $Databases) {
    Remove-Item -LiteralPath $Database.FullName -Force
}

$EmptyCandidates = @(
    (Join-Path $DataRoot 'backups'),
    (Join-Path $DataRoot 'migration_backup_20260827'),
    (Join-Path $DataRoot 'data')
)
foreach ($Directory in $EmptyCandidates) {
    if (-not (Test-Path -LiteralPath $Directory)) {
        continue
    }
    $Resolved = (Resolve-Path -LiteralPath $Directory).Path
    if (-not $Resolved.StartsWith($DataRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Directory outside data root detected: $Resolved"
    }
    if (-not (Get-ChildItem -LiteralPath $Resolved -Force)) {
        Remove-Item -LiteralPath $Resolved -Force
    }
}

$Remaining = @(
    Get-ChildItem -LiteralPath $ProjectRoot -Recurse -File |
        Where-Object {
            $_.Extension -in @('.sqlite', '.sqlite3', '.db') -and
            $_.FullName -ne $MainDb
        }
)
if ($Remaining.Count) {
    throw "$($Remaining.Count) secondary databases remain after cleanup."
}

Write-Output ("Cleanup complete: deleted {0} databases, freed about {1:N3} GB, kept {2}" -f $Databases.Count, ($TotalBytes / 1GB), $MainDb)
