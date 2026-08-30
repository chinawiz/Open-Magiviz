import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { ThemeProvider } from "@/components/providers/theme-provider"
import { AuthSessionProvider } from "@/components/providers/session-provider"
import { Analytics } from "@/components/seo/analytics"
import './globals.css'


export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  // next-intl 的 middleware 会把当前 locale 写入请求头，据此在服务端输出 html lang
  const requestHeaders = await headers()
  const headerLocale = requestHeaders.get('x-next-intl-locale')
  const lang = headerLocale && ['en', 'zh'].includes(headerLocale) ? headerLocale : 'zh'

  return (
    <html lang={lang} suppressHydrationWarning>
      <body className="min-h-screen bg-background font-sans antialiased">
        <Analytics />
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem
          disableTransitionOnChange
        >
          <AuthSessionProvider>
            {children}
          </AuthSessionProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
