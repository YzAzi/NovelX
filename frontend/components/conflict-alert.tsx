"use client";

import { useProjectStore } from "@/src/stores/project-store";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function ConflictAlert() {
  const { conflicts, clearConflicts, removeConflict } = useProjectStore();

  if (conflicts.length === 0) {
    return null;
  }

  return (
    <div className="fixed bottom-4 right-4 z-40 w-[320px] space-y-2">
      <div className="flex items-center justify-between rounded-lg border border-border/60 bg-card px-3 py-2 text-xs shadow-sm">
        <span className="font-semibold text-foreground">冲突提醒</span>
        <Button
          size="sm"
          variant="ghost"
          onClick={clearConflicts}
          className="h-auto px-2 py-1 text-[11px]"
        >
          全部清除
        </Button>
      </div>
      {conflicts.map((conflict) => {
        const colorClass =
          conflict.severity === "error"
            ? "border-destructive/30 bg-destructive/10 text-destructive"
            : conflict.severity === "warning"
              ? "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400"
              : "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-400";
        return (
          <div
            key={conflict._id}
            className={cn(
              "rounded-lg border px-3 py-2 text-xs shadow-sm",
              colorClass,
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="font-semibold">{conflict.type}</div>
              <button
                type="button"
                className="text-[11px] text-muted-foreground hover:text-foreground"
                onClick={() => removeConflict(conflict._id)}
              >
                关闭
              </button>
            </div>
            <div className="mt-1">{conflict.description}</div>
            {conflict.suggestion ? (
              <div className="mt-1 text-[11px] opacity-80">
                建议：{conflict.suggestion}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
