import { CheckIcon, ChevronsUpDownIcon, SearchIcon } from "lucide-react"
import { Popover as PopoverPrimitive } from "radix-ui"
import { useDeferredValue, useMemo, useState } from "react"

import { Input } from "@/components/ui/input"
import type { CompanySummary } from "@/types/risk"

function normalizeSearchValue(value: string) {
  return value.replace(/\s+/g, "").toLocaleLowerCase("zh-CN")
}

export function CompanySearchSelect({
  companies,
  value,
  onValueChange,
}: {
  companies: CompanySummary[]
  value: string
  onValueChange: (companyId: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const deferredQuery = useDeferredValue(query)
  const activeCompany = companies.find((company) => company.id === value)
  const filteredCompanies = useMemo(() => {
    const normalizedQuery = normalizeSearchValue(deferredQuery)
    if (!normalizedQuery) return companies
    return companies.filter((company) =>
      normalizeSearchValue(
        `${company.name} ${company.fullName} ${company.stockCode}`
      ).includes(normalizedQuery)
    )
  }, [companies, deferredQuery])

  return (
    <PopoverPrimitive.Root
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (!nextOpen) setQuery("")
      }}
    >
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          className="sidebar-company-trigger company-search-trigger"
          aria-label="选择当前研究企业；支持简称、证券代码或中文全称搜索"
          aria-expanded={open}
        >
          <span>
            <strong>{activeCompany?.name ?? "选择企业"}</strong>
            <small>{activeCompany?.stockCode ?? ""}</small>
          </span>
          <ChevronsUpDownIcon aria-hidden="true" />
        </button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          className="company-search-popover"
          side="right"
          align="start"
          sideOffset={10}
          collisionPadding={12}
        >
          <div className="company-search-popover__input">
            <SearchIcon aria-hidden="true" />
            <Input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索简称 / 代码 / 中文全称"
              aria-label="搜索研究企业"
              autoComplete="off"
            />
          </div>
          <div
            className="company-search-popover__results"
            role="listbox"
            aria-label="企业搜索结果"
          >
            {filteredCompanies.length ? (
              filteredCompanies.map((company) => (
                <button
                  key={company.id}
                  type="button"
                  role="option"
                  aria-selected={company.id === value}
                  onClick={() => {
                    onValueChange(company.id)
                    setOpen(false)
                  }}
                >
                  <span>
                    <strong>{company.name}</strong>
                    <small>{company.fullName}</small>
                  </span>
                  <span>
                    <code>{company.stockCode}</code>
                    {company.id === value ? (
                      <CheckIcon aria-hidden="true" />
                    ) : null}
                  </span>
                </button>
              ))
            ) : (
              <p>没有匹配企业</p>
            )}
          </div>
          <PopoverPrimitive.Arrow className="company-search-popover__arrow" />
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  )
}
