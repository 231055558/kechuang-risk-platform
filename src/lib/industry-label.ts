export function displayIndustryLabel(label?: string | null) {
  if (!label) return "同业基准"

  return (
    label
      .replace(/\s*[（(][^（）()]*[）)]/gu, "")
      .replace(/\s*[·•]\s*\d+\s*家(?:样本|基准)?\s*$/u, "")
      .trim() || "同业基准"
  )
}
