import { ExternalLinkIcon, NetworkIcon } from "lucide-react"

import { GlassPanel } from "@/components/dashboard/shared"
import { Reveal } from "@/components/motion/workflow-transition"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

const graphUrl =
  import.meta.env.VITE_RISK_GRAPH_URL?.trim() || "http://127.0.0.1:8765/"

/**
 * The risk graph is intentionally served by the Neo4j read-only API rather
 * than copied into the risk-platform API.  This keeps Neo4j credentials and
 * Cypher queries out of the browser while preserving the graph's progressive
 * event-focus interactions.
 */
export function RiskTransmissionGraph() {
  return (
    <Reveal>
      <GlassPanel className="risk-transmission-panel">
        <header className="risk-transmission-header">
          <div>
            <span className="eyebrow">Neo4j · 事件传导图</span>
            <h2>企业风险知识图谱</h2>
            <p>
              企业主体居中，展示已验证的风险事件、关联主体、受影响的二级风险指标与条件演化；
              不显示无证据的关系。
            </p>
          </div>
          <div className="risk-transmission-actions">
            <Badge variant="outline">
              <NetworkIcon data-icon="inline-start" />
              已同步 Neo4j
            </Badge>
            <Button variant="outline" size="sm" asChild>
              <a href={graphUrl} target="_blank" rel="noreferrer">
                独立查看
                <ExternalLinkIcon data-icon="inline-end" />
              </a>
            </Button>
          </div>
        </header>
        <div className="risk-transmission-frame-shell">
          <iframe
            className="risk-transmission-frame"
            src={graphUrl}
            title="企业风险事件传导知识图谱"
            loading="lazy"
          />
        </div>
      </GlassPanel>
    </Reveal>
  )
}
