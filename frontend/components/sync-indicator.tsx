"use client"

import { useProjectStore } from "@/src/stores/project-store"
import { cn } from "@/lib/utils"

function StatusDot({ status }: { status: "connected" | "disconnected" | "reconnecting" }) {
  const color =
    status === "connected"
      ? "bg-emerald-500/80"
      : status === "reconnecting"
        ? "bg-amber-500/80"
        : "bg-destructive/80"
  return <span className={cn("h-2 w-2 rounded-full", color)} />
}

export function SyncIndicator() {
  const { currentProject, syncNodeId, syncStatus, wsStatus } = useProjectStore()

  const syncNode = syncNodeId
    ? currentProject?.nodes.find((node) => node.id === syncNodeId) ?? null
    : null
  const syncLabel = syncNode
    ? `${syncNode.title || "未命名节点"}`
    : syncNodeId
      ? syncNodeId.slice(0, 8)
      : null

  return (
    <div className="flex items-center gap-3 text-xs text-muted-foreground">
      <div className="flex items-center gap-1.5">
        <StatusDot status={wsStatus} />
        <span>
          {wsStatus === "connected"
            ? "在线"
            : wsStatus === "reconnecting"
              ? "重连中"
              : "已断开"}
        </span>
      </div>
      <div className="flex items-center gap-1.5">
        {syncStatus === "syncing" ? (
          <span className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500/80" />
            {syncLabel ? `同步中（${syncLabel}）` : "同步中..."}
          </span>
        ) : syncStatus === "completed" ? (
          <span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
            {syncLabel ? `已同步（${syncLabel}）` : "已同步"}
          </span>
        ) : syncStatus === "failed" ? (
          <span className="flex items-center gap-1.5 text-destructive">
            {syncLabel ? `同步失败（${syncLabel}）` : "同步失败"}
          </span>
        ) : null}
      </div>
    </div>
  )
}
