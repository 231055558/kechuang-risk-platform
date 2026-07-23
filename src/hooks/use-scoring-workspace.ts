import { useCallback, useRef, useState } from "react"

import {
  createInitialScoringWorkspace,
  deleteWorkspaceObservation,
  loadScoringWorkspace,
  saveScoringWorkspace,
  upsertWorkspaceObservation,
} from "@/lib/scoring-workspace"
import type {
  EvidenceScoringBinding,
  IndicatorObservation,
  ScoringWorkspaceState,
} from "@/types/risk"

const EMPTY_OBSERVATIONS: IndicatorObservation[] = []
const EMPTY_BINDINGS: EvidenceScoringBinding[] = []

export function useScoringWorkspace(
  initialObservations: IndicatorObservation[] = EMPTY_OBSERVATIONS,
  initialBindings: EvidenceScoringBinding[] = EMPTY_BINDINGS
) {
  const [initialization] = useState(() => {
    const template = createInitialScoringWorkspace(
      initialObservations,
      initialBindings
    )
    return {
      template,
      loaded: loadScoringWorkspace(template),
    }
  })
  const { loaded, template } = initialization
  const [workspace, setWorkspace] = useState<ScoringWorkspaceState>(
    loaded.state
  )
  const workspaceRef = useRef(workspace)
  const [storageWarning, setStorageWarning] = useState(loaded.warning)

  const commit = useCallback(
    (transform: (current: ScoringWorkspaceState) => ScoringWorkspaceState) => {
      const next = transform(workspaceRef.current)
      workspaceRef.current = next
      setWorkspace(next)
      const saved = saveScoringWorkspace(next)
      setStorageWarning(
        saved
          ? ""
          : "评分修改已在当前页面生效，但浏览器无法写入本地存储；刷新后可能丢失。"
      )
      return saved
    },
    []
  )

  const saveObservation = useCallback(
    (
      observation: IndicatorObservation,
      evidenceBindings: EvidenceScoringBinding[]
    ) =>
      commit((current) =>
        upsertWorkspaceObservation(current, observation, evidenceBindings)
      ),
    [commit]
  )

  const deleteObservation = useCallback(
    (observationId: string) =>
      commit((current) => deleteWorkspaceObservation(current, observationId)),
    [commit]
  )

  const setDefaultReviewer = useCallback(
    (defaultReviewer: string) =>
      commit((current) => ({
        ...current,
        defaultReviewer,
        updatedAt: new Date().toISOString(),
      })),
    [commit]
  )

  const resetWorkspace = useCallback(() => {
    const next = createInitialScoringWorkspace(
      template.observations,
      template.evidenceBindings
    )
    workspaceRef.current = next
    setWorkspace(next)
    const saved = saveScoringWorkspace(next)
    setStorageWarning(
      saved ? "" : "初始评分数据已在当前页面恢复，但浏览器无法写入本地存储。"
    )
    return saved
  }, [template])

  return {
    workspace,
    storageWarning,
    saveObservation,
    deleteObservation,
    setDefaultReviewer,
    resetWorkspace,
  }
}
