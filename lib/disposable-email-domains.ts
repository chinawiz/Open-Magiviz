/**
 * 一次性/临时邮箱域名黑名单（2026-08-30 定价重构·防薅第②层）。
 *
 * 免费层成本虽已压到 $0.21/号，但批量注册仍可静态刷分镜图与验卡薅成片额度，
 * 临时邮箱是最便宜的攻击面。本表覆盖主流一次性邮箱服务的根域；命中即拒绝注册。
 *
 * 维护约定：只收录确认为一次性邮箱服务的域名；误伤真实域名（如企业自有域）比
 * 放过几个薅羊毛号代价更高。新服务上线时追加根域即可（子域由后缀匹配覆盖）。
 */
const DISPOSABLE_EMAIL_DOMAINS: ReadonlySet<string> = new Set([
  // 10minutemail 系
  '10minutemail.com', '10minutemail.net', '10minutemail.co.uk', '20minutemail.com',
  // guerrillamail 系
  'guerrillamail.com', 'guerrillamail.net', 'guerrillamail.org', 'guerrillamail.biz',
  'guerrillamailblock.com', 'sharklasers.com', 'grr.la', 'guerrillamail.info',
  // temp-mail 系
  'temp-mail.org', 'temp-mail.io', 'temp-mail.ru', 'temp-mailo.com', 'tempmail.email',
  'tempmail.plus', 'tempmail.dev', 'tempmailo.com', 'tmpmail.org', 'tmpmail.net',
  'tempmailaddress.com', 'tempmail.dev.local',
  // mailinator 系
  'mailinator.com', 'mailinator.net', 'mailinator2.com', 'sogetthis.com',
  'reallymymail.com', 'binkmail.com', 'bobmail.info',
  // yopmail 系
  'yopmail.com', 'yopmail.net', 'yopmail.fr', 'cool.fr.nf', 'jetable.fr.nf',
  'nospam.ze.tc', 'nomail.xl.cx', 'mega.zik.dj',
  // throwaway 系
  'throwawaymail.com', 'throwam.com', 'trbvm.com', 'trbvn.com',
  'getnada.com', 'nada.email', 'dispostable.com', 'mailnesia.com',
  'mytrashmail.com', 'trashmail.com', 'trashmail.net', 'trash-mail.com',
  'trashmail.de', 'wegwerfmail.de', 'wegwerfmail.net', 'wegwerfmail.org',
  // adguard/emoil/fakeinbox 等
  'fakeinbox.com', 'fakemailgenerator.com', 'fake-mail.net', 'spam4.me',
  'spambog.com', 'spambog.de', 'spambog.ru', 'spamgourmet.com', 'spamhole.com',
  'mailexpire.com', 'moakt.com', 'mohmal.com', 'emailondeck.com',
  'email-fake.com', 'emailfake.com', 'fakemail.net', 'fakemailgenerator.net',
  // burner/mintemail 等
  'mintemail.com', 'burnermail.io', 'incognitomail.com', 'incognitomail.org',
  'jetable.org', 'kleemail.com', 'kurzepost.de', 'objectmail.com',
  'proxymail.eu', 'rcpt.at', 'trash2009.com', 'wetrainbayarea.com',
  'wh4f.org', 'wuzup.net', 'zoemail.net', 'zoemail.org',
  // 国产临时邮箱
  'linshiyouxiang.net', '24mail.chacuo.net', '027168.com', 'gedmail.com',
  'yzm.de', 'rootsh.com', 'telecom.space', 'xcv.dns-cloud.net',
  // 其他常见
  'maildrop.cc', 'mailcatch.com', 'mintemail.net', 'onetimemail.org',
  'spamavert.com', 'sneakemail.com', 'sofort-mail.de', 'byom.de',
  'discard.email', 'discardmail.com', 'harakirimail.com', 'inboxbear.com',
  'mailsac.com', 'inboxkitten.com', 'minuteinbox.com', 'tempinbox.com',
  'tempemail.co', 'tempemailaddress.com', 'nowmymail.com', 'mailtemp.net',
])

/** 邮箱域是否在一次性邮箱黑名单中（大小写不敏感；支持子域匹配根域） */
export function isDisposableEmail(email: string): boolean {
  const domain = email.trim().toLowerCase().split('@')[1]
  if (!domain) return false
  if (DISPOSABLE_EMAIL_DOMAINS.has(domain)) return true
  // 子域匹配：a.temp-mail.org 命中 temp-mail.org
  const parts = domain.split('.')
  for (let i = 1; i < parts.length - 1; i++) {
    if (DISPOSABLE_EMAIL_DOMAINS.has(parts.slice(i).join('.'))) return true
  }
  return false
}
