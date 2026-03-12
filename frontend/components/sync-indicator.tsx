"use client"

import { useProjectStore } from "@/src/stores/project-store"
import { cn } from "@/lib/utils"

function StatusDot({ status }: { status: "connected" | "disconnected" | "reconnecting" }) {
  const color =
    status === "connected"
      ? "bg-emerald-500"
      : status === "reconnecting"
        ? "bg-amber-500"
        : "bg-red-500"
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
    <div className="flex items-center gap-3 text-xs text-slate-600">
      <div className="flex items-center gap-2">
        <StatusDot status={wsStatus} />
        <span>
          {wsStatus === "connected"
            ? "实时连接"
            : wsStatus === "reconnecting"
              ? "重新连接中"
              : "连接断开"}
        </span>
      </div>
      <div className="flex items-center gap-2">
        {syncStatus === "syncing" ? (
          <span className="flex items-center gap-2 text-amber-600">
            <span className="h-2 w-2 animate-pulse rounded-full bg-amber-500" />
            {syncLabel ? `同步中（${syncLabel}）` : "同步中..."}
          </span>
        ) : syncStatus === "completed" ? (
          <span className="flex items-center gap-2 text-emerald-600">
            {syncLabel ? `✓ 已同步（${syncLabel}）` : "✓ 已同步"}
          </span>
        ) : syncStatus === "failed" ? (
          <span className="flex items-center gap-2 text-red-600">
            {syncLabel ? `! 同步失败（${syncLabel}）` : "! 同步失败"}
          </span>
        ) : (
          <span className="text-slate-400">待同步</span>
        )}
      </div>
    </div>
  )
}
