param(
    [string]$RunId = "risk_graph_$(Get-Date -Format 'yyyyMMdd_HHmmss')",
    [string]$Workbook = "",
    [switch]$SkipWorkbookImport,
    [string]$Python = ""
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
if (-not $Python) {
    $Python = (Get-Command python -ErrorAction Stop).Source
}
if (-not (Test-Path -LiteralPath $Python)) {
    throw "找不到 Python：$Python"
}
if (-not $env:NEO4J_PASSWORD) {
    throw '请先设置 Neo4j 密码，例如：$env:NEO4J_PASSWORD = "你的密码"'
}
if (-not $SkipWorkbookImport) {
    if (-not $Workbook) {
        $Workbook = Join-Path $ProjectRoot 'data\科创板数字芯片设计企业风险指标数据库_37家_核对版_20260819.xlsx'
    }
    & $Python (Join-Path $ProjectRoot 'tools\import_chip_risk_workbook.py') --workbook $Workbook --run-id "$RunId`_workbook"
    if ($LASTEXITCODE -ne 0) { throw 'Excel 导入失败。' }
}
& $Python (Join-Path $ProjectRoot 'tools\run_knowledge_graph_agent.py') --run-id $RunId
if ($LASTEXITCODE -ne 0) { throw '图谱快照构建失败。' }
& $Python (Join-Path $ProjectRoot 'tools\sync_neo4j_graph.py') --run-id $RunId --mark-not-in-snapshot --replace-relation-types
if ($LASTEXITCODE -ne 0) { throw 'Neo4j 同步失败。' }
Write-Output "完成：$RunId"
