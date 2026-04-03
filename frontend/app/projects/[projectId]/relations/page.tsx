"use client"

import Link from "next/link"
import { useParams } from "next/navigation"

import { CharacterGraph } from "@/components/character-graph"
import { ProjectRouteGuard } from "@/components/project-route-guard"
import { Button } from "@/components/ui/button"

export default function ProjectRelationsPage() {
  const params = useParams<{ projectId: string }>()
  const projectId = Array.isArray(params?.projectId)
    ? params.projectId[0]
    : params?.projectId ?? ""

  return (
    <ProjectRouteGuard projectId={projectId}>
      <div className="min-h-screen bg-[linear-gradient(180deg,#fbf7f1_0%,#f4eee5_45%,#efe5d8_100%)]">
        <div className="mx-auto flex w-full max-w-[1600px] flex-col px-4 pb-6 pt-4 md:px-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-[28px] border border-black/5 bg-white/65 px-4 py-3 shadow-[0_18px_48px_rgba(38,24,14,0.08)] backdrop-blur-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Button asChild size="sm" variant="ghost">
                <Link href="/">返回大纲</Link>
              </Button>
              <Button asChild size="sm" variant="ghost">
                <Link href={`/projects/${projectId}/writing`}>写作</Link>
              </Button>
              <Button asChild size="sm" variant="ghost">
                <Link href={`/analysis/${projectId}`}>分析</Link>
              </Button>
            </div>
            <p className="text-sm text-slate-600">
              关系页支持章节筛选、主图搜索联动和角色档案编辑
            </p>
          </div>

          <div className="flex-1">
            <CharacterGraph />
          </div>
        </div>
      </div>
    </ProjectRouteGuard>
  )
}
