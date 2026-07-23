import { useCallback, useRef, useState } from "react"

import {
  clearTechnologyScoringCompany,
  createInitialTechnologyScoringWorkspace,
  loadTechnologyScoringWorkspace,
  resetTechnologyScoringWorkspace,
  saveTechnologyScoringWorkspace,
  upsertTechnologyScoringCompany,
  type TechnologyScoringCompanyPatch,
} from "@/lib/technology-scoring-workspace"
import type { TechnologyScoringWorkspaceState } from "@/types/risk"

export function useTechnologyScoringWorkspace() {
  const [loaded] = useState(() =>
    loadTechnologyScoringWorkspace(createInitialTechnologyScoringWorkspace())
  )
  const [workspace, setWorkspace] = useState<TechnologyScoringWorkspaceState>(
    loaded.state
  )
  const workspaceRef = useRef(workspace)
  const [storageWarning, setStorageWarning] = useState(loaded.warning)

  const commit = useCallback(
    (
      transform: (
        current: TechnologyScoringWorkspaceState
      ) => TechnologyScoringWorkspaceState,
      failureMessage: string
    ) => {
      const next = transform(workspaceRef.current)
      workspaceRef.current = next
      setWorkspace(next)
      const saved = saveTechnologyScoringWorkspace(next)
      setStorageWarning(saved ? "" : failureMessage)
      return saved
    },
    []
  )

  const upsertCompany = useCallback(
    (companyId: string, patch: TechnologyScoringCompanyPatch) =>
      commit(
        (current) => upsertTechnologyScoringCompany(current, companyId, patch),
        "技术风险评分修改已在当前页面生效，但浏览器无法写入本地存储；刷新后可能丢失。"
      ),
    [commit]
  )

  const clearCompany = useCallback(
    (companyId: string) =>
      commit(
        (current) => clearTechnologyScoringCompany(current, companyId),
        "企业技术风险评分已在当前页面清除，但浏览器无法写入本地存储；刷新后可能恢复。"
      ),
    [commit]
  )

  const resetWorkspace = useCallback(() => {
    const next = resetTechnologyScoringWorkspace()
    workspaceRef.current = next
    setWorkspace(next)
    const saved = saveTechnologyScoringWorkspace(next)
    setStorageWarning(
      saved
        ? ""
        : "技术风险评分工作区已在当前页面重置，但浏览器无法写入本地存储。"
    )
    return saved
  }, [])

  return {
    workspace,
    storageWarning,
    upsertCompany,
    clearCompany,
    resetWorkspace,
  }
}
