"use client"

import { useEffect, useState, type ReactNode } from "react"
import Link from "next/link"

import { useProjectStore } from "@/src/stores/project-store"
import { Button } from "@/components/ui/button"

type ProjectRouteGuardProps = {
  projectId: string
  children: ReactNode
}

export function ProjectRouteGuard({
  projectId,
  children,
}: ProjectRouteGuardProps) {
  const { currentProject, error, loadProject } = useProjectStore()
  const [isBootstrapping, setIsBootstrapping] = useState(false)

  useEffect(() => {
    if (!projectId || currentProject?.id === projectId) {
      return
    }
    let cancelled = false
    setIsBootstrapping(true)
    void loadProject(projectId).finally(() => {
      if (!cancelled) {
        setIsBootstrapping(false)
      }
    })
    return () => {
      cancelled = true
    }
  }, [currentProject?.id, loadProject, projectId])

  if (!projectId) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="space-y-4 text-center">
          <p className="text-sm text-muted-foreground">无效的项目地址。</p>
          <Button asChild variant="outline">
            <Link href="/">返回主页</Link>
          </Button>
        </div>
      </div>
    )
  }

  if (isBootstrapping || currentProject?.id !== projectId) {
    if (!isBootstrapping && error) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-background px-4">
          <div className="space-y-4 text-center">
            <p className="text-sm text-destructive">{error}</p>
            <Button asChild variant="outline">
              <Link href="/">返回主页</Link>
            </Button>
          </div>
        </div>
      )
    }

    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="space-y-2 text-center">
          <p className="text-sm font-medium text-foreground">正在恢复项目…</p>
          <p className="text-xs text-muted-foreground">
            正在根据链接加载项目内容。
          </p>
        </div>
      </div>
    )
  }

  return <>{children}</>
}
