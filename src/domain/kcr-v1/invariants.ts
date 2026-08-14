import {
  KCR_DATA_SCHEMA_VERSION,
  KCR_DIMENSION_WEIGHTS,
  KCR_METHOD_VERSION,
  KCR_NARRATIVE_INDICATOR_IDS,
  KCR_RISK_DIMENSION_IDS,
  KCR_WEIGHTED_INDICATOR_IDS,
  type KcrDataset,
  type KcrEntityId,
  type KcrEvidenceBinding,
  type KcrIndicator,
  type KcrRiskDimensionId,
} from "./model.ts"

export interface KcrDataIssue {
  code: string
  path: string
  message: string
}

function isScore(value: number | null) {
  return (
    value === null || (Number.isFinite(value) && value >= 0 && value <= 100)
  )
}

function isRatio(value: number | null) {
  return value === null || (Number.isFinite(value) && value >= 0 && value <= 1)
}

function indexEntities<T extends { id: KcrEntityId }>(
  items: T[],
  collection: string,
  issues: KcrDataIssue[]
) {
  const index = new Map<KcrEntityId, T>()

  items.forEach((item, position) => {
    if (item.id.trim() === "") {
      issues.push({
        code: "EMPTY_ID",
        path: `${collection}[${position}].id`,
        message: "实体 ID 不能为空。",
      })
      return
    }
    if (index.has(item.id)) {
      issues.push({
        code: "DUPLICATE_ID",
        path: `${collection}[${position}].id`,
        message: `${collection} 中存在重复 ID：${item.id}。`,
      })
      return
    }
    index.set(item.id, item)
  })

  return index
}

function pushUnknownReference(
  issues: KcrDataIssue[],
  path: string,
  target: string,
  id: string
) {
  issues.push({
    code: "UNKNOWN_REFERENCE",
    path,
    message: `找不到引用的${target}：${id}。`,
  })
}

function expectedTarget(
  binding: KcrEvidenceBinding,
  indexes: {
    observations: Map<string, { companyId: string }>
    events: Map<string, { companyId: string }>
    relations: Map<string, { companyId: string }>
    snapshots: Map<string, { companyId: string }>
  }
) {
  return indexes[`${binding.targetType}s` as keyof typeof indexes].get(
    binding.targetId
  )
}

function validateIndicatorContract(
  indicators: KcrIndicator[],
  issues: KcrDataIssue[]
) {
  const weightedIds = new Set(KCR_WEIGHTED_INDICATOR_IDS)
  const narrativeIds = new Set(KCR_NARRATIVE_INDICATOR_IDS)
  const observedWeightedIds = new Set<string>()
  const observedNarrativeIds = new Set<string>()
  let totalWeight = 0
  const dimensionWeights = new Map<KcrRiskDimensionId, number>()

  indicators.forEach((indicator, index) => {
    if (indicator.kind === "weighted") {
      observedWeightedIds.add(indicator.id)
      totalWeight += indicator.weight
      dimensionWeights.set(
        indicator.dimensionId,
        (dimensionWeights.get(indicator.dimensionId) ?? 0) + indicator.weight
      )
      if (!weightedIds.has(indicator.id)) {
        issues.push({
          code: "UNKNOWN_WEIGHTED_INDICATOR",
          path: `indicators[${index}].id`,
          message: `加权指标 ${indicator.id} 不属于 KCR-2026.08-v1。`,
        })
      }
      if (!Number.isFinite(indicator.weight) || indicator.weight <= 0) {
        issues.push({
          code: "INVALID_WEIGHT",
          path: `indicators[${index}].weight`,
          message: "加权指标权重必须大于 0。",
        })
      }
    } else {
      observedNarrativeIds.add(indicator.id)
      if (!narrativeIds.has(indicator.id)) {
        issues.push({
          code: "UNKNOWN_NARRATIVE_INDICATOR",
          path: `indicators[${index}].id`,
          message: `叙事校验指标 ${indicator.id} 不属于 KCR-2026.08-v1。`,
        })
      }
      if (
        indicator.weight !== null ||
        indicator.dimensionId !== null ||
        indicator.affectsScore
      ) {
        issues.push({
          code: "NARRATIVE_AFFECTS_SCORE",
          path: `indicators[${index}]`,
          message: "叙事校验指标不得拥有权重、风险维度或计分资格。",
        })
      }
    }
  })

  if (
    observedWeightedIds.size !== weightedIds.size ||
    [...weightedIds].some((id) => !observedWeightedIds.has(id))
  ) {
    issues.push({
      code: "WEIGHTED_INDICATOR_SET_MISMATCH",
      path: "indicators",
      message: "加权指标集合必须完整匹配 KCR-2026.08-v1 的 18 项指标。",
    })
  }
  if (
    observedNarrativeIds.size !== narrativeIds.size ||
    [...narrativeIds].some((id) => !observedNarrativeIds.has(id))
  ) {
    issues.push({
      code: "NARRATIVE_INDICATOR_SET_MISMATCH",
      path: "indicators",
      message: "叙事校验指标集合必须完整匹配 KCR-2026.08-v1 的 4 项指标。",
    })
  }
  if (totalWeight !== 100) {
    issues.push({
      code: "WEIGHT_TOTAL_MISMATCH",
      path: "indicators",
      message: `加权指标总权重必须为 100，当前为 ${totalWeight}。`,
    })
  }
  for (const dimensionId of KCR_RISK_DIMENSION_IDS) {
    const observed = dimensionWeights.get(dimensionId) ?? 0
    const expected = KCR_DIMENSION_WEIGHTS[dimensionId]
    if (observed !== expected) {
      issues.push({
        code: "DIMENSION_WEIGHT_MISMATCH",
        path: "indicators",
        message: `${dimensionId} 维度权重应为 ${expected}，当前为 ${observed}。`,
      })
    }
  }
}

