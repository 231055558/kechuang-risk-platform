param(
    [string]$RunId = "semidrive_fee_kbg_$(Get-Date -Format 'yyyyMMdd_HHmmss')",
    [string]$Python = "",
    [switch]$SkipNeo4j,
    [string]$CambriconRunId = "cambricon_fee_kbg_20260826_v1"
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
if (-not $Python) {
    $Python = (Get-Command python -ErrorAction Stop).Source
}
if (-not (Test-Path -LiteralPath $Python)) {
    throw "Python was not found: $Python"
}

& $Python (Join-Path $ProjectRoot 'tools\seed_semidrive_pilot.py')
if ($LASTEXITCODE -ne 0) { throw 'SemiDrive evidence seeding failed.' }

& $Python (Join-Path $ProjectRoot 'tools\run_fee_kbg_pilot.py') `
    --run-id $RunId `
    --stock-code PRIVATE-SEMIDRIVE `
    --config (Join-Path $ProjectRoot 'config\fee_kbg_semidrive_pilot_20260827.json')
if ($LASTEXITCODE -ne 0) { throw 'SemiDrive FEE-KBG build failed.' }

& $Python (Join-Path $ProjectRoot 'tools\verify_fee_kbg_pilot.py') --run-id $RunId
if ($LASTEXITCODE -ne 0) { throw 'SemiDrive FEE-KBG verification failed.' }

if (-not $SkipNeo4j) {
    if (-not $env:NEO4J_PASSWORD) {
        throw 'NEO4J_PASSWORD is missing. Use -SkipNeo4j for a SQLite-only refresh.'
    }
    # Migrate the existing Cambricon snapshot to multi-run memberships first.
    # Shared suppliers and risk nodes can then belong to both companies.
    & $Python (Join-Path $ProjectRoot 'tools\sync_neo4j_graph.py') `
        --run-id $CambriconRunId --mark-not-in-snapshot --replace-relation-types
    if ($LASTEXITCODE -ne 0) { throw 'Cambricon multi-snapshot migration failed.' }
    & $Python (Join-Path $ProjectRoot 'tools\sync_neo4j_graph.py') `
        --run-id $RunId --mark-not-in-snapshot --replace-relation-types
    if ($LASTEXITCODE -ne 0) { throw 'SemiDrive Neo4j sync failed.' }
}

Write-Output "Completed: $RunId"

