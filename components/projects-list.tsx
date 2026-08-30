"use client"

import { useState, useEffect } from "react"
import { useSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import { useLocale, useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  Sparkles,
  Play,
  Eye,
  Trash2,
  MoreHorizontal,
  Clock,
  CheckCircle2,
  Loader2,
  FolderKanban,
} from "lucide-react"
import { useProject, getProgressPercentage } from "@/hooks/useProject"
import { useToast } from "@/hooks/use-toast"

interface ProjectsListProps {
  onCreateClick: () => void
}

export function ProjectsList({ onCreateClick }: ProjectsListProps) {
  const { status } = useSession()
  const router = useRouter()
  const locale = useLocale()
  const { toast } = useToast()
  const t = useTranslations("operate")

  const {
    projects,
    loading,
    error,
    pagination,
    loadProjects,
    deleteProject,
  } = useProject()

  // 只有登录后才加载数据
  useEffect(() => {
    if (status !== 'authenticated') return
    loadProjects()
  }, [status, loadProjects])

  // 获取步骤名称
  const getStepName = (step: string | null): string => {
    if (!step) return t("projects.steps.notStarted")
    const stepKey = `projects.steps.${step}` as "projects.steps.script" | "projects.steps.character" | "projects.steps.storyboard" | "projects.steps.scene_video" | "projects.steps.final_video"
    try {
      return t(stepKey)
    } catch {
      return step
    }
  }

  // 格式化时间
  const formatTime = (date: Date | string | null) => {
    if (!date) return ""
    const d = new Date(date)
    const now = new Date()
    const diffMs = now.getTime() - d.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)

    if (diffMins < 1) return t("projects.timeAgo.justNow")
    if (diffMins < 60) return t("projects.timeAgo.minutesAgo", { minutes: diffMins })
    if (diffHours < 24) return t("projects.timeAgo.hoursAgo", { hours: diffHours })
    if (diffDays < 7) return t("projects.timeAgo.daysAgo", { days: diffDays })
    
    return d.toLocaleDateString(locale === 'zh' ? 'zh-CN' : 'en-US')
  }

  // 处理查看项目
  const handleViewProject = (projectId: string) => {
    router.push(`/${locale}/projects/${projectId}`)
  }

  // 处理删除项目：改为受控 AlertDialog 确认，与全站弹窗体系一致（不再用阻塞式原生 confirm）
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null)
  const [deleting, setDeleting] = useState(false)

  const handleDelete = async (projectId: string, title: string) => {
    setDeleteTarget({ id: projectId, title })
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      const success = await deleteProject(deleteTarget.id)
      if (success) {
        toast({
          title: t("projects.deleteSuccess"),
          description: t("projects.deleteSuccessDesc"),
        })
      }
    } finally {
      setDeleting(false)
      setDeleteTarget(null)
    }
  }

  return (
    <div className="flex-1 p-4 md:p-8 pt-20 md:pt-8 overflow-y-auto">
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold mb-2">{t("projects.title")}</h1>
            <p className="text-muted-foreground">{t("projects.description")}</p>
          </div>
          <Button onClick={onCreateClick} disabled={status !== 'authenticated'}>
            <Sparkles className="w-4 h-4 mr-2" />
            {t("projects.createVideo")}
          </Button>
        </div>

        {/* 未登录状态提示 */}
        {status !== 'authenticated' && status !== 'loading' && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
              <FolderKanban className="w-8 h-8 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-semibold mb-2">{t("projects.please_login")}</h3>
            <p className="text-muted-foreground mb-4">
              {t("projects.please_login_description")}
            </p>
          </div>
        )}

        {/* 已登录用户的内容 */}
        {status === 'authenticated' && (
          <>
            {error && (
              <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-600">
                {error}
              </div>
            )}

            {loading && projects.length === 0 ? (
              // 加载状态
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {[1, 2, 3, 4, 5, 6].map((i) => (
                  <Card key={i} className="overflow-hidden">
                    <Skeleton className="aspect-video w-full" />
                    <CardContent className="p-4 space-y-3">
                      <Skeleton className="h-5 w-3/4" />
                      <Skeleton className="h-4 w-1/2" />
                      <div className="flex justify-between">
                        <Skeleton className="h-8 w-20" />
                        <Skeleton className="h-8 w-8 rounded-full" />
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : projects.length === 0 ? (
              // 空状态
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
              <Sparkles className="w-8 h-8 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-semibold mb-2">{t("projects.noProjects")}</h3>
            <p className="text-muted-foreground mb-4">{t("projects.noProjectsDesc")}</p>
            <Button onClick={onCreateClick}>
              <Sparkles className="w-4 h-4 mr-2" />
              {t("projects.createVideo")}
            </Button>
          </div>
        ) : (
          // 项目列表
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {projects.map((project) => {
              const progress = getProgressPercentage(project.currentStep)
              const stepName = getStepName(project.currentStep)
              
              return (
                <Card key={project.id} className="overflow-hidden group">
                  {/* 封面图 */}
                  <div className="aspect-video bg-muted relative overflow-hidden">
                    {project.thumbnailUrl ? (
                      <img
                        src={project.thumbnailUrl}
                        alt={project.title}
                        className="w-full h-full object-cover transition-transform group-hover:scale-105"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Play className="w-12 h-12 text-muted-foreground/30" />
                      </div>
                    )}
                    
                    {/* 状态标签 */}
                    <div className="absolute top-2 left-2">
                      {project.status === 'completed' ? (
                        <Badge className="bg-success">
                          <CheckCircle2 className="w-3 h-3 mr-1" />
                          {t("projects.completed")}
                        </Badge>
                      ) : (
                        <Badge className="bg-warning">
                          <Clock className="w-3 h-3 mr-1" />
                          {progress}% {stepName}
                        </Badge>
                      )}
                    </div>
                  </div>

                  <CardContent className="p-4">
                    {/* 标题 */}
                    <h3 className="font-semibold truncate mb-1" title={project.title}>
                      {project.title}
                    </h3>
                    
                    {/* 原始提示词预览 */}
                    <p className="text-sm text-muted-foreground line-clamp-2 mb-3 h-10">
                      {project.originalPrompt}
                    </p>

                    {/* 时间 */}
                    <p className="text-xs text-muted-foreground mb-3">
                      {formatTime(project.updatedAt || project.createdAt)}
                    </p>

                    {/* 操作按钮 */}
                    <div className="flex justify-between items-center">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleViewProject(project.id)}
                      >
                        <Eye className="w-4 h-4 mr-1" />
                        {t("projects.view")}
                      </Button>

                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm" aria-label={t("projects.moreActions")}>
                            <MoreHorizontal className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() => handleDelete(project.id, project.title)}
                            className="text-red-600"
                          >
                            <Trash2 className="w-4 h-4 mr-2" />
                            {t("projects.deleteProject")}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        )}
          </>
        )}

        {/* 分页 */}
        {pagination && pagination.totalPages > 1 && (
          <div className="flex justify-center gap-2 mt-8">
            <Button
              variant="outline"
              size="sm"
              disabled={pagination.page === 1}
              onClick={() => loadProjects(pagination.page - 1)}
            >
              {t("projects.previousPage")}
            </Button>
            <span className="flex items-center text-sm text-muted-foreground">
              {pagination.page} / {pagination.totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={pagination.page === pagination.totalPages}
              onClick={() => loadProjects(pagination.page + 1)}
            >
              {t("projects.nextPage")}
            </Button>
          </div>
        )}

        {/* 删除确认弹窗（替代原生 confirm） */}
        <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("projects.deleteProject")}</AlertDialogTitle>
              <AlertDialogDescription>
                {deleteTarget ? t("projects.deleteConfirm", { title: deleteTarget.title }) : ""}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleting}>{t("projects.cancel")}</AlertDialogCancel>
              <AlertDialogAction
                disabled={deleting}
                onClick={(e) => {
                  e.preventDefault()
                  confirmDelete()
                }}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {deleting ? t("projects.deleting") : t("projects.deleteProject")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  )
}
