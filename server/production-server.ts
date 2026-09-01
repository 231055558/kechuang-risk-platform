import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { calculateTechnologyBaseline } from "../src/lib/technology-baseline-engine.ts"
import { calculateTechnologyRisk } from "../src/lib/technology-risk-engine.ts"
import { createProductionServer } from "./http-server.ts"
import {
  getIndustryRiskAssessment,
  getIndustryRiskKnowledgeGraph,
  listIndustryRiskCompanies,
} from "./industry-risk-service.ts"
import { createIndustryRiskAiGuidanceService } from "./industry-risk-ai-guidance-service.ts"
import {
  getKcrCompanyAssessment,
  scoreKcrAssessment,
} from "./kcr-assessment-service.ts"
import { getRiskGraph, listRiskGraphCompanies } from "./risk-graph-service.ts"
import {
  getNarrativeAnnualAudit,
  getNarrativeAnnualMethodology,
  getNarrativeAnnualTrends,
  getNarrativeIndustryTrends,
  getNarrativeRiskAuditSummary,
  getNarrativeRiskCompany,
  listNarrativeRiskCompanies,
  listNarrativeRiskSources,
} from "./narrative-risk-service.ts"
import { createRiskGraphPostgresService } from "./risk-graph-postgres-service.ts"

function readPort(value: string | undefined) {
  const port = Number(value ?? "5000")
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new TypeError("PORT must be an integer between 1 and 65535")
  }
  return port
}

const host = process.env.HOST ?? "127.0.0.1"
const port = readPort(process.env.PORT)
const staticRoot =
  process.env.STATIC_ROOT ??
  resolve(fileURLToPath(new URL("..", import.meta.url)))
const basePath = process.env.BASE_PATH ?? ""
const riskGraphPostgresService = createRiskGraphPostgresService()
const generateIndustryRiskAiGuidance = createIndustryRiskAiGuidanceService()

const server = createProductionServer({
  staticRoot,
  basePath,
  calculateTechnologyRisk,
  calculateTechnologyBaseline,
  calculateKcrAssessment: scoreKcrAssessment,
  getKcrAssessment: getKcrCompanyAssessment,
  listIndustryRiskCompanies,
  getIndustryRiskAssessment,
  generateIndustryRiskAiGuidance,
  getIndustryRiskGraph: getIndustryRiskKnowledgeGraph,
  listRiskGraphCompanies,
  getRiskGraph,
  listNarrativeRiskCompanies,
  getNarrativeRiskCompany,
  listNarrativeRiskSources,
  getNarrativeRiskAuditSummary,
  getNarrativeAnnualTrends,
  getNarrativeAnnualMethodology,
  getNarrativeAnnualAudit,
  getNarrativeIndustryTrends,
  graphWorkspaceOrigin: process.env.GRAPH_API_ORIGIN,
  getRiskGraphHealth: riskGraphPostgresService.health,
  listRiskGraphPostgresCompanies: riskGraphPostgresService.companies,
  getRiskGraphSnapshot: riskGraphPostgresService.snapshot,
})

server.listen(port, host, () => {
  console.log(`Risk platform server listening on http://${host}:${port}`)
})

function shutdown(signal: string) {
  console.log(`Received ${signal}; closing production server`)
  server.close((error) => {
    if (error) {
      console.error("Failed to close production server", error)
      process.exitCode = 1
    }
    void riskGraphPostgresService.close().catch((closeError: unknown) => {
      console.error("Failed to close risk graph PostgreSQL pool", closeError)
      process.exitCode = 1
    })
  })
}

process.on("SIGINT", () => shutdown("SIGINT"))
process.on("SIGTERM", () => shutdown("SIGTERM"))
