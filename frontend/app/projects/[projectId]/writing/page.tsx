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
      <div className="app-backdrop relative min-h-screen text-foreground">
        <div className="relative mx-3 mt-3 flex flex-col gap-3 md:mx-4">
          <ProjectHeader
            projectId={projectId}
            activeModule="writing"
          />
          <div className="panel-shell-strong min-h-[calc(100vh-10rem)] overflow-hidden">
            <ProjectWorkspaceHeader
              moduleKey="writing"
            />
            <div className="p-2 sm:p-3">
              <WritingWorkspace />
            </div>
          </div>
        </div>
      </div>
    </ProjectRouteGuard>
  )
}
