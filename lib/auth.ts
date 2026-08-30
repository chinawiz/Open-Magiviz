import { NextAuthOptions } from 'next-auth'
import { DrizzleAdapter } from '@auth/drizzle-adapter'
import type { AdapterAccount } from 'next-auth/adapters'
import { db } from '@/lib/db'
import { users, accounts, sessions, verificationTokens } from '@/lib/schema'
import { and, eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { giveRegisterBonus } from '@/lib/points'
import {
  findAffiliateByCode,
  getOrCreateAffiliateProfile,
  createAffiliateRelation,
} from '@/lib/affiliate'
import { cookies } from 'next/headers'
import GitHubProvider from 'next-auth/providers/github'
import GoogleProvider from 'next-auth/providers/google'
import CredentialsProvider from 'next-auth/providers/credentials'
import bcrypt from 'bcryptjs'

// 扩展NextAuth类型（订阅计划/角色等业务字段统一在此声明，避免各处以 as 断言访问）
declare module "next-auth" {
  interface Session {
    user: {
      id: string
      name?: string | null
      email?: string | null
      image?: string | null
      subscriptionPlan?: string | null
      role?: string | null
    }
  }
}

// linkAccount 的 account 参数不含归属用户信息；NextAuth 调用时序保证此前刚执行过
// getUserByAccount(未命中) → createUser/getUserByEmail（命中目标用户），用实例级变量传递。
let _lastResolvedUser: { id: string; email: string } | null = null

export const authOptions: NextAuthOptions = {
  adapter: {
    ...DrizzleAdapter(db, {
      usersTable: users,
      accountsTable: accounts,
      sessionsTable: sessions,
      verificationTokensTable: verificationTokens,
    }),

    async getUserByAccount({ provider, providerAccountId }: { provider: string; providerAccountId: string }) {
      const row = await db.query.accounts.findFirst({
        where: and(
          eq(accounts.provider, provider),
          eq(accounts.providerAccountId, providerAccountId)
        ),
      })
      if (!row) return null
      return db.query.users.findFirst({ where: eq(users.id, row.userId) }) as any
    },

    async getUserByEmail(email: string) {
      const user = await db.query.users.findFirst({ where: eq(users.email, email) })
      if (user) _lastResolvedUser = { id: user.id, email: user.email }
      return (user as any) ?? null
    },

    // 修复 Google 登录：官方 DrizzleAdapter 的 linkAccount 生成的 INSERT 把 userId
    // 留给数据库默认值（serial 假设），而本项目 accounts.userId 是 text 非空无默认 →
    // 插入抛错导致 OAuthAccountNotLinked 回登录页。
    // 定位用户不依赖请求间状态（serverless 多实例不可靠）：优先从 id_token 解 email
    // （Google 已完成认证，payload 可信），其次回退最近的 getUserByEmail 结果。
    async linkAccount(account: AdapterAccount) {
      let email: string | null = null
      if (account.id_token) {
        try {
          const payload = JSON.parse(Buffer.from(account.id_token.split('.')[1], 'base64').toString('utf-8'))
          if (payload.email && typeof payload.email === 'string') email = payload.email
        } catch { /* 解析失败走回退 */ }
      }
      if (!email && _lastResolvedUser) email = _lastResolvedUser.email
      if (!email) throw new Error('linkAccount: 无法确定归属用户邮箱')

      const user = await db.query.users.findFirst({ where: eq(users.email, email) })
      if (!user) throw new Error(`linkAccount: 用户不存在 ${email}`)

      await db.insert(accounts).values({
        userId: user.id,
        type: account.type,
        provider: account.provider,
        providerAccountId: account.providerAccountId,
        refresh_token: account.refresh_token ?? undefined,
        access_token: account.access_token ?? undefined,
        expires_at: account.expires_at ?? undefined,
        token_type: account.token_type ?? undefined,
        scope: account.scope ?? undefined,
        id_token: account.id_token ?? undefined,
        session_state: (account as AdapterAccount & { session_state?: string }).session_state,
      })
      return
    },

    async createUser(user: {
      name?: string | null
      email: string
      emailVerified?: Date | null
      image?: string | null
    }) {
      try {
        const id = nanoid()
        
        console.log('创建新用户开始:', {
          id,
          name: user.name,
          email: user.email,
          emailVerified: user.emailVerified,
          hasImage: !!user.image
        })
        
        // 对于OAuth登录，如果没有邮箱，生成一个临时邮箱
        let userEmail = user.email
        if (!userEmail) {
          userEmail = `${id}@oauth.local`
          console.log('生成临时邮箱:', userEmail)
        }
        
        // 检查邮箱是否已存在
        const existingUser = await db.query.users.findFirst({
          where: eq(users.email, userEmail)
        })
        
        if (existingUser) {
          console.log('邮箱已存在，返回现有用户:', existingUser.id)
          _lastResolvedUser = { id: existingUser.id, email: existingUser.email }
          return existingUser
        }
        
        console.log('插入新用户到数据库...')
        const newUser = await db.insert(users).values({
          id,
          name: user.name,
          email: userEmail,
          emailVerified: user.emailVerified || new Date(), // OAuth用户自动验证邮箱
          image: user.image,
        }).returning()
        
        console.log('数据库插入成功:', newUser[0])
        _lastResolvedUser = { id: newUser[0].id, email: newUser[0].email }
        
        // 为新用户赠送注册积分
        try {
          await giveRegisterBonus(id)
          console.log(`新用户 ${id} 通过第三方登录注册成功，已赠送注册积分`)
        } catch (pointsError) {
          console.error('第三方注册赠送积分失败:', pointsError)
          // 积分赠送失败不影响用户创建流程
        }
        
        // ========== 处理推广返利系统（完全独立于推荐系统） ==========
        // 从 Cookie 中读取推广码（?aff={affiliateCode}）
        try {
          const cookieStore = await cookies()
          const affiliateCodeFromCookie = cookieStore.get('aff')?.value

          if (affiliateCodeFromCookie) {
            // 查找推广人
            const affiliateInfo = await findAffiliateByCode(affiliateCodeFromCookie.trim())
            
            if (affiliateInfo) {
              // 确保推广人资料存在
              const affiliateProfileId = await getOrCreateAffiliateProfile(affiliateInfo.userId)
              
              // 创建推广关系（30天有效期）
              await createAffiliateRelation(affiliateProfileId, id)
              
              console.log(`新用户 ${id} 通过第三方登录注册成功，已创建推广关系`)
            }
          }
        } catch (affiliateError) {
          console.error('第三方注册处理推广关系失败:', affiliateError)
          // 推广关系处理失败不影响用户创建流程
        }
        
        return newUser[0]
      } catch (error) {
        console.error('创建用户失败:', error)
        console.error('用户创建错误详情:', {
          message: error instanceof Error ? error.message : '未知错误',
          stack: error instanceof Error ? error.stack : undefined,
          userData: {
            name: user.name,
            email: user.email,
            hasImage: !!user.image
          }
        })
        throw error
      }
    }
  },
  providers: [
    GitHubProvider({
      clientId: process.env.GITHUB_ID!,
      clientSecret: process.env.GITHUB_SECRET!,
    }),
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' }
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null
        }

        const user = await db.query.users.findFirst({
          where: eq(users.email, credentials.email)
        })

        if (!user || !user.password) {
          return null
        }

        // 检查邮箱是否已验证
        if (!user.emailVerified) {
          // 抛出错误让 NextAuth 显示自定义错误消息
          const error = new Error('EmailNotVerified') as Error & { code?: string }
          error.code = 'EmailNotVerified'
          throw error
        }

        const isPasswordValid = await bcrypt.compare(
          credentials.password,
          user.password
        )

        if (!isPasswordValid) {
          return null
        }

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
        }
      }
    }),
  ],
  session: {
    strategy: 'jwt'
  },
  callbacks: {
    async jwt({ token, user, account }) {
      if (user) {
        token.id = user.id
      }
      if (account) {
        token.provider = account.provider
      }
      return token
    },
    async session({ session, token }) {
      if (token && session.user) {
        session.user.id = token.id as string
      }
      return session
    },
    // OAuthAccountNotLinked 修复：该项目 chinawiz@gmail.com 等存量用户由【注册表单】创建，
    // 无 OAuth 绑定。Google 首登时按 email 匹配到存量用户后，NextAuth 默认安全策略会因
    // "该 OAuth 账号未与任何用户关联且未走 createUser 流程" 抛 OAuthAccountNotLinked。
    // 显式在 signIn 回调放行 OAuth（adapter.linkAccount 已覆盖为显式 userId 写入）。
    async signIn({ user, account, profile }) {
      try {
        console.log('OAuth登录回调开始:', {
          provider: account?.provider,
          userId: user.id,
          userName: user.name,
          userEmail: user.email,
          hasImage: !!user.image
        })
        
        // 对于OAuth提供商，自动验证邮箱
        if (account && account.provider !== 'credentials') {
          console.log(`用户通过 ${account.provider} 登录:`, {
            id: user.id,
            name: user.name,
            email: user.email,
            provider: account.provider
          })
          
          return true
        }
        return true
      } catch (err) {
        console.error('登录回调错误:', err)
        console.error('回调错误详情:', {
          message: err instanceof Error ? err.message : '未知错误',
          stack: err instanceof Error ? err.stack : undefined,
          provider: account?.provider,
          userId: user?.id,
          userName: user?.name,
          userEmail: user?.email
        })
        return false
      }
    }
  },
  pages: {
    signIn: '/auth/signin',
    error: '/auth/error',
  },
  secret: process.env.NEXTAUTH_SECRET,
  debug: false, // 2026-08-30 关闭：debug=true 会在生产日志打印 email/OAuth 细节（OAuth 回调已验证通过）
}