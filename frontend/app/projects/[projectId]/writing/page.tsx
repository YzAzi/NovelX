"use client"

import Link from "next/link"
import { useParams } from "next/navigation"

import { WritingWorkspace } from "@/components/writing-workspace"
import { ProjectRouteGuard } from "@/components/project-route-guard"
import { Button } from "@/components/ui/button"

export default function ProjectWritingPage() {
  const params = useParams<{ projectId: string }>()
  const projectId = Array.isArray(params?.projectId)
    ? params.projectId[0]
    : params?.projectId ?? ""

  return (
    <ProjectRouteGuard projectId={projectId}>
      <div className="flex h-screen flex-col bg-background">
        <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
          <Button asChild size="sm" variant="ghost">
            <Link href="/">返回大纲</Link>
          </Button>
          <Button asChild size="sm" variant="ghost">
            <Link href={`/projects/${projectId}/relations`}>关系图</Link>
          </Button>
          <Button asChild size="sm" variant="ghost">
            <Link href={`/analysis/${projectId}`}>分析</Link>
          </Button>
        </div>
        <div className="min-h-0 flex-1">
          <WritingWorkspace />
        </div>
      </div>
    </ProjectRouteGuard>
  )
}
