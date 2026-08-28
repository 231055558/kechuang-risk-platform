param(
    [Parameter(Mandatory = $true)][string]$Database,
    [Parameter(Mandatory = $true)][string]$User,
    [Parameter(Mandatory = $true)][string]$HostName,
    [Parameter(Mandatory = $true)][int]$Port,
    [string]$InputPath = "private\risk-graph-payloads-20260828.json",
    [switch]$RequireSsl
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$ResolvedInput = (Resolve-Path -LiteralPath (Join-Path $ProjectRoot $InputPath)).Path
$SecurePassword = Read-Host "PostgreSQL 密码" -AsSecureString
$PlainPassword = [System.Net.NetworkCredential]::new("", $SecurePassword).Password

try {
    $env:RISK_GRAPH_PGHOST = $HostName
    $env:RISK_GRAPH_PGPORT = [string]$Port
    $env:RISK_GRAPH_PGDATABASE = $Database
    $env:RISK_GRAPH_PGUSER = $User
    $env:RISK_GRAPH_PGPASSWORD = $PlainPassword
    $env:RISK_GRAPH_PGSSLMODE = if ($RequireSsl) { "require" } else { "" }
    Set-Location -LiteralPath $ProjectRoot
    npm run import:risk-graph-postgres -- $ResolvedInput
    if ($LASTEXITCODE -ne 0) { throw "PostgreSQL 图谱迁移失败。" }
} finally {
    Remove-Item Env:RISK_GRAPH_PGPASSWORD -ErrorAction SilentlyContinue
    $PlainPassword = $null
    $SecurePassword = $null
}