export function collectKcrDatasetIssues(dataset: KcrDataset): KcrDataIssue[] {
  const issues: KcrDataIssue[] = []

  if (dataset.schemaVersion !== KCR_DATA_SCHEMA_VERSION) {
    issues.push({
      code: "SCHEMA_VERSION_MISMATCH",
      path: "schemaVersion",
      message: `数据版本必须为 ${KCR_DATA_SCHEMA_VERSION}。`,
    })
  }
  if (dataset.methodVersion !== KCR_METHOD_VERSION) {
    issues.push({
      code: "METHOD_VERSION_MISMATCH",
      path: "methodVersion",
      message: `方法版本必须为 ${KCR_METHOD_VERSION}。`,
    })
  }

  const companies = indexEntities(dataset.companies, "companies", issues)
  const indicators = indexEntities(dataset.indicators, "indicators", issues)
  const observations = indexEntities(
    dataset.observations,
    "observations",
    issues
  )
  const evidence = indexEntities(dataset.evidence, "evidence", issues)
  const bindings = indexEntities(
    dataset.evidenceBindings,
    "evidenceBindings",
    issues
  )
  const events = indexEntities(dataset.events, "events", issues)
  const nodes = indexEntities(dataset.graphNodes, "graphNodes", issues)
  const relations = indexEntities(
    dataset.graphRelations,
    "graphRelations",
    issues
  )
  const snapshots = indexEntities(dataset.snapshots, "snapshots", issues)
  const tasks = indexEntities(dataset.actionTasks, "actionTasks", issues)
  const apiCallLogs = indexEntities(dataset.apiCallLogs, "apiCallLogs", issues)

  void bindings
  void tasks
  validateIndicatorContract(dataset.indicators, issues)

  dataset.observations.forEach((observation, index) => {
    const indicator = indicators.get(observation.indicatorId)
    if (!companies.has(observation.companyId)) {
      pushUnknownReference(
        issues,
        `observations[${index}].companyId`,
        "企业",
        observation.companyId
      )
    }
    if (!indicator) {
      pushUnknownReference(
        issues,
        `observations[${index}].indicatorId`,
        "指标",
        observation.indicatorId
      )
    }
    if (observation.snapshotId !== null) {
      const snapshot = snapshots.get(observation.snapshotId)
      if (!snapshot) {
        pushUnknownReference(
          issues,
          `observations[${index}].snapshotId`,
          "快照",
          observation.snapshotId
        )
      } else if (snapshot.companyId !== observation.companyId) {
        issues.push({
          code: "CROSS_COMPANY_OBSERVATION_SNAPSHOT",
          path: `observations[${index}].snapshotId`,
          message: "指标观测只能绑定本企业的评估快照。",
        })
      }
    }
    if (!isScore(observation.normalizedRiskScore)) {
      issues.push({
        code: "SCORE_OUT_OF_RANGE",
        path: `observations[${index}].normalizedRiskScore`,
        message: "标准化风险分必须为空或位于 0–100。",
      })
    }
    if (!isRatio(observation.confidence)) {
      issues.push({
        code: "CONFIDENCE_OUT_OF_RANGE",
        path: `observations[${index}].confidence`,
        message: "观测置信度必须为空或位于 0–1。",
      })
    }
    if (
      observation.status === "missing" &&
      (observation.rawValue !== null ||
        observation.normalizedRiskScore !== null)
    ) {
      issues.push({
        code: "MISSING_OBSERVATION_HAS_VALUE",
        path: `observations[${index}]`,
        message: "缺失观测不得使用 0 或其他值替代。",
      })
    }
    if (
      indicator?.kind === "narrative-validation" &&
      observation.normalizedRiskScore !== null
    ) {
      issues.push({
        code: "NARRATIVE_OBSERVATION_SCORED",
        path: `observations[${index}].normalizedRiskScore`,
        message: "叙事校验观测不得产生风险分。",
      })
    }
    if (
      observation.normalizedRiskScore !== null &&
      (observation.status !== "available" ||
        observation.reviewStatus !== "reviewed" ||
        observation.scoringRuleVersion === null ||
        observation.confidence === null)
    ) {
      issues.push({
        code: "SCORED_OBSERVATION_NOT_APPROVED",
        path: `observations[${index}]`,
        message: "进入评分的观测必须可用、已复核，并记录规则版本和置信度。",
      })
    }
  })

  dataset.evidence.forEach((item, index) => {
    if (!companies.has(item.companyId)) {
      pushUnknownReference(
        issues,
        `evidence[${index}].companyId`,
        "企业",
        item.companyId
      )
    }
    if (!isRatio(item.confidence)) {
      issues.push({
        code: "CONFIDENCE_OUT_OF_RANGE",
        path: `evidence[${index}].confidence`,
        message: "证据置信度必须位于 0–1。",
      })
    }
    if (item.apiCallLogId !== null) {
      const log = apiCallLogs.get(item.apiCallLogId)
      if (!log) {
        pushUnknownReference(
          issues,
          `evidence[${index}].apiCallLogId`,
          "API 调用日志",
          item.apiCallLogId
        )
      } else if (log.companyId !== item.companyId) {
        issues.push({
          code: "CROSS_COMPANY_EVIDENCE_API_LOG",
          path: `evidence[${index}].apiCallLogId`,
          message: "证据只能引用本企业的 API 调用日志。",
        })
      }
    }
  })

  const bindingIndexes = { observations, events, relations, snapshots }
  dataset.evidenceBindings.forEach((binding, index) => {
    const evidenceItem = evidence.get(binding.evidenceId)
    const target = expectedTarget(binding, bindingIndexes)
    if (!companies.has(binding.companyId)) {
      pushUnknownReference(
        issues,
        `evidenceBindings[${index}].companyId`,
        "企业",
        binding.companyId
      )
    }
    if (!evidenceItem) {
      pushUnknownReference(
        issues,
        `evidenceBindings[${index}].evidenceId`,
        "证据",
        binding.evidenceId
      )
    }
    if (!target) {
      pushUnknownReference(
        issues,
        `evidenceBindings[${index}].targetId`,
        "证据绑定目标",
        binding.targetId
      )
    }
    if (
      evidenceItem?.companyId !== binding.companyId ||
      (target && target.companyId !== binding.companyId)
    ) {
      issues.push({
        code: "CROSS_COMPANY_EVIDENCE_BINDING",
        path: `evidenceBindings[${index}]`,
        message: "证据、绑定目标与绑定记录必须属于同一企业。",
      })
    }
    if (
      binding.supportStrength === "inferred" &&
      !binding.inferenceBasis?.trim()
    ) {
      issues.push({
        code: "INFERENCE_BASIS_REQUIRED",
        path: `evidenceBindings[${index}].inferenceBasis`,
        message: "推断证据必须记录推断依据。",
      })
    }
  })

  dataset.observations.forEach((observation, index) => {
    if (observation.normalizedRiskScore === null) return
    const scoringBindings = dataset.evidenceBindings.filter(
      (binding) =>
        binding.targetType === "observation" &&
        binding.targetId === observation.id &&
        binding.supportStrength !== "background"
    )
    if (scoringBindings.length === 0) {
      issues.push({
        code: "SCORED_OBSERVATION_WITHOUT_EVIDENCE",
        path: `observations[${index}]`,
        message: "进入评分的观测必须绑定直接证据或有依据的推断证据。",
      })
    }
  })

  dataset.events.forEach((event, index) => {
    if (!companies.has(event.companyId)) {
      pushUnknownReference(
        issues,
        `events[${index}].companyId`,
        "企业",
        event.companyId
      )
    }
    if (new Set(event.dimensionIds).size !== event.dimensionIds.length) {
      issues.push({
        code: "DUPLICATE_DIMENSION_REFERENCE",
        path: `events[${index}].dimensionIds`,
        message: "风险事件不得重复引用同一风险维度。",
      })
    }
  })

  dataset.graphNodes.forEach((node, index) => {
    if (!companies.has(node.companyId)) {
      pushUnknownReference(
        issues,
        `graphNodes[${index}].companyId`,
        "企业",
        node.companyId
      )
    }
  })

  dataset.graphRelations.forEach((relation, index) => {
    const source = nodes.get(relation.sourceNodeId)
    const target = nodes.get(relation.targetNodeId)
    if (!source) {
      pushUnknownReference(
        issues,
        `graphRelations[${index}].sourceNodeId`,
        "关系起点",
        relation.sourceNodeId
      )
    }
    if (!target) {
      pushUnknownReference(
        issues,
        `graphRelations[${index}].targetNodeId`,
        "关系终点",
        relation.targetNodeId
      )
    }
    if (
      source?.companyId !== relation.companyId ||
      target?.companyId !== relation.companyId
    ) {
      issues.push({
        code: "CROSS_COMPANY_GRAPH_RELATION",
        path: `graphRelations[${index}]`,
        message: "关系与两端节点必须处于同一企业快照空间。",
      })
    }
    if (!isRatio(relation.strength) || !isRatio(relation.confidence)) {
      issues.push({
        code: "RELATION_RATIO_OUT_OF_RANGE",
        path: `graphRelations[${index}]`,
        message: "关系强度和置信度必须位于 0–1。",
      })
    }
    if (relation.snapshotId !== null) {
      const snapshot = snapshots.get(relation.snapshotId)
      if (!snapshot) {
        pushUnknownReference(
          issues,
          `graphRelations[${index}].snapshotId`,
          "快照",
          relation.snapshotId
        )
      } else if (snapshot.companyId !== relation.companyId) {
        issues.push({
          code: "CROSS_COMPANY_RELATION_SNAPSHOT",
          path: `graphRelations[${index}].snapshotId`,
          message: "图关系只能绑定本企业的评估快照。",
        })
      }
    }
    if (relation.classification === "inference" && relation.confidence === 1) {
      issues.push({
        code: "INFERENCE_CANNOT_BE_CERTAIN",
        path: `graphRelations[${index}].confidence`,
        message: "推断关系不得标记为 100% 置信。",
      })
    }
  })

  dataset.snapshots.forEach((snapshot, index) => {
    if (!companies.has(snapshot.companyId)) {
      pushUnknownReference(
        issues,
        `snapshots[${index}].companyId`,
        "企业",
        snapshot.companyId
      )
    }
    if (snapshot.methodVersion !== KCR_METHOD_VERSION) {
      issues.push({
        code: "SNAPSHOT_METHOD_VERSION_MISMATCH",
        path: `snapshots[${index}].methodVersion`,
        message: `快照方法版本必须为 ${KCR_METHOD_VERSION}。`,
      })
    }
    if (
      !isScore(snapshot.baselineScore) ||
      !isRatio(snapshot.evidenceCoverage) ||
      !isRatio(snapshot.confidence)
    ) {
      issues.push({
        code: "SNAPSHOT_METRIC_OUT_OF_RANGE",
        path: `snapshots[${index}]`,
        message: "快照分值必须位于 0–100，覆盖率和置信度必须位于 0–1。",
      })
    }
    if ((snapshot.baselineScore === null) !== (snapshot.riskLevel === null)) {
      issues.push({
        code: "SNAPSHOT_SCORE_LEVEL_MISMATCH",
        path: `snapshots[${index}]`,
        message: "快照风险分与风险等级必须同时存在或同时为空。",
      })
    }
    const dimensionIds = snapshot.dimensions.map(
      (dimension) => dimension.dimensionId
    )
    if (
      dimensionIds.length !== KCR_RISK_DIMENSION_IDS.length ||
      new Set(dimensionIds).size !== KCR_RISK_DIMENSION_IDS.length ||
      KCR_RISK_DIMENSION_IDS.some((id) => !dimensionIds.includes(id))
    ) {
      issues.push({
        code: "SNAPSHOT_DIMENSION_SET_MISMATCH",
        path: `snapshots[${index}].dimensions`,
        message: "每个快照必须且只能包含新版 5 个风险维度。",
      })
    }
    if (
      new Set(snapshot.observationIds).size !== snapshot.observationIds.length
    ) {
      issues.push({
        code: "DUPLICATE_SNAPSHOT_OBSERVATION",
        path: `snapshots[${index}].observationIds`,
        message: "快照不得重复引用同一个指标观测。",
      })
    }
    const snapshotObservations = [...new Set(snapshot.observationIds)]
      .map((observationId) => observations.get(observationId))
      .filter((observation) => observation !== undefined)
    const coveredWeights = new Map<KcrRiskDimensionId, number>()
    for (const observation of snapshotObservations) {
      const indicator = indicators.get(observation.indicatorId)
      if (
        indicator?.kind === "weighted" &&
        observation.normalizedRiskScore !== null
      ) {
        coveredWeights.set(
          indicator.dimensionId,
          (coveredWeights.get(indicator.dimensionId) ?? 0) + indicator.weight
        )
      }
    }
    snapshot.dimensions.forEach((dimension, dimensionIndex) => {
      const expectedCoveredWeight =
        coveredWeights.get(dimension.dimensionId) ?? 0
      const expectedCoverage =
        expectedCoveredWeight / KCR_DIMENSION_WEIGHTS[dimension.dimensionId]
      if (
        !isScore(dimension.score) ||
        !isRatio(dimension.coverage) ||
        !isRatio(dimension.confidence) ||
        dimension.coveredWeight < 0 ||
        dimension.coveredWeight > dimension.totalWeight ||
        dimension.totalWeight !== KCR_DIMENSION_WEIGHTS[dimension.dimensionId]
      ) {
        issues.push({
          code: "DIMENSION_METRIC_INVALID",
          path: `snapshots[${index}].dimensions[${dimensionIndex}]`,
          message: "维度分、权重覆盖、覆盖率或置信度不符合方法契约。",
        })
      }
      if (
        dimension.coveredWeight !== expectedCoveredWeight ||
        Math.abs(dimension.coverage - expectedCoverage) > 1e-12
      ) {
        issues.push({
          code: "DIMENSION_COVERAGE_MISMATCH",
          path: `snapshots[${index}].dimensions[${dimensionIndex}]`,
          message: "维度覆盖权重和覆盖率必须由快照内有效计分观测推导。",
        })
      }
    })
    const expectedEvidenceCoverage =
      [...coveredWeights.values()].reduce(
        (total, weight) => total + weight,
        0
      ) / 100
    if (
      Math.abs(snapshot.evidenceCoverage - expectedEvidenceCoverage) > 1e-12
    ) {
      issues.push({
        code: "SNAPSHOT_COVERAGE_MISMATCH",
        path: `snapshots[${index}].evidenceCoverage`,
        message: "快照覆盖率必须等于有效计分观测覆盖权重除以 100。",
      })
    }
    for (const observationId of snapshot.observationIds) {
      const observation = observations.get(observationId)
      if (!observation) {
        pushUnknownReference(
          issues,
          `snapshots[${index}].observationIds`,
          "指标观测",
          observationId
        )
      } else if (observation.companyId !== snapshot.companyId) {
        issues.push({
          code: "CROSS_COMPANY_SNAPSHOT_OBSERVATION",
          path: `snapshots[${index}].observationIds`,
          message: "快照不得引用其他企业的指标观测。",
        })
      }
    }
    for (const eventId of snapshot.redFlagEventIds) {
      const event = events.get(eventId)
      if (!event) {
        pushUnknownReference(
          issues,
          `snapshots[${index}].redFlagEventIds`,
          "红旗事件",
          eventId
        )
      } else if (!event.redFlag || event.companyId !== snapshot.companyId) {
        issues.push({
          code: "INVALID_RED_FLAG_REFERENCE",
          path: `snapshots[${index}].redFlagEventIds`,
          message: "快照只能引用本企业明确标记的红旗事件。",
        })
      }
    }
    const expectedMissingIds = KCR_WEIGHTED_INDICATOR_IDS.filter(
      (indicatorId) =>
        !snapshotObservations.some(
          (observation) =>
            observation.indicatorId === indicatorId &&
            observation.normalizedRiskScore !== null
        )
    )
    if (
      snapshot.missingIndicatorIds.length !== expectedMissingIds.length ||
      new Set(snapshot.missingIndicatorIds).size !==
        expectedMissingIds.length ||
      expectedMissingIds.some(
        (indicatorId) => !snapshot.missingIndicatorIds.includes(indicatorId)
      )
    ) {
      issues.push({
        code: "SNAPSHOT_MISSING_INDICATORS_MISMATCH",
        path: `snapshots[${index}].missingIndicatorIds`,
        message: "快照数据缺口必须由没有有效计分观测的加权指标推导。",
      })
    }
  })

  dataset.actionTasks.forEach((task, index) => {
    const snapshot = snapshots.get(task.snapshotId)
    const source =
      task.sourceType === "event"
        ? events.get(task.sourceId)
        : task.sourceType === "relation"
          ? relations.get(task.sourceId)
          : indicators.get(task.sourceId)
    const sourceCompanyId =
      task.sourceType === "event"
        ? events.get(task.sourceId)?.companyId
        : task.sourceType === "relation"
          ? relations.get(task.sourceId)?.companyId
          : null
    if (!companies.has(task.companyId)) {
      pushUnknownReference(
        issues,
        `actionTasks[${index}].companyId`,
        "企业",
        task.companyId
      )
    }
    if (!snapshot || snapshot.companyId !== task.companyId) {
      issues.push({
        code: "INVALID_TASK_SNAPSHOT",
        path: `actionTasks[${index}].snapshotId`,
        message: "行动任务必须绑定本企业的评估快照。",
      })
    }
    if (!source) {
      pushUnknownReference(
        issues,
        `actionTasks[${index}].sourceId`,
        "任务来源",
        task.sourceId
      )
    } else if (
      task.sourceType !== "indicator" &&
      sourceCompanyId !== task.companyId
    ) {
      issues.push({
        code: "CROSS_COMPANY_TASK_SOURCE",
        path: `actionTasks[${index}].sourceId`,
        message: "行动任务只能引用本企业的事件或关系。",
      })
    }
  })

  dataset.apiCallLogs.forEach((log, index) => {
    if (!companies.has(log.companyId)) {
      pushUnknownReference(
        issues,
        `apiCallLogs[${index}].companyId`,
        "企业",
        log.companyId
      )
    }
    if (log.snapshotId !== null) {
      const snapshot = snapshots.get(log.snapshotId)
      if (!snapshot) {
        pushUnknownReference(
          issues,
          `apiCallLogs[${index}].snapshotId`,
          "快照",
          log.snapshotId
        )
      } else if (snapshot.companyId !== log.companyId) {
        issues.push({
          code: "CROSS_COMPANY_API_LOG_SNAPSHOT",
          path: `apiCallLogs[${index}].snapshotId`,
          message: "API 调用日志只能绑定本企业的评估快照。",
        })
      }
    }
    if (!Number.isFinite(log.costCny) || log.costCny < 0) {
      issues.push({
        code: "INVALID_API_COST",
        path: `apiCallLogs[${index}].costCny`,
        message: "API 调用成本必须为非负数。",
      })
    }
  })

  return issues
}

export function assertKcrDataset(dataset: KcrDataset) {
  const issues = collectKcrDatasetIssues(dataset)
  if (issues.length > 0) {
    const error = new Error(
      `KCR 数据契约校验失败：${issues.map((issue) => `${issue.path}: ${issue.message}`).join("；")}`
    )
    Object.assign(error, { code: "KCR_DATASET_INVALID", issues })
    throw error
  }
}
