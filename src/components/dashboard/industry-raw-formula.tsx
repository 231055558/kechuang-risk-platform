import type { IndustryRiskMetricScore } from "@/domain/industry-risk-v1/index.ts"

type FormulaSpec = {
  target: React.ReactNode
  runtime: React.ReactNode
  terms: Array<{ symbol: string; meaning: string }>
}

type ImplementationStatus = "direct" | "partial" | "proxy"

const IMPLEMENTATION_STATUS: Partial<
  Record<IndustryRiskMetricScore["indicatorId"], ImplementationStatus>
> = {
  R05: "proxy",
  R06: "proxy",
  R07: "partial",
  R08: "proxy",
  R09: "proxy",
  R10: "partial",
  R11: "partial",
  R12: "partial",
  R13: "direct",
  R14: "partial",
  R15: "partial",
  R16: "partial",
  R17: "proxy",
  R18: "direct",
  R19: "partial",
  R20: "partial",
  R21: "proxy",
  R22: "proxy",
}

const IMPLEMENTATION_COPY: Record<
  ImplementationStatus,
  { label: string; description: string }
> = {
  direct: {
    label: "直接实现",
    description: "当前运行公式与目标定义一致，使用现有可比报告期数据直接计算。",
  },
  partial: {
    label: "部分实现",
    description: "当前数据只覆盖目标公式中的可计算部分；未覆盖因素保持缺失或写入限制说明。",
  },
  proxy: {
    label: "代理实现",
    description: "当前使用可观测代理形成同业比较，不替代目标指标定义，也不能解释为目标公式已经完整落地。",
  },
}

function Equation({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <math aria-label={label}>
      <mrow>{children}</mrow>
    </math>
  )
}

function Sub({ base, sub }: { base: string; sub: string }) {
  return (
    <msub>
      <mi>{base}</mi>
      <mtext>{sub}</mtext>
    </msub>
  )
}

function Fraction({
  numerator,
  denominator,
}: {
  numerator: React.ReactNode
  denominator: React.ReactNode
}) {
  return (
    <mfrac>
      <mrow>{numerator}</mrow>
      <mrow>{denominator}</mrow>
    </mfrac>
  )
}

function Times100() {
  return (
    <>
      <mo>×</mo>
      <mn>100</mn>
      <mo>%</mo>
    </>
  )
}

function Count({
  symbol,
  set,
  label,
}: {
  symbol: React.ReactNode
  set: React.ReactNode
  label: string
}) {
  return (
    <Equation label={label}>
      {symbol}
      <mo>=</mo>
      <munderover>
        <mo>∑</mo>
        <mrow>
          <mi>e</mi>
          <mo>∈</mo>
          {set}
        </mrow>
        <mrow />
      </munderover>
      <mn>1</mn>
    </Equation>
  )
}

const FORMULAS: Partial<
  Record<IndustryRiskMetricScore["indicatorId"], FormulaSpec>
