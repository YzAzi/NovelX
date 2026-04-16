import { cn } from "@/lib/utils"
import type { IndexSnapshot, VersionDiff } from "@/src/types/models"

type VersionDiffProps = {
  base: IndexSnapshot | null
  target: IndexSnapshot | null
  diff: VersionDiff | null
}

function renderList(title: string, items: string[], textColor: string, borderColor: string) {
  return (
    <div className={cn("rounded-xl border p-3 text-xs", borderColor)}>
      <div className={cn("mb-2 text-sm font-semibold", textColor)}>{title}</div>
      {items.length === 0 ? (
        <div className="text-muted-foreground/60">无</div>
      ) : (
        <div className="space-y-1 font-mono text-[11px]">
          {items.map((item) => (
            <div key={item} className={cn("rounded-md px-1.5 py-0.5", textColor)}>
              {item}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function VersionDiff({ base, target, diff }: VersionDiffProps) {
  if (!base || !target || !diff) {
    return (
      <div className="flex h-full flex-col items-center justify-center rounded-xl border border-dashed border-border/60 bg-background/40 text-sm text-muted-foreground">
        <div className="mb-2 text-2xl opacity-40">🔍</div>
        选择两个版本查看差异
      </div>
    )
  }

  const wordDelta = diff.words_added - diff.words_removed
  const isGrowth = wordDelta >= 0

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="grid gap-3 rounded-xl border border-border/60 bg-card/90 p-4 text-xs">
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <div className="text-[11px] text-muted-foreground">基准版本</div>
            <div className="text-sm font-semibold">v{base.version}</div>
            <div className="text-[11px] text-muted-foreground">{base.name ?? "未命名"}</div>
          </div>
          <div className="text-lg text-muted-foreground/30">→</div>
          <div className="text-right">
            <div className="text-[11px] text-muted-foreground">对比版本</div>
            <div className="text-sm font-semibold">v{target.version}</div>
            <div className="text-[11px] text-muted-foreground">{target.name ?? "未命名"}</div>
          </div>
          <div className="text-right">
            <div className="text-[11px] text-muted-foreground">字数变化</div>
            <div className={cn(
              "text-sm font-semibold tabular-nums",
              isGrowth ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400",
            )}>
              {isGrowth ? "+" : ""}{wordDelta}
            </div>
            <div className="text-[10px] text-muted-foreground">
              (+{diff.words_added} / -{diff.words_removed})
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-2 lg:grid-cols-2">
        {diff.nodes_added.length > 0 && renderList(
          `新增节点 (${diff.nodes_added.length})`,
          diff.nodes_added,
          "text-emerald-600 dark:text-emerald-400",
          "border-emerald-500/20 bg-emerald-500/5",
        )}
        {diff.nodes_deleted.length > 0 && renderList(
          `删除节点 (${diff.nodes_deleted.length})`,
          diff.nodes_deleted,
          "text-red-600 dark:text-red-400",
          "border-red-500/20 bg-red-500/5",
        )}
        {diff.nodes_modified.length > 0 && renderList(
          `修改节点 (${diff.nodes_modified.length})`,
          diff.nodes_modified,
          "text-amber-600 dark:text-amber-400",
          "border-amber-500/20 bg-amber-500/5",
        )}
        {diff.entities_added.length > 0 && renderList(
          `新增实体 (${diff.entities_added.length})`,
          diff.entities_added,
          "text-emerald-600 dark:text-emerald-400",
          "border-emerald-500/20 bg-emerald-500/5",
        )}
        {diff.entities_deleted.length > 0 && renderList(
          `删除实体 (${diff.entities_deleted.length})`,
          diff.entities_deleted,
          "text-red-600 dark:text-red-400",
          "border-red-500/20 bg-red-500/5",
        )}
        {diff.relations_added.length > 0 && renderList(
          `新增关系 (${diff.relations_added.length})`,
          diff.relations_added,
          "text-emerald-600 dark:text-emerald-400",
          "border-emerald-500/20 bg-emerald-500/5",
        )}
        {diff.relations_deleted.length > 0 && renderList(
          `删除关系 (${diff.relations_deleted.length})`,
          diff.relations_deleted,
          "text-red-600 dark:text-red-400",
          "border-red-500/20 bg-red-500/5",
        )}
        {diff.nodes_added.length === 0 &&
         diff.nodes_deleted.length === 0 &&
         diff.nodes_modified.length === 0 &&
         diff.entities_added.length === 0 &&
         diff.entities_deleted.length === 0 &&
         diff.relations_added.length === 0 &&
         diff.relations_deleted.length === 0 && (
          <div className="col-span-full rounded-xl border border-dashed border-border/60 bg-background/40 py-8 text-center text-xs text-muted-foreground">
            两个版本内容一致，无差异
          </div>
        )}
      </div>
    </div>
  )
}
