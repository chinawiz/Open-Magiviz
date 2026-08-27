"use client"

import { ArrowRight, PlayCircle, FileText, User, LayoutGrid, Video } from 'lucide-react'
import { motion } from 'motion/react'
import { useTranslations } from 'next-intl'

export function Hero() {
  const t = useTranslations("hero")

  return (
    <section className="hero-mesh relative overflow-hidden pt-16 pb-16 md:pt-24 md:pb-24 min-h-[80vh] flex items-center">
      <div className="max-w-7xl mx-auto px-8 w-full grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
        <motion.div
          initial={{ opacity: 0, x: -50 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.8 }}
          className="space-y-10"
        >
          <div className="inline-flex items-center gap-2.5 px-4 py-1.5 rounded-full bg-primary/10 text-primary font-headline text-[10px] font-black tracking-[0.2em] uppercase">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
            </span>
            {t("badge")}
          </div>

          <h1 className="font-headline text-5xl md:text-7xl font-black text-foreground leading-[1.1] tracking-tight">
            {t("titleLine1")}<br />
            <span className="text-primary italic brand-underline">{t("titleLine2")}</span>
          </h1>

          <p className="text-xl md:text-2xl text-foreground/70 leading-relaxed max-w-xl font-light">
            {t("description")}
          </p>

          <div className="flex flex-wrap gap-6 pt-4">
            <button
              onClick={() => window.location.href = '/create'}
              className="bg-primary text-white font-headline font-bold px-10 py-5 rounded-xl flex items-center gap-3 hover:translate-y-[-2px] transition-all shadow-xl shadow-primary/25 cursor-pointer"
            >
              {t("cta.primary")}
              <ArrowRight className="w-5 h-5" />
            </button>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 1, delay: 0.2 }}
          className="flex justify-center items-center"
        >
          <div className="w-full relative flex justify-center items-center py-12">
            <div className="grid grid-cols-3 md:grid-cols-3 gap-3 md:gap-6 relative z-10 w-full max-w-2xl mx-auto">
              {/* Step 1: Script */}
              <motion.div
                initial={{ rotate: -2, y: 0 }}
                whileHover={{ rotate: 0, y: -8 }}
                className="bg-card p-3 md:p-5 rounded-xl shadow-sm space-y-2 md:space-y-3 col-span-1 border border-border"
              >
                <div className="flex items-center justify-between">
                  <FileText className="text-primary w-4 h-4 md:w-5 md:h-5 fill-primary/20" />
                  <span className="hidden md:block text-[10px] font-bold font-headline text-primary bg-primary/10 px-2 py-0.5 rounded-full">{t("steps.script.label")}</span>
                </div>
                <div className="space-y-1 md:space-y-1.5">
                  <div className="h-1 md:h-1.5 w-full bg-muted dark:bg-primary/25 rounded-full"></div>
                  <div className="h-1 md:h-1.5 w-3/4 bg-muted dark:bg-primary/25 rounded-full"></div>
                  <div className="h-1 md:h-1.5 w-5/6 bg-muted dark:bg-primary/25 rounded-full"></div>
                  <div className="h-1 md:h-1.5 w-full bg-muted dark:bg-primary/25 rounded-full"></div>
                  <div className="h-1 md:h-1.5 w-2/3 bg-muted dark:bg-primary/25 rounded-full"></div>
                  <div className="h-1 md:h-1.5 w-4/5 bg-muted dark:bg-primary/25 rounded-full"></div>
                  <div className="h-1 md:h-1.5 w-full bg-muted dark:bg-primary/25 rounded-full"></div>
                  <div className="h-1 md:h-1.5 w-3/4 bg-muted dark:bg-primary/25 rounded-full"></div>
                  <div className="h-1 md:h-1.5 w-1/2 bg-muted dark:bg-primary/25 rounded-full"></div>
                  <div className="h-1 md:h-1.5 w-5/6 bg-muted dark:bg-primary/25 rounded-full"></div>
                </div>
                <p className="text-[8px] md:text-[10px] text-muted-foreground font-medium uppercase tracking-wider text-center md:text-left truncate">{t("steps.script.title")}</p>
              </motion.div>

              {/* Step 2: Character */}
              <motion.div
                initial={{ y: 0 }}
                whileHover={{ y: -8 }}
                className="bg-card p-3 md:p-5 rounded-xl shadow-sm space-y-2 md:space-y-3 col-span-1 border border-border"
              >
                <div className="flex items-center justify-between">
                  <User className="text-primary w-4 h-4 md:w-5 md:h-5 fill-primary/20" />
                  <span className="hidden md:block text-[10px] font-bold font-headline text-primary bg-primary/10 px-2 py-0.5 rounded-full">{t("steps.character.label")}</span>
                </div>
                <div className="relative w-full aspect-square rounded-lg bg-muted overflow-hidden">
                  <img
                    alt="Character Preview"
                    className="w-full h-full object-cover dark:grayscale dark:grayscale-0"
                    src="https://pub-61687a5706ad41cc97beea0f8a02afea.r2.dev/meihao/home/char_tanjiro-1773555549691.png"
                    referrerPolicy="no-referrer"
                  />
                </div>
                <p className="text-[8px] md:text-[10px] text-muted-foreground font-medium uppercase tracking-wider text-center md:text-left truncate">{t("steps.character.title")}</p>
              </motion.div>

              {/* Step 3: Storyboard */}
              <motion.div
                initial={{ rotate: 3, y: 0 }}
                whileHover={{ rotate: 0, y: -8 }}
                className="bg-card p-3 md:p-5 rounded-xl shadow-sm space-y-2 md:space-y-3 col-span-1 border border-border"
              >
                <div className="flex items-center justify-between">
                  <LayoutGrid className="text-primary w-4 h-4 md:w-5 md:h-5 fill-primary/20" />
                  <span className="hidden md:block text-[10px] font-bold font-headline text-primary bg-primary/10 px-2 py-0.5 rounded-full">{t("steps.grid.label")}</span>
                </div>
                <div className="grid grid-cols-1 gap-1.5 md:gap-2">
                  <div className="aspect-video bg-muted rounded-md overflow-hidden">
                    <img
                      alt="Grid 1"
                      className="w-full h-full object-cover opacity-80 mix-blend-multiply dark:mix-blend-normal"
                      src="https://pub-61687a5706ad41cc97beea0f8a02afea.r2.dev/meihao/home/1773556481535-96bgmfqehgd.png"
                      referrerPolicy="no-referrer"
                    />
                  </div>
                  <div className="aspect-video bg-muted rounded-md overflow-hidden">
                    <img
                      alt="Grid 2"
                      className="w-full h-full object-cover opacity-80 mix-blend-multiply dark:mix-blend-normal"
                      src="https://pub-61687a5706ad41cc97beea0f8a02afea.r2.dev/meihao/home/1773556472079-wopkkww8lal.png"
                      referrerPolicy="no-referrer"
                    />
                  </div>
                </div>
                <p className="text-[8px] md:text-[10px] text-muted-foreground font-medium uppercase tracking-wider text-center md:text-left truncate">{t("steps.grid.title")}</p>
              </motion.div>

              {/* Step 4: Scene Video */}
              <motion.div
                initial={{ y: 0 }}
                whileHover={{ y: -8 }}
                className="bg-card p-5 rounded-xl shadow-sm space-y-3 col-span-3 md:col-span-1 max-w-sm mx-auto w-full md:max-w-none border border-border"
              >
                <div className="flex items-center justify-between">
                  <Video className="text-primary w-5 h-5 fill-primary/20" />
                  <span className="text-[10px] font-bold font-headline text-primary bg-primary/10 px-2 py-0.5 rounded-full">{t("steps.rendering.label")}</span>
                </div>
                <div className="relative w-full aspect-video rounded-lg bg-stone-900 dark:bg-stone-800 overflow-hidden flex items-center justify-center">
                  <img
                    alt="Video Preview"
                    className="w-full h-full object-cover brightness-75"
                    src="https://pub-61687a5706ad41cc97beea0f8a02afea.r2.dev/meihao/home/1773556481535-96bgmfqehgd.png"
                    referrerPolicy="no-referrer"
                  />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <PlayCircle className="text-white w-8 h-8 fill-white/20" />
                  </div>
                </div>
                <div className="h-1 w-full bg-white/20 dark:bg-white/10 rounded-full overflow-hidden">
                  <div className="h-full w-2/3 bg-primary rounded-full"></div>
                </div>
                <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider text-center md:text-left">{t("steps.rendering.title")}</p>
              </motion.div>

              {/* Step 5: Final Render */}
              <motion.div
                initial={{ x: 0 }}
                whileHover={{ scale: 1.02 }}
                className="bg-stone-900 dark:bg-stone-800 p-2 rounded-2xl shadow-2xl col-span-3 md:col-span-2 max-w-sm mx-auto w-full md:max-w-none"
              >
                <div className="relative aspect-[21/9] rounded-xl overflow-hidden">
                  <img
                    alt="Final Render"
                    className="w-full h-full object-cover brightness-75"
                    src="https://pub-61687a5706ad41cc97beea0f8a02afea.r2.dev/meihao/home/1773556472079-wopkkww8lal.png"
                    referrerPolicy="no-referrer"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent"></div>
                  <div className="absolute bottom-4 left-4 right-4 flex justify-between items-end">
                    <div className="text-left">
                      <h4 className="text-white font-bold text-sm">{t("finalRender.title")}</h4>
                      <p className="text-white/60 text-[10px]">{t("finalRender.subtitle")}</p>
                    </div>
                    <span className="bg-primary text-white px-3 py-1 rounded-full text-[10px] font-bold">{t("finalRender.status")}</span>
                  </div>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <PlayCircle className="text-white w-12 h-12 fill-white/20 opacity-80" />
                  </div>
                </div>
              </motion.div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  )
}