> = {
  R05: {
    target: (
      <>
        <Equation label="专利质量指数等于近五年去自引前向被引次数除以有效发明专利族数">
          <Sub base="Q" sub="pat" />
          <mo>=</mo>
          <Fraction
            numerator={<Sub base="C" sub="前向被引·去自引·5年" />}
            denominator={<Sub base="N" sub="有效发明专利族·5年" />}
          />
        </Equation>
        <Equation label="专利质量指数按 IPC 小类和申请年份标准化">
          <Sub base="Z" sub="pat" />
          <mo>=</mo>
          <mi>standardize</mi>
          <mo>(</mo>
          <Sub base="Q" sub="pat" />
          <mo>|</mo>
          <mi>IPC</mi>
          <mo>,</mo>
          <mi>year</mi>
          <mo>)</mo>
        </Equation>
      </>
    ),
    runtime: (
      <Equation label="当前 R05 取值等于有效或授权专利存量">
        <Sub base="X" sub="R05" />
        <mo>=</mo>
        <Sub base="N" sub="有效/授权专利存量" />
      </Equation>
    ),
    terms: [
      { symbol: "C", meaning: "近5年去除自引后的前向被引总次数" },
      { symbol: "N", meaning: "同期有效发明专利族数量" },
      { symbol: "IPC / year", meaning: "专利技术小类与申请年份控制项" },
    ],
  },
  R06: {
    target: (
      <Equation label="核心技术人员占比等于核心技术及研发人员数除以员工总数乘百分之百">
        <Sub base="S" sub="tech" />
        <mo>=</mo>
        <Fraction
          numerator={<Sub base="N" sub="核心技术及研发人员" />}
          denominator={<Sub base="N" sub="员工总数" />}
        />
        <Times100 />
      </Equation>
    ),
    runtime: (
      <Equation label="当前 R06 使用最新报告期研发人员占比">
        <Sub base="X" sub="R06" />
        <mo>=</mo>
        <Sub base="S" sub="研发人员·最新报告期" />
      </Equation>
    ),
    terms: [
      { symbol: "N核心技术及研发人员", meaning: "报告期末统一人员口径人数" },
      { symbol: "N员工总数", meaning: "报告期末企业员工总数" },
    ],
  },
  R07: {
    target: (
      <>
        <Equation label="研发投入强度等于研发投入除以营业收入乘百分之百">
          <Sub base="I" sub="R&D" />
          <mo>=</mo>
          <Fraction
            numerator={<Sub base="E" sub="研发投入" />}
            denominator={<Sub base="REV" sub="营业收入" />}
          />
          <Times100 />
        </Equation>
        <Equation label="无收入企业以研发投入除以经营支出计算">
          <Sub base="I" sub="R&D·无收入" />
          <mo>=</mo>
          <Fraction
            numerator={<Sub base="E" sub="研发投入" />}
            denominator={<Sub base="OPEX" sub="经营支出" />}
          />
          <Times100 />
        </Equation>
      </>
    ),
    runtime: (
      <Equation label="当前 R07 使用最新报告期研发投入强度">
        <Sub base="X" sub="R07" />
        <mo>=</mo>
        <Sub base="I" sub="R&D·最新报告期" />
      </Equation>
    ),
    terms: [
      { symbol: "E研发投入", meaning: "研发费用或研发总投入" },
      { symbol: "REV", meaning: "同期营业收入" },
      { symbol: "OPEX", meaning: "尚未形成收入企业的同期经营支出" },
    ],
  },
  R08: {
    target: (
      <Equation label="里程碑兑现率等于已完成里程碑加权值之和除以到期里程碑权重之和乘百分之百">
        <Sub base="D" sub="milestone" />
        <mo>=</mo>
        <Fraction
          numerator={
            <>
              <mo>∑</mo>
              <Sub base="w" sub="j" />
              <mo>×</mo>
              <Sub base="c" sub="j" />
            </>
          }
          denominator={
            <>
              <mo>∑</mo>
              <Sub base="w" sub="j" />
            </>
          }
        />
        <Times100 />
      </Equation>
    ),
    runtime: (
      <Equation label="当前 R08 等于延期、负面和变更事件数量之和">
        <Sub base="X" sub="R08" />
        <mo>=</mo>
        <Sub base="N" sub="延期" />
        <mo>+</mo>
        <Sub base="N" sub="负面" />
        <mo>+</mo>
        <Sub base="N" sub="变更" />
      </Equation>
    ),
    terms: [
      { symbol: "wj", meaning: "第 j 项到期里程碑权重" },
      { symbol: "cj", meaning: "完成系数：1、0.7、0.4 或 0" },
      { symbol: "N", meaning: "当前代理口径识别到的相关事件数" },
    ],
  },
  R09: {
    target: (
      <Equation label="三年事件指数等于各事件严重度、责任系数和时间系数乘积之和">
        <Sub base="I" sub="event·3y" />
        <mo>=</mo>
        <mo>∑</mo>
        <Sub base="S" sub="e" />
        <mo>×</mo>
        <Sub base="L" sub="e" />
        <mo>×</mo>
        <Sub base="T" sub="e" />
      </Equation>
    ),
    runtime: (
      <Count
        symbol={<Sub base="X" sub="R09" />}
        set={<Sub base="E" sub="技术/IP不利事件" />}
        label="当前 R09 等于技术及知识产权不利事件数量"
      />
    ),
    terms: [
      { symbol: "Se", meaning: "事件严重度" },
      { symbol: "Le", meaning: "责任归属系数" },
      { symbol: "Te", meaning: "时间衰减系数" },
    ],
  },
  R10: {
    target: (
      <Count
        symbol={<Sub base="N" sub="penalty,q" />}
        set={<Sub base="P" sub="本季度行政处罚" />}
        label="季度处罚数等于本季度行政处罚事件数量"
      />
    ),
    runtime: (
      <Count
        symbol={<Sub base="X" sub="R10" />}
        set={<Sub base="P" sub="已接入处罚及监管措施" />}
        label="当前 R10 等于已接入处罚及监管措施数量"
      />
    ),
    terms: [
      { symbol: "P本季度行政处罚", meaning: "本季度符合口径的行政处罚集合" },
      {
        symbol: "P已接入处罚及监管措施",
        meaning: "当前累计处罚与监管代理集合",
      },
    ],
  },
  R11: {
    target: (
      <Count
        symbol={<Sub base="N" sub="inquiry,q" />}
        set={<Sub base="Q" sub="本季度交易所问询主题" />}
        label="季度问询数等于本季度交易所问询主题数量"
      />
    ),
    runtime: (
      <Count
        symbol={<Sub base="X" sub="R11" />}
        set={<Sub base="Q" sub="同口径报告期问询主题" />}
        label="当前 R11 等于同口径报告期问询主题数量"
      />
    ),
    terms: [{ symbol: "Q", meaning: "按主题去重后的交易所问询函集合" }],
  },
  R12: {
    target: (
      <>
        <Count
          symbol={<Sub base="N" sub="defendant" />}
          set={<Sub base="L" sub="年度被告诉讼" />}
          label="年度被告诉讼数等于年度被告诉讼案件数量"
        />
        <Equation label="涉诉金额比例等于诉讼标的金额除以营业收入乘百分之百">
          <Sub base="S" sub="litigation" />
          <mo>=</mo>
          <Fraction
            numerator={<Sub base="A" sub="诉讼标的金额" />}
            denominator={<Sub base="REV" sub="营业收入" />}
          />
          <Times100 />
        </Equation>
      </>
    ),
    runtime: (
      <Count
        symbol={<Sub base="X" sub="R12" />}
        set={<Sub base="L" sub="同口径案件/判决/重大披露" />}
        label="当前 R12 等于同口径案件、判决或重大披露数量"
      />
    ),
    terms: [
      { symbol: "Ndefendant", meaning: "年度企业作为被告的案件数量" },
      { symbol: "A", meaning: "诉讼或仲裁标的金额" },
      { symbol: "REV", meaning: "同期营业收入" },
    ],
  },
  R13: {
    target: (
      <Equation label="营业收入增长率等于本期营业收入减上期营业收入后除以上期营业收入乘百分之百">
        <Sub base="g" sub="REV" />
        <mo>=</mo>
        <Fraction
          numerator={
            <>
              <Sub base="REV" sub="t" />
              <mo>−</mo>
              <Sub base="REV" sub="t−1" />
            </>
          }
          denominator={<Sub base="REV" sub="t−1" />}
        />
        <Times100 />
      </Equation>
    ),
    runtime: (
      <Equation label="当前 R13 使用最新可比报告期营业收入同比增长率">
        <Sub base="X" sub="R13" />
        <mo>=</mo>
        <Sub base="g" sub="REV·最新可比报告期" />
      </Equation>
    ),
    terms: [
      { symbol: "REVt", meaning: "本期营业收入" },
      { symbol: "REVt−1", meaning: "上期可比营业收入" },
    ],
  },
  R14: {
    target: (
      <Equation label="无形资产占比变化等于本期占比减上期占比">
        <Sub base="ΔS" sub="IA" />
        <mo>=</mo>
        <mo>[</mo>
        <Fraction
          numerator={<Sub base="IA" sub="t" />}
          denominator={<Sub base="TA" sub="t" />}
        />
        <mo>−</mo>
        <Fraction
          numerator={<Sub base="IA" sub="t−1" />}
          denominator={<Sub base="TA" sub="t−1" />}
        />
        <mo>]</mo>
        <Times100 />
      </Equation>
    ),
    runtime: (
      <Equation label="当前 R14 使用同口径无形资产占比变化或占比水平">
        <Sub base="X" sub="R14" />
        <mo>=</mo>
        <Sub base="ΔS" sub="IA" />
        <mo>或</mo>
        <Sub base="S" sub="IA" />
      </Equation>
    ),
    terms: [
      { symbol: "IA", meaning: "无形资产合计" },
      { symbol: "TA", meaning: "资产总额" },
      { symbol: "Δ", meaning: "相邻报告期之间的变化" },
    ],
  },
  R15: {
    target: (
      <>
        <Equation label="债务融资成本率等于利息支出除以平均有息负债乘百分之百">
          <Sub base="k" sub="d" />
          <mo>=</mo>
          <Fraction
            numerator={<Sub base="E" sub="利息支出" />}
            denominator={<Sub base="D" sub="平均有息负债" />}
          />
          <Times100 />
        </Equation>
        <Equation label="加权平均资本成本等于权益和债务成本的加权和">
          <mi>WACC</mi>
          <mo>=</mo>
          <Fraction
            numerator={<mi>E</mi>}
            denominator={
              <mrow>
                <mi>D</mi>
                <mo>+</mo>
                <mi>E</mi>
              </mrow>
            }
          />
          <mo>×</mo>
          <Sub base="k" sub="e" />
          <mo>+</mo>
          <Fraction
            numerator={<mi>D</mi>}
            denominator={
              <mrow>
                <mi>D</mi>
                <mo>+</mo>
                <mi>E</mi>
              </mrow>
            }
          />
          <mo>×</mo>
          <Sub base="k" sub="d" />
          <mo>×</mo>
          <mo>(</mo>
          <mn>1</mn>
          <mo>−</mo>
          <Sub base="T" sub="c" />
          <mo>)</mo>
        </Equation>
      </>
    ),
    runtime: (
      <Equation label="当前 R15 优先使用债务成本率，缺失时使用利息支出">
        <Sub base="X" sub="R15" />
        <mo>=</mo>
        <Sub base="k" sub="d" />
        <mo>；缺失时</mo>
        <Sub base="E" sub="利息支出" />
      </Equation>
    ),
    terms: [
      { symbol: "kd / ke", meaning: "债务资本成本 / 权益资本成本" },
      { symbol: "D / E", meaning: "债务资本 / 权益资本" },
      { symbol: "Tc", meaning: "企业所得税率" },
    ],
  },
  R16: {
    target: (
      <>
        <Equation label="现金短债比等于货币资金与交易性金融资产之和除以短期有息债务">
          <Sub base="C" sub="cash/debt" />
          <mo>=</mo>
          <Fraction
            numerator={
              <mrow>
                <mi>Cash</mi>
                <mo>+</mo>
                <mi>TradingAssets</mi>
              </mrow>
            }
            denominator={
              <mrow>
                <mi>ShortLoan</mi>
                <mo>+</mo>
                <mi>CurrentMaturity</mi>
              </mrow>
            }
          />
        </Equation>
        <Equation label="经营现金流覆盖率等于经营活动现金流量净额除以短期有息债务">
          <Sub base="C" sub="OCF" />
          <mo>=</mo>
          <Fraction
            numerator={<mi>OCF</mi>}
            denominator={<Sub base="D" sub="短期有息债务" />}
          />
        </Equation>
      </>
    ),
    runtime: (
      <Equation label="当前 R16 优先使用经营现金流覆盖率，缺失时使用现金短债比">
        <Sub base="X" sub="R16" />
        <mo>=</mo>
        <Sub base="C" sub="OCF" />
        <mo>；缺失时</mo>
        <Sub base="C" sub="cash/debt" />
      </Equation>
    ),
    terms: [
      { symbol: "OCF", meaning: "经营活动产生的现金流量净额" },
      { symbol: "ShortLoan", meaning: "短期借款" },
      { symbol: "CurrentMaturity", meaning: "一年内到期的非流动负债" },
    ],
  },
  R17: {
    target: (
      <Equation label="进口依赖度等于境外供应商采购金额除以总采购金额乘百分之百">
        <Sub base="D" sub="import" />
        <mo>=</mo>
        <Fraction
          numerator={<Sub base="A" sub="境外供应商采购" />}
          denominator={<Sub base="A" sub="总采购" />}
        />
        <Times100 />
      </Equation>
    ),
    runtime: (
      <Equation label="当前 R17 等于已核验境内供应商数量">
        <Sub base="X" sub="R17" />
        <mo>=</mo>
        <Sub base="N" sub="已核验境内供应商" />
      </Equation>
    ),
    terms: [
      { symbol: "A境外供应商采购", meaning: "境外供应商采购金额" },
      { symbol: "A总采购", meaning: "同期采购总额" },
      { symbol: "N", meaning: "当前数据中完成主体核验的境内供应商数" },
    ],
  },
  R18: {
    target: (
      <Equation label="海外业务收入占比等于海外业务收入除以营业收入乘百分之百">
        <Sub base="S" sub="overseas" />
        <mo>=</mo>
        <Fraction
          numerator={<Sub base="REV" sub="海外业务" />}
          denominator={<Sub base="REV" sub="总营业收入" />}
        />
        <Times100 />
      </Equation>
    ),
    runtime: (
      <Equation label="当前 R18 使用最新年度海外业务收入占比">
        <Sub base="X" sub="R18" />
        <mo>=</mo>
        <Sub base="S" sub="overseas·最新年度" />
      </Equation>
    ),
    terms: [
      { symbol: "REV海外业务", meaning: "年度境外地区业务收入" },
      { symbol: "REV总营业收入", meaning: "同期企业营业收入" },
    ],
  },
  R19: {
    target: (
      <>
        <Equation label="清单命中数等于各管制与制裁清单精确命中数之和">
          <Sub base="N" sub="hit" />
          <mo>=</mo>
          <mo>∑</mo>
          <Sub base="N" sub="list·k" />
        </Equation>
        <Equation label="受管制影响度等于受管制核心零部件及技术数量除以核心零部件及技术总数乘百分之百">
          <Sub base="E" sub="control" />
          <mo>=</mo>
          <Fraction
            numerator={<Sub base="N" sub="受管制核心部件/技术" />}
            denominator={<Sub base="N" sub="核心部件/技术总数" />}
          />
          <Times100 />
        </Equation>
      </>
    ),
    runtime: (
      <Equation label="当前 R19 等于美国与欧盟清单精确命中类别数量之和">
        <Sub base="X" sub="R19" />
        <mo>=</mo>
        <Sub base="N" sub="美国CSL精确命中" />
        <mo>+</mo>
        <Sub base="N" sub="欧盟FSD精确命中" />
      </Equation>
    ),
    terms: [
      { symbol: "Nlist,k", meaning: "第 k 类管制或制裁清单命中数" },
      { symbol: "Econtrol", meaning: "核心部件与技术的受管制比例" },
    ],
  },
  R20: {
    target: (
      <>
        <Equation label="实控人持股比例等于实控人持股数量除以总股本乘百分之百">
          <Sub base="S" sub="controller" />
          <mo>=</mo>
          <Fraction
            numerator={<Sub base="N" sub="实控人持股" />}
            denominator={<Sub base="N" sub="总股本" />}
          />
          <Times100 />
        </Equation>
        <Equation label="控制权阈值标记在持股比例低于百分之三十四时为一">
          <Sub base="I" sub="control" />
          <mo>=</mo>
          <mi>𝟙</mi>
          <mo>[</mo>
          <Sub base="S" sub="controller" />
          <mo>&lt;</mo>
          <mn>34</mn>
          <mo>%</mo>
          <mo>]</mo>
        </Equation>
      </>
    ),
    runtime: (
      <Equation label="当前 R20 使用可获得的最大控制人持股比例">
        <Sub base="X" sub="R20" />
        <mo>=</mo>
        <mi>max</mi>
        <mo>(</mo>
        <Sub base="S" sub="可识别控制人" />
        <mo>)</mo>
      </Equation>
    ),
    terms: [
      { symbol: "Scontroller", meaning: "实控人或创始人持股比例" },
      { symbol: "34%", meaning: "当前方法文档采用的一票否决权观察阈值" },
    ],
  },
  R21: {
    target: (
      <Equation label="高管关联风险事件数等于各高管及其关联实体符合准入条件的风险事件数量之和">
        <Sub base="N" sub="关联风险" />
        <mo>=</mo>
        <munderover>
          <mo>∑</mo>
          <mrow>
            <mi>g</mi>
            <mo>∈</mo>
            <mi>G</mi>
          </mrow>
          <mrow />
        </munderover>
        <munderover>
          <mo>∑</mo>
          <mrow>
            <mi>e</mi>
            <mo>∈</mo>
            <mi>E</mi>
            <mo>(</mo>
            <mi>g</mi>
            <mo>)</mo>
          </mrow>
          <mrow />
        </munderover>
        <mi>𝟙</mi>
        <mo>[</mo>
        <mi>e</mi>
        <mo>∈</mo>
        <Sub base="C" sub="风险事件准入类别" />
        <mo>]</mo>
      </Equation>
    ),
    runtime: (
      <Equation label="当前 R21 使用企业或境内核心主体风险聚合条数">
        <Sub base="X" sub="R21" />
        <mo>=</mo>
        <Sub base="N" sub="企业/境内核心主体风险聚合" />
      </Equation>
    ),
    terms: [
      { symbol: "G", meaning: "董监高及可识别关联主体集合" },
      { symbol: "E(g)", meaning: "主体 g 对应的风险事件集合" },
      { symbol: "C", meaning: "处罚、失信、诉讼等已定义准入类别" },
    ],
  },
  R22: {
    target: (
      <Equation label="核心人员流失率等于报告期离职核心人员数除以期初核心人员总数乘百分之百">
        <Sub base="L" sub="core" />
        <mo>=</mo>
        <Fraction
          numerator={<Sub base="N" sub="报告期离职核心人员" />}
          denominator={<Sub base="N" sub="期初核心人员" />}
        />
        <Times100 />
      </Equation>
    ),
    runtime: (
      <Equation label="当前 R22 等于核心技术人员离职及变更事件数量">
        <Sub base="X" sub="R22" />
        <mo>=</mo>
        <Sub base="N" sub="核心人员离职/变更事件" />
      </Equation>
    ),
    terms: [
      {
        symbol: "N报告期离职核心人员",
        meaning: "报告期内离职的关键管理及技术人员数",
      },
      { symbol: "N期初核心人员", meaning: "报告期初同口径核心人员总数" },
    ],
  },
}

export function IndustryRawFormula({
  indicatorId,
  rawValueFormula,
}: {
  indicatorId: IndustryRiskMetricScore["indicatorId"]
  rawValueFormula?: string
}) {
  const spec = FORMULAS[indicatorId]
  if (!spec) {
    return (
      <p className="indicator-method-sheet__formula-unavailable">
        当前指标尚未提供可公开渲染的数学公式。
      </p>
    )
  }
  const implementation = IMPLEMENTATION_STATUS[indicatorId] ?? "partial"
  const implementationCopy = IMPLEMENTATION_COPY[implementation]
  return (
    <div className="indicator-method-sheet__formula-presentation">
      <div className="indicator-method-sheet__formula-lane">
        <strong>目标指标公式</strong>
        {spec.target}
      </div>
      <div className="indicator-method-sheet__formula-lane" data-runtime="true">
        <strong>当前运行公式</strong>
        {spec.runtime}
      </div>
      <div
        className="indicator-method-sheet__formula-relation"
        data-implementation={implementation}
      >
        <span>两者关系</span>
        <strong>{implementationCopy.label}</strong>
        <p>{implementationCopy.description}</p>
        <small>当前运行值 → 风险方向调整 → 同业风险分位 Pᵢ → 单指标风险分 Rᵢ</small>
      </div>
      <dl className="indicator-method-sheet__symbol-key">
        {spec.terms.map((term) => (
          <div key={term.symbol}>
            <dt>{term.symbol}</dt>
            <dd>{term.meaning}</dd>
          </div>
        ))}
      </dl>
      {rawValueFormula ? (
        <details className="indicator-method-sheet__formula-source">
          <summary>查看指标口径原文</summary>
          <p>{rawValueFormula}</p>
        </details>
      ) : null}
    </div>
  )
}
