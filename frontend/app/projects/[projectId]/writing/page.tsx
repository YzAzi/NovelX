"use client"

import { useParams } from "next/navigation"

import { WritingWorkspace } from "@/components/writing-workspace"
import { ProjectRouteGuard } from "@/components/project-route-guard"
import { ProjectHeader, ProjectWorkspaceHeader } from "@/components/project-header"

export default function ProjectWritingPage() {
  const params = useParams<{ projectId: string }>()
  const projectId = Array.isArray(params?.projectId)
    ? params.projectId[0]
    : params?.projectId ?? ""

  return (
    <ProjectRouteGuard projectId={projectId}>
      <div className="app-backdrop relative flex min-h-[100dvh] flex-col overflow-x-hidden overflow-y-auto text-foreground">
        <div className="relative mx-3 mt-3 flex min-h-[calc(100dvh-0.75rem)] flex-1 flex-col gap-3 pb-3 md:mx-4">
          <ProjectHeader
            projectId={projectId}
            activeModule="writing"
          />
          <div className="panel-shell-strong flex min-h-[calc(100dvh-11rem)] flex-1 flex-col overflow-hidden">
            <ProjectWorkspaceHeader
              moduleKey="writing"
            />
            <div className="min-h-[680px] flex-1 p-2 sm:min-h-[720px] sm:p-3">
              <WritingWorkspace />
            </div>
          </div>
        </div>
      </div>
    </ProjectRouteGuard>
  )
}
