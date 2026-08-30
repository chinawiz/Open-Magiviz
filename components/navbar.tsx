"use client"

import { useState, useEffect } from "react"
import { useTheme } from "next-themes"
import { useSession, signOut } from "next-auth/react"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu"
import { Sun, Moon, Menu, X, Globe, User, LogOut } from "lucide-react"
import { useRouter, usePathname } from "next/navigation"
import { useLocale, useTranslations } from "next-intl"
import Link from "next/link"
import Image from "next/image"
import { SignInDialog } from "@/components/auth/signin-dialog"

export function Navbar() {
  const { theme, setTheme } = useTheme()
  const { data: session, status } = useSession()
  const [mounted, setMounted] = useState(false)
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [isSignInDialogOpen, setIsSignInDialogOpen] = useState(false)
  const pathname = usePathname()
  const locale = useLocale()
  const t = useTranslations("navbar")
  const router = useRouter()

  useEffect(() => {
    setMounted(true)
  }, [])

  // 路由变化时收起移动端菜单（如浏览器前进/后退）
  useEffect(() => {
    setIsMenuOpen(false)
  }, [pathname])

  const toggleTheme = () => {
    setTheme(theme === "dark" ? "light" : "dark")
  }

  const switchLocale = (newLocale: string) => {
    if (!pathname) return
    const newPath = pathname.replace(`/${locale}`, `/${newLocale}`)
    // 保留 URL hash（如果有的话），这样在后台管理页面切换语言时可以保持在当前标签页
    const hash = typeof window !== 'undefined' ? window.location.hash : ''
    router.push(newPath + hash)
  }

  const getLocalizedPath = (path: string) => {
    return `/${locale}${path}`
  }

  const handleSignOut = async () => {
    await signOut({ callbackUrl: '/' })
  }

  // 当前页高亮：规范库 Active State——导航必须指示当前位置
  const isActive = (path: string) => {
    if (!pathname) return false
    const localized = getLocalizedPath(path)
    if (path === "/") return pathname === localized
    return pathname.startsWith(localized)
  }

  const navLinkClass = (active: boolean) =>
    `transition-colors duration-300 font-medium ${
      active ? "text-primary font-semibold" : "text-muted-foreground hover:text-primary"
    }`

  return (
    <>
      <nav className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between">
          {/* Logo */}
          <div className="flex items-center">
            <Link href="/" className="flex items-center">
              <div className="relative w-8 h-8 sm:w-10 sm:h-10">
                <Image
                  src="/logo.png"
                  alt="meihao Logo"
                  fill
                  className="object-contain"
                  priority
                />
              </div>
              <span className="ml-3 text-xl font-bold text-primary">MeiHao</span>
            </Link>
          </div>

          {/* Desktop Navigation */}
          <div className="hidden md:flex items-center space-x-8">
            <Link
              href={getLocalizedPath("/")}
              aria-current={isActive("/") ? "page" : undefined}
              className={`hover:scale-105 transform ${navLinkClass(isActive("/"))}`}
            >
              {t("home")}
            </Link>
            <Link
              href={getLocalizedPath("/create")}
              aria-current={isActive("/create") ? "page" : undefined}
              className={`hover:scale-105 transform ${navLinkClass(isActive("/create"))}`}
            >
              {t("exploreVideo")}
            </Link>
            <Link
              href={getLocalizedPath("/pricing")}
              aria-current={isActive("/pricing") ? "page" : undefined}
              className={`hover:scale-105 transform ${navLinkClass(isActive("/pricing"))}`}
            >
              {t("pricing")}
            </Link>
          </div>

          {/* Right side controls */}
          <div className="hidden md:flex items-center space-x-4">
            {/* Language Switcher */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-primary hover:bg-secondary transition-all duration-300">
                  <Globe className="h-4 w-4 mr-2 text-primary" />
                  {locale === "zh" ? "中" : "EN"}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem onClick={() => switchLocale("zh")} className="hover:bg-secondary hover:text-primary">中文</DropdownMenuItem>
                <DropdownMenuItem onClick={() => switchLocale("en")} className="hover:bg-secondary hover:text-primary">English</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Theme Toggle */}
            {mounted && (
              <Button variant="ghost" size="sm" onClick={toggleTheme} aria-label={t("toggleTheme")} className="text-muted-foreground hover:text-primary hover:bg-secondary transition-all duration-300">
                <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0 text-primary" />
                <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100 text-primary" />
                <span className="sr-only">{t("toggleTheme")}</span>
              </Button>
            )}

            {/* Auth Section */}
            {status === "loading" ? (
              <div className="w-8 h-8 animate-pulse bg-secondary rounded-full" />
            ) : session ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" aria-label={t("profile")} className="flex items-center space-x-2 text-muted-foreground hover:text-primary hover:bg-secondary transition-all duration-300">
                    <User className="h-4 w-4 text-primary" />
                    <span className="hidden lg:inline">{session.user?.name || session.user?.email}</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem asChild className="hover:bg-secondary hover:text-primary">
                    <Link href={getLocalizedPath("/profile")}>
                      <User className="mr-2 h-4 w-4 text-primary" />
                      {t("profile")}
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleSignOut} className="hover:bg-secondary hover:text-primary">
                    <LogOut className="mr-2 h-4 w-4 text-primary" />
                    {t("signOut")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <div className="flex items-center space-x-3">
                <Button variant="ghost" size="sm" onClick={() => setIsSignInDialogOpen(true)} className="text-muted-foreground hover:text-primary hover:bg-secondary transition-all duration-300">
                  {t("signIn")}
                </Button>
                <Button className="bg-primary text-primary-foreground hover:bg-primary/90 transition-all duration-300 cyber-glow hover:scale-105 transform" asChild>
                  <Link href={getLocalizedPath("/auth/signup")}>{t("signUp")}</Link>
                </Button>
              </div>
            )}
          </div>

          {/* Mobile menu button */}
          <div className="md:hidden">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsMenuOpen(!isMenuOpen)}
              aria-label={isMenuOpen ? t("closeMenu") : t("openMenu")}
              aria-expanded={isMenuOpen}
              className="text-muted-foreground hover:text-primary hover:bg-primary/20 transition-all duration-300"
            >
              {isMenuOpen ? <X className="h-6 w-6 text-primary" /> : <Menu className="h-6 w-6 text-primary" />}
            </Button>
          </div>
        </div>

        {/* Mobile Navigation */}
        {isMenuOpen && (
          <div className="md:hidden">
            <div className="px-2 pt-2 pb-3 space-y-1 sm:px-3 border-t border-primary/30">
              <Link
                href={getLocalizedPath("/")}
                onClick={() => setIsMenuOpen(false)}
                className="block px-3 py-2 text-base font-medium text-foreground hover:text-primary hover:bg-primary/20 rounded-lg transition-all duration-300"
              >
                {t("home")}
              </Link>
              <Link
                href={getLocalizedPath("/create")}
                onClick={() => setIsMenuOpen(false)}
                className="block px-3 py-2 text-base font-medium text-foreground hover:text-primary hover:bg-primary/20 rounded-lg transition-all duration-300"
              >
                {t("exploreVideo")}
              </Link>
              <Link
                href={getLocalizedPath("/pricing")}
                onClick={() => setIsMenuOpen(false)}
                className="block px-3 py-2 text-base font-medium text-foreground hover:text-primary hover:bg-primary/20 rounded-lg transition-all duration-300"
              >
                {t("pricing")}
              </Link>
              <div className="border-t border-primary/30 pt-4 space-y-2">
                {/* Auth Section Mobile */}
                {session ? (
                  <div className="space-y-2">
                    <div className="px-3 py-2 text-sm text-muted-foreground">
                      {session.user?.name || session.user?.email}
                    </div>
                    <Button variant="ghost" size="sm" className="w-full justify-start text-foreground hover:text-primary hover:bg-primary/20" asChild>
                      <Link href={getLocalizedPath("/profile")} onClick={() => setIsMenuOpen(false)}>
                        <User className="mr-2 h-4 w-4" />
                        {t("profile")}
                      </Link>
                    </Button>
                    <Button variant="ghost" size="sm" className="w-full justify-start text-foreground hover:text-primary hover:bg-primary/20" onClick={() => { handleSignOut(); setIsMenuOpen(false) }}>
                      <LogOut className="mr-2 h-4 w-4" />
                      {t("signOut")}
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Button variant="ghost" size="sm" className="w-full text-foreground hover:text-primary hover:bg-primary/20" onClick={() => {
                      setIsSignInDialogOpen(true)
                      setIsMenuOpen(false)
                    }}>
                      {t("signIn")}
                    </Button>
                    <Button className="w-full bg-primary text-primary-foreground hover:bg-primary/90 transition-all duration-300 cyber-glow" asChild>
                      <Link href={getLocalizedPath("/auth/signup")}>{t("signUp")}</Link>
                    </Button>
                  </div>
                )}

                {/* Controls Mobile */}
                <div className="flex items-center space-x-2 px-3 py-2">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-primary hover:bg-primary/20 transition-all duration-300">
                        <Globe className="h-4 w-4 mr-2 text-primary" />
                        {locale === "zh" ? "中" : "EN"}
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent className="bg-secondary border-primary/30">
                      <DropdownMenuItem onClick={() => switchLocale("zh")} className="text-foreground hover:bg-primary/20 hover:text-primary">中文</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => switchLocale("en")} className="text-foreground hover:bg-primary/20 hover:text-primary">English</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  {mounted && (
                    <Button variant="ghost" size="sm" onClick={toggleTheme} aria-label={t("toggleTheme")} className="text-muted-foreground hover:text-primary hover:bg-primary/20 transition-all duration-300">
                      <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0 text-primary" />
                      <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100 text-primary" />
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </nav>
    <SignInDialog open={isSignInDialogOpen} onOpenChange={setIsSignInDialogOpen} />
    </>
  )
}
