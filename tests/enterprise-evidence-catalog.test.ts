import assert from "node:assert/strict"
import test from "node:test"

import catalogData from "../src/data/industry/enterprise-evidence-catalog.json" with { type: "json" }
import {
  ENTERPRISE_EVIDENCE_CATALOG_SCHEMA_VERSION,
  assertEnterpriseEvidenceCatalog,
  collectEnterpriseEvidenceCatalogIssues,
  type EnterpriseEvidenceCatalog,
} from "../src/domain/enterprise-evidence-v1/index.ts"

const catalog = catalogData as EnterpriseEvidenceCatalog

test("student enterprise materials are represented by a sanitized metadata catalog", () => {
  assert.doesNotThrow(() => assertEnterpriseEvidenceCatalog(catalog))
  assert.equal(
    catalog.schemaVersion,
    ENTERPRISE_EVIDENCE_CATALOG_SCHEMA_VERSION
  )
  assert.equal(catalog.companyCount, 7)
  assert.equal(catalog.artifactCount, 84)
  assert.equal(catalog.workbookCount, 75)
  assert.equal(catalog.pdfCount, 8)
  assert.equal(catalog.archiveCount, 1)
  assert.equal(
    catalog.artifacts.reduce(
      (sum, artifact) => sum + (artifact.nonEmptyRowCount ?? 0),
      0
    ),
    5895
  )
})

test("public evidence metadata contains no raw names, paths, or cell values", () => {
  const serialized = JSON.stringify(catalog)
  assert.doesNotMatch(serialized, /\/mnt\/|\/home\/|file:\/\//i)
  assert.doesNotMatch(serialized, /\.xlsx|\.pdf|\.zip/i)
  assert.doesNotMatch(serialized, /iFinD|天眼查/i)
  assert.ok(
    catalog.artifacts.every(
      (artifact) =>
        artifact.redistribution === "private-metadata-only" &&
        artifact.ingestionStatus === "cataloged-not-ingested"
    )
  )
})

test("enterprise evidence validator rejects dangling company references", () => {
  const broken = structuredClone(catalog)
  broken.artifacts[0].companyId = "missing-company"
  assert.match(
    collectEnterpriseEvidenceCatalogIssues(broken).join("\n"),
    /未知企业/
  )
})
