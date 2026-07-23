import type {
  TechnologyBaselineQuantificationRequest,
  TechnologyBaselineQuantificationResult,
} from "@/types/risk"
import { isTechnologyBaselineQuantificationResult } from "./technology-baseline-validation.ts"

export const TECHNOLOGY_BASELINE_QUANTIFY_API_PATH =
  "api/v1/technology-risk/baseline-quantify"

type TechnologyBaselineApiOptions = {
  signal?: AbortSignal
  fetch?: typeof fetch
}

type ApiErrorPayload = {
  error?: {
    code?: unknown
    message?: unknown
  }
}

export class TechnologyBaselineApiError extends Error {
  readonly status: number
  readonly code: string
  readonly details: unknown

  constructor(
    message: string,
    options: {
      status: number
      code: string
      details?: unknown
    }
  ) {
    super(message)
    this.name = "TechnologyBaselineApiError"
    this.status = options.status
    this.code = options.code
    this.details = options.details
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function parseJson(source: string) {
  if (!source.trim()) {
    return null
  }

  try {
    return JSON.parse(source) as unknown
  } catch {
    return null
  }
}

function getApiError(payload: unknown) {
  if (!isRecord(payload)) {
    return null
  }
  const error = (payload as ApiErrorPayload).error
  if (!isRecord(error)) {
    return null
  }

  return {
    code:
      typeof error.code === "string" && error.code.trim()
        ? error.code
        : "TECHNOLOGY_BASELINE_REQUEST_FAILED",
    message:
      typeof error.message === "string" && error.message.trim()
        ? error.message
        : null,
  }
}

export async function quantifyTechnologyBaseline(
  request: TechnologyBaselineQuantificationRequest,
  options: TechnologyBaselineApiOptions = {}
): Promise<TechnologyBaselineQuantificationResult> {
  const fetchImpl = options.fetch ?? globalThis.fetch
  const response = await fetchImpl(TECHNOLOGY_BASELINE_QUANTIFY_API_PATH, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify(request),
    signal: options.signal,
  })
  const payload = parseJson(await response.text())

  if (!response.ok) {
    const apiError = getApiError(payload)
    throw new TechnologyBaselineApiError(
      apiError?.message ?? `技术基础量化请求失败（HTTP ${response.status}）。`,
      {
        status: response.status,
        code: apiError?.code ?? "TECHNOLOGY_BASELINE_REQUEST_FAILED",
        details: payload,
      }
    )
  }

  if (!isTechnologyBaselineQuantificationResult(payload)) {
    throw new TechnologyBaselineApiError(
      "技术基础量化接口返回了无效数据。",
      {
        status: response.status,
        code: "TECHNOLOGY_BASELINE_RESPONSE_INVALID",
        details: payload,
      }
    )
  }

  return payload
}
