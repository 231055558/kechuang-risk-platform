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

$Verification = @'
import sqlite3, sys
p = sys.argv[1]
c = sqlite3.connect("file:" + p.replace("\\", "/") + "?mode=ro", uri=True)
integrity = c.execute("PRAGMA integrity_check").fetchone()[0]
foreign_keys = c.execute("PRAGMA foreign_key_check").fetchall()
migration = c.execute(
    "SELECT COUNT(*) FROM unified_database_migrations WHERE migration_id=?",
    ("single-master-sqlite-20260827-v1",),
).fetchone()[0]
c.close()
if integrity != "ok" or foreign_keys or migration != 1:
    raise SystemExit(
        f"master verification failed: integrity={integrity}, "
        f"foreign_keys={len(foreign_keys)}, migration={migration}"
    )
print("MASTER_VERIFIED")
'@

& $Python -c $Verification $MainDb
if ($LASTEXITCODE -ne 0) {
    throw '主数据库验证失败，拒绝删除其他数据库。'
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
        throw "发现项目目录外数据库，拒绝继续：$Resolved"
    }
    if ($Resolved -eq $MainDb) {
        throw '主数据库错误地进入删除清单，拒绝继续。'
    }
}

$TotalBytes = ($Databases | Measure-Object Length -Sum).Sum
foreach ($Database in ($Databases | Sort-Object Length -Descending)) {
    Write-Output ("{0} | {1:N3} GB | {2:yyyy-MM-dd HH:mm:ss}" -f $Database.FullName, ($Database.Length / 1GB), $Database.LastWriteTime)
}

Write-Output ("待删除数据库：{0} 个，共 {1:N3} GB" -f $Databases.Count, ($TotalBytes / 1GB))

if (-not $Apply) {
    Write-Output '当前为预览模式；确认后使用 -Apply 执行删除。'
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
        throw "拒绝删除数据目录外路径：$Resolved"
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
    throw "清理后仍存在 $($Remaining.Count) 个辅助数据库。"
}

Write-Output ("清理完成：删除 {0} 个数据库，释放约 {1:N3} GB；保留 {2}" -f $Databases.Count, ($TotalBytes / 1GB), $MainDb)
