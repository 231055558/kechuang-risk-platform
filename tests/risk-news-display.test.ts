import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import {
  getRiskNewsDisplaySourceName,
  getRiskNewsDisplayTitle,
} from "../src/lib/risk-news-display.ts"

const realtimeSource = readFileSync(
  new URL("../src/components/dashboard/realtime-tab.tsx", import.meta.url),
  "utf8"
)

const entityListSuffix =
  " · Entity List (EL) - Bureau of Industry and Security"

test("美国实体清单标题在资讯页面使用中文主体名称", () => {
  assert.equal(
    getRiskNewsDisplayTitle(
      `Cambricon Technologies Corporation Limited${entityListSuffix}`
    ),
    "中科寒武纪科技股份有限公司被列入美国商务部工业与安全局实体清单"
  )
  assert.equal(
    getRiskNewsDisplayTitle(
      `Cambricon Jixingge (Nanjing) Technology Co., Ltd.${entityListSuffix}`
    ),
    "寒武纪行歌（南京）科技有限公司被列入美国商务部工业与安全局实体清单"
  )
  assert.equal(
    getRiskNewsDisplayTitle(
      `Unknown Example Corp.${entityListSuffix}`,
      "寒武纪"
    ),
    "寒武纪相关主体被列入美国商务部工业与安全局实体清单"
  )
})

test("中文标题保持原样且实体清单来源名称中文化", () => {
  assert.equal(
    getRiskNewsDisplayTitle("关于涉及劳动争议诉讼的公告"),
    "关于涉及劳动争议诉讼的公告"
  )
  assert.equal(
    getRiskNewsDisplaySourceName(
      "Entity List (EL) - Bureau of Industry and Security"
    ),
    "美国商务部工业与安全局实体清单"
  )
  assert.equal(
    getRiskNewsDisplayTitle(
      "Semiconductor Manufacturing International Corporation · Non-SDN Chinese Military-Industrial Complex Companies List (CMIC) - Treasury Department",
      "中芯国际"
    ),
    "中芯国际集成电路制造有限公司被列入美国财政部中国军工复合体企业清单"
  )
  assert.equal(
    getRiskNewsDisplaySourceName(
      "Non-SDN Chinese Military-Industrial Complex Companies List (CMIC) - Treasury Department"
    ),
    "美国财政部中国军工复合体企业清单"
  )
  assert.equal(
    getRiskNewsDisplaySourceName("上交所公司公告/Ego"),
    "上海证券交易所公司公告"
  )
})

test("原始英文标题只通过详情原文定位字段展示", () => {
  assert.match(realtimeSource, /<dd>\{signal\.sourceLocator\}<\/dd>/)
  assert.match(realtimeSource, /<DialogTitle>\{displayTitle\}<\/DialogTitle>/)
  assert.match(realtimeSource, /<h3>[\s\S]*?<span>\{displayTitle\}<\/span>[\s\S]*?<\/h3>/)
  assert.doesNotMatch(realtimeSource, /<DialogTitle>\{signal\.title\}<\/DialogTitle>/)
})
