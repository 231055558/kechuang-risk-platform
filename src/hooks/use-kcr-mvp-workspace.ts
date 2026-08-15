import { useCallback, useState } from "react"

import type { KcrActionTask } from "@/domain/kcr-v1/model.ts"
import type {
  KcrAssessmentResult,
  KcrRedFlagResult,
} from "@/domain/kcr-v1/scoring-engine.ts"
import {
  clearStoredKcrActionTasks,
  createKcrActionTaskFromRedFlag,
  readStoredKcrActionTasks,
  saveStoredKcrActionTasks,
  updateKcrActionTaskStatus,
} from "@/lib/kcr-mvp-workflow"

export function useKcrMvpWorkspace() {
  const [tasks, setTasks] = useState<KcrActionTask[]>(() =>
    readStoredKcrActionTasks()
  )

  const createTask = useCallback(
    (assessment: KcrAssessmentResult, redFlag: KcrRedFlagResult) => {
      const existing = tasks.find(
        (task) =>
          task.companyId === assessment.companyId &&
          task.snapshotId === assessment.runId &&
          task.sourceType === "event" &&
          task.sourceId === redFlag.eventId
      )
      if (existing) {
        return { task: existing, created: false, saved: true }
      }

      const task = createKcrActionTaskFromRedFlag({ assessment, redFlag })
      const nextTasks = [...tasks, task]
      const saved = saveStoredKcrActionTasks(nextTasks)
      setTasks(nextTasks)
      return { task, created: true, saved }
    },
    [tasks]
  )

  const updateTaskStatus = useCallback(
    (taskId: string, status: KcrActionTask["status"]) => {
      const nextTasks = tasks.map((task) =>
        task.id === taskId ? updateKcrActionTaskStatus(task, status) : task
      )
      const updated = nextTasks.find((task) => task.id === taskId) ?? null
      const saved = saveStoredKcrActionTasks(nextTasks)
      setTasks(nextTasks)
      return { task: updated, saved }
    },
    [tasks]
  )

  const resetTasks = useCallback(() => {
    setTasks([])
    return clearStoredKcrActionTasks()
  }, [])

  return {
    tasks,
    createTask,
    updateTaskStatus,
    resetTasks,
  }
}
