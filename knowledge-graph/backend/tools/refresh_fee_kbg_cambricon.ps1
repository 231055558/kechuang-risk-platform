param(
    [string]$RunId = "cambricon_fee_kbg_$(Get-Date -Format 'yyyyMMdd_HHmmss')",
    [string]$Python = "",
    [switch]$SkipNeo4j
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
if (-not $Python) {
    $Python = (Get-Command python -ErrorAction Stop).Source
}
if (-not (Test-Path -LiteralPath $Python)) {
    throw "找不到 Python：$Python"
}

& $Python (Join-Path $ProjectRoot 'tools\run_fee_kbg_pilot.py') --run-id $RunId --stock-code 688256
if ($LASTEXITCODE -ne 0) { throw '寒武纪 FEE-KBG 构建失败。' }
& $Python (Join-Path $ProjectRoot 'tools\verify_fee_kbg_pilot.py') --run-id $RunId
if ($LASTEXITCODE -ne 0) { throw '寒武纪 FEE-KBG 校验失败。' }

if (-not $SkipNeo4j) {
    if (-not $env:NEO4J_PASSWORD) {
        throw '缺少 NEO4J_PASSWORD；可使用 -SkipNeo4j 只构建并校验 SQLite 快照。'
    }
    & $Python (Join-Path $ProjectRoot 'tools\sync_neo4j_graph.py') --run-id $RunId --mark-not-in-snapshot --replace-relation-types
    if ($LASTEXITCODE -ne 0) { throw 'Neo4j 同步失败。' }
}

Write-Output "完成：$RunId"
