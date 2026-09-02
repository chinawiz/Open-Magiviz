"use client"

import { useLocale } from 'next-intl'
import { Navbar } from "@/components/navbar"
import { Footer } from "@/components/footer"

export function TermsContent() {
  const locale = useLocale()
  const isZh = locale === 'zh'

  return (
    <div className="min-h-screen">
      <Navbar />
      <main className="container mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-4xl font-bold text-foreground mb-8">
            {isZh ? 'MeiHao 服务条款' : 'MeiHao Terms of Service'}
          </h1>
          <div className="prose prose-lg max-w-none">
            <p className="text-muted-foreground mb-8">
              {isZh ? '最后更新：2026年1月1日' : 'Last updated: January 1, 2026'}
            </p>
            
            <section className="mb-8">
              <h2 className="text-2xl font-semibold mb-4">
                {isZh ? '1. 服务说明' : '1. Service Description'}
              </h2>
              <p className="mb-4">
                {isZh
                  ? '欢迎使用MeiHao（"我们"、"我们的"或"本服务"）。MeiHao是一个AI驱动的智能视频创作平台，为用户提供从创意到成品的一键视频生成服务，支持好莱坞影视、动漫、故事剧情、广告、科普等各类视频内容。'
                  : 'Welcome to MeiHao ("we", "our", or "the service"). MeiHao is an AI-powered intelligent video creation platform that provides users with one-click video generation services from concept to finished product, supporting Hollywood films, anime, story plots, advertisements, educational videos, and more.'
                }
              </p>
              <p className="mb-4">
                {isZh 
                  ? '通过访问和使用我们的服务，您同意受本服务条款的约束。如果您不同意本条款的任何部分，请不要使用我们的服务。'
                  : 'By accessing and using our service, you agree to be bound by these Terms of Service. If you do not agree to any part of these terms, please do not use our service.'
                }
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-semibold mb-4">
                {isZh ? '2. 用户账户' : '2. User Accounts'}
              </h2>
              <p className="mb-4">
                {isZh 
                  ? '为了使用我们的服务，您需要创建一个账户。您必须提供准确、完整和最新的信息。您有责任保护您的账户安全，包括保护您的密码不被泄露。'
                  : 'To use our service, you need to create an account. You must provide accurate, complete, and up-to-date information. You are responsible for protecting your account security, including keeping your password confidential.'
                }
              </p>
              <ul className="list-disc list-inside mb-4 space-y-2">
                <li>{isZh ? '您必须年满18岁或在您所在司法管辖区的法定年龄' : 'You must be 18 years old or the legal age in your jurisdiction'}</li>
                <li>{isZh ? '每个用户只能拥有一个账户' : 'Each user can only have one account'}</li>
                <li>{isZh ? '您不得与他人共享您的账户' : 'You may not share your account with others'}</li>
                <li>{isZh ? '您有责任维护账户信息的准确性' : 'You are responsible for maintaining the accuracy of your account information'}</li>
              </ul>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-semibold mb-4">
                {isZh ? '3. AI视频创作服务使用规则' : '3. AI Video Creation Service Usage Rules'}
              </h2>
              <p className="mb-4">
                {isZh ? '我们的AI视频创作服务支持多种内容类型：' : 'Our AI video creation services support multiple content types:'}
              </p>
              <ul className="list-disc list-inside mb-4 space-y-2">
                <li>
                  <strong>{isZh ? '好莱坞影视' : 'Hollywood Films'}</strong>：
                  {isZh ? '专业级电影制作，支持复杂叙事和视觉特效' : 'Professional film production, supporting complex narratives and visual effects'}
                </li>
                <li>
                  <strong>{isZh ? '动漫内容' : 'Anime Content'}</strong>：
                  {isZh ? '日本风格动漫制作，支持各种题材和风格' : 'Japanese-style anime production, supporting various themes and styles'}
                </li>
                <li>
                  <strong>{isZh ? '故事剧情' : 'Story Plots'}</strong>：
                  {isZh ? '叙事性视频制作，适合教育和娱乐内容' : 'Narrative video production, suitable for educational and entertainment content'}
                </li>
                <li>
                  <strong>{isZh ? '广告视频' : 'Advertising Videos'}</strong>：
                  {isZh ? '商业广告制作，支持品牌宣传和产品推广' : 'Commercial advertisement production, supporting brand promotion and product marketing'}
                </li>
                <li>
                  <strong>{isZh ? '科普教育' : 'Educational Content'}</strong>：
                  {isZh ? '科学教育视频制作，提供准确的信息传递' : 'Science education video production, providing accurate information delivery'}
                </li>
              </ul>
              
              <h3 className="text-xl font-semibold mb-3">
                {isZh ? '使用限制' : 'Usage Restrictions'}
              </h3>
              <p className="mb-4">
                {isZh ? '在使用我们的AI视频创作服务时，您不得：' : 'When using our AI video creation services, you may not:'}
              </p>
              <ul className="list-disc list-inside mb-4 space-y-2">
                <li>{isZh ? '生成非法、有害、威胁、辱骂、诽谤或侵犯他人权利的视频内容' : 'Generate illegal, harmful, threatening, abusive, defamatory, or rights-infringing video content'}</li>
                <li>{isZh ? '生成虚假信息、误导性内容或有害的宣传材料' : 'Generate false information, misleading content, or harmful promotional materials'}</li>
                <li>{isZh ? '侵犯任何第三方的知识产权、肖像权或隐私权' : 'Infringe on any third party\'s intellectual property, right of publicity, or privacy rights'}</li>
                <li>{isZh ? '上传或使用包含仇恨言论、暴力、色情或其他不当内容的素材' : 'Upload or use materials containing hate speech, violence, pornography, or other inappropriate content'}</li>
                <li>{isZh ? '尝试逆向工程或破解我们的AI视频生成系统' : 'Attempt to reverse engineer or hack our AI video generation systems'}</li>
                <li>{isZh ? '超过您订阅计划的使用限制和积分额度' : 'Exceed the usage limits and credit allowances of your subscription plan'}</li>
                <li>{isZh ? '生成任何 NSFW（不适宜工作场所）、性暴露或色情内容，包括试图通过提示词技巧绕过内容安全审核' : 'Generate any NSFW (not-safe-for-work), sexually explicit, or pornographic content, including attempting to bypass content-safety checks through prompt manipulation'}</li>
                <li>{isZh ? '我们对所有生成请求执行自动化内容审核；违反上述规则可能导致内容移除、账户暂停或终止' : 'We run automated content moderation on all generation requests; violations may result in content removal, account suspension, or termination'}</li>
              </ul>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-semibold mb-4">
                {isZh ? '4. 内容所有权和知识产权' : '4. Content Ownership and Intellectual Property'}
              </h2>
              <p className="mb-4">
                <strong>{isZh ? '您的内容' : 'Your Content'}</strong>：
                {isZh ? '您保留对输入到我们AI视频创作平台中的原始内容、文本描述、图片素材等的所有权利。' : 'You retain all rights to the original content, text descriptions, image materials, and other inputs you provide to our AI video creation platform.'}
              </p>
              <p className="mb-4">
                <strong>{isZh ? 'AI生成视频' : 'AI Generated Videos'}</strong>：
                {isZh ? '通过我们的AI视频创作服务生成的视频版权归您所有。您可以自由使用、修改、分发、展示和商业化这些视频内容，用于个人或商业目的。' : 'The copyright of videos generated through our AI video creation service belongs to you. You may freely use, modify, distribute, display, and commercialize these video contents for personal or commercial purposes.'}
              </p>
              <p className="mb-4">
                <strong>{isZh ? '我们的知识产权' : 'Our Intellectual Property'}</strong>：
                {isZh ? 'MeiHao平台、AI视频生成模型、算法、界面设计和相关技术受知识产权法保护，归我们所有。' : 'The MeiHao platform, AI video generation models, algorithms, interface designs, and related technologies are protected by intellectual property laws and belong to us.'}
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-semibold mb-4">
                {isZh ? '5. 付费服务和退款' : '5. Paid Services and Refunds'}
              </h2>
              <p className="mb-4">
                {isZh ? '我们提供免费和付费的AI智能体服务。付费服务的具体条款包括：' : 'We offer both free and paid AI agent services. Specific terms for paid services include:'}
              </p>
              <ul className="list-disc list-inside mb-4 space-y-2">
                <li>{isZh ? '所有价格以美元计算，可能因增值税而有所调整' : 'All prices are calculated in US dollars and may be adjusted for VAT'}</li>
                <li>{isZh ? '订阅费用按月收取，自动续费' : 'Subscription fees are charged monthly with automatic renewal'}</li>
                <li>{isZh ? '您可以随时取消订阅，取消将在当前计费周期结束时生效' : 'You can cancel your subscription at any time, with cancellation taking effect at the end of the current billing cycle'}</li>
                <li>{isZh ? '我们提供7天无理由退款保证' : 'We offer a 7-day no-questions-asked refund guarantee'}</li>
                <li>{isZh ? '未使用的服务调用次数不会结转到下个计费周期' : 'Unused service calls do not roll over to the next billing cycle'}</li>
              </ul>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-semibold mb-4">
                {isZh ? '6. 服务可用性' : '6. Service Availability'}
              </h2>
              <p className="mb-4">
                {isZh
                  ? '我们努力保持AI视频创作服务的高可用性，但无法保证服务100%不间断。我们可能因AI模型更新、服务器维护、内容审核或其他技术原因暂停服务。我们会通过网站公告、邮件等方式提前通知用户计划中的维护和服务调整。'
                  : 'We strive to maintain high availability of our AI video creation services but cannot guarantee 100% uninterrupted service. We may suspend service for AI model updates, server maintenance, content moderation, or other technical reasons. We will notify users in advance of planned maintenance and service adjustments through website announcements, email, and other channels.'
                }
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-semibold mb-4">
                {isZh ? '7. 免责声明' : '7. Disclaimer'}
              </h2>
              <p className="mb-4">
                {isZh
                  ? '我们的AI视频创作服务按"现状"提供。我们不保证AI生成视频的质量、准确性、完整性或适用性。用户应在使用前对AI生成视频进行审查，并自行承担使用风险。'
                  : 'Our AI video creation services are provided "as is". We do not guarantee the quality, accuracy, completeness, or suitability of AI-generated videos. Users should review AI-generated videos before use and assume the risks of usage themselves.'
                }
              </p>
              <ul className="list-disc list-inside mb-4 space-y-2">
                <li>{isZh ? '我们不对AI生成视频的艺术质量、视觉效果或叙事完整性做任何保证' : 'We make no guarantees about the artistic quality, visual effects, or narrative completeness of AI-generated videos'}</li>
                <li>{isZh ? '我们不对因使用AI生成视频而产生的任何直接或间接损失负责' : 'We are not responsible for any direct or indirect losses arising from the use of AI-generated videos'}</li>
                <li>{isZh ? '我们不保证AI视频生成服务不会出现技术错误、中断或生成失败的情况' : 'We do not guarantee that the AI video generation service will be error-free, uninterrupted, or always successful in generation'}</li>
                <li>{isZh ? '用户应了解AI技术的局限性，生成内容可能需要人工调整和完善' : 'Users should understand the limitations of AI technology, and generated content may require manual adjustments and improvements'}</li>
              </ul>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-semibold mb-4">
                {isZh ? '8. 责任限制' : '8. Limitation of Liability'}
              </h2>
              <p className="mb-4">
                {isZh 
                  ? '在适用法律允许的最大范围内，我们对任何间接、偶然、特殊或后果性损害不承担责任。我们的总责任不超过您在过去12个月内支付给我们的费用。'
                  : 'To the maximum extent permitted by applicable law, we are not liable for any indirect, incidental, special, or consequential damages. Our total liability shall not exceed the fees you have paid to us in the past 12 months.'
                }
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-semibold mb-4">
                {isZh ? '9. 条款修改' : '9. Terms Modification'}
              </h2>
              <p className="mb-4">
                {isZh 
                  ? '我们保留随时修改本服务条款的权利。如有重大变更，我们会提前30天通知用户。继续使用服务即表示您接受修改后的条款。'
                  : 'We reserve the right to modify these Terms of Service at any time. For significant changes, we will notify users 30 days in advance. Continued use of the service indicates your acceptance of the modified terms.'
                }
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-semibold mb-4">
                {isZh ? '10. 法律适用' : '10. Governing Law'}
              </h2>
              <p className="mb-4">
                {isZh 
                  ? '本服务条款受中华人民共和国和美国法律管辖。因本条款产生的争议应通过友好协商解决，协商不成的，提交至有管辖权的人民法院或美国相关法院解决。'
                  : 'These Terms of Service are governed by the laws of the People\'s Republic of China and the United States. Disputes arising from these terms should be resolved through friendly negotiation. If negotiation fails, they shall be submitted to the competent People\'s Court or relevant US court for resolution.'
                }
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-semibold mb-4">
                {isZh ? '11. 联系我们' : '11. Contact Us'}
              </h2>
              <p className="mb-4">
                {isZh 
                  ? '如果您对本服务条款有任何疑问，请通过以下方式联系我们：'
                  : 'If you have any questions about these Terms of Service, please contact us through the following methods:'
                }
              </p>
              <ul className="list-disc list-inside mb-4 space-y-2">
                <li>{isZh ? '邮箱：support@mhhao.com' : 'Email: support@mhhao.com'}</li>
                <li>{isZh ? '网站：https://www.mhhao.com' : 'Website: https://www.mhhao.com'}</li>
              </ul>
            </section>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  )
} 