import { Clapperboard, Sparkles, BookOpen, Megaphone, GraduationCap, Wand2, Film, Zap, Users, Play, Volume2, Maximize2 } from 'lucide-react';
import { motion } from 'motion/react';
import { useTranslations } from 'next-intl';

export default function Features() {
  const t = useTranslations("features")

  const categories = [
    { name: t("categories.hollywood"), icon: Clapperboard },
    { name: t("categories.anime"), icon: Sparkles },
    { name: t("categories.storyPlots"), icon: BookOpen },
    { name: t("categories.marketing"), icon: Megaphone },
    { name: t("categories.educational"), icon: GraduationCap },
  ];

  return (
    <section className="py-24 bg-background" id="features">
      <div className="max-w-7xl mx-auto px-8">
        <div className="text-center mb-16 space-y-6">
          <motion.h2 
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="font-headline text-4xl md:text-5xl font-black tracking-tight text-foreground"
          >
            {t("title")}
          </motion.h2>
          <motion.p 
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.1 }}
            className="text-muted-foreground max-w-2xl mx-auto text-lg"
          >
            {t("subtitle")}
          </motion.p>
          
          <div className="flex flex-wrap justify-center gap-3 pt-4">
            {categories.map((cat) => (
              <div 
                key={cat.name}
                className="flex items-center gap-2 px-5 py-2.5 bg-card rounded-full border border-border hover:border-primary/50 transition-all cursor-default group"
              >
                <cat.icon className="w-5 h-5 text-primary group-hover:scale-110 transition-transform" />
                <span className="text-sm font-bold text-foreground">{cat.name}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Feature Card 1 */}
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="md:col-span-2 bg-card rounded-xl p-10 flex flex-col justify-between overflow-hidden relative group border border-border"
          >
            <div className="relative z-10 space-y-4 max-w-md">
              <Wand2 className="text-primary w-10 h-10" />
              <h3 className="font-headline text-2xl font-bold">{t("cards.scripting.title")}</h3>
              <p className="text-muted-foreground">{t("cards.scripting.description")}</p>
            </div>
            <img 
              alt="Abstract AI Visual" 
              className="absolute top-0 right-0 w-1/2 h-full object-cover opacity-10 group-hover:scale-110 transition-transform duration-700" 
              src="https://pub-61687a5706ad41cc97beea0f8a02afea.r2.dev/meihao/home/unnamed.png"
              referrerPolicy="no-referrer"
            />
          </motion.div>

          {/* Feature Card 2 */}
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.1 }}
            className="bg-primary text-primary-foreground rounded-xl p-10 space-y-6 shadow-lg shadow-primary/20"
          >
            <Users className="w-10 h-10" />
            <h3 className="font-headline text-2xl font-bold">{t("cards.character.title")}</h3>
            <p className="opacity-90">{t("cards.character.description")}</p>
          </motion.div>

          {/* Feature Card 3 */}
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.2 }}
            className="bg-secondary rounded-xl p-10 space-y-6 border border-border"
          >
            <Film className="text-primary w-10 h-10" />
            <h3 className="font-headline text-2xl font-bold">{t("cards.format.title")}</h3>
            <p className="text-muted-foreground">{t("cards.format.description")}</p>
          </motion.div>

          {/* Feature Card 4 */}
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.3 }}
            className="md:col-span-2 bg-card rounded-xl p-10 flex flex-col md:flex-row gap-8 items-center border border-border"
          >
            <div className="space-y-4">
              <Zap className="text-primary w-10 h-10" />
              <h3 className="font-headline text-2xl font-bold">{t("cards.rendering.title")}</h3>
              <p className="text-muted-foreground">{t("cards.rendering.description")}</p>
            </div>
            <div className="w-full md:w-1/2 bg-secondary rounded-lg p-8 border border-border relative overflow-hidden group/render">
              <div className="aspect-video bg-foreground/10 rounded-md flex items-center justify-center relative">
                <Play className="w-12 h-12 text-primary opacity-70 group-hover/render:scale-110 transition-transform" />
                <div className="absolute bottom-3 left-3 right-3 flex justify-between items-center">
                  <div className="flex gap-2">
                    <div className="w-8 h-1 bg-primary/60 rounded-full"></div>
                    <div className="w-12 h-1 bg-primary/40 rounded-full"></div>
                  </div>
                  <Volume2 className="w-4 h-4 text-primary/60" />
                </div>
              </div>
              <div className="mt-4 flex gap-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="flex-1 h-12 bg-primary/15 rounded border border-primary/25 flex items-center justify-center">
                    <Film className="w-4 h-4 text-primary/50" />
                  </div>
                ))}
              </div>
              <Maximize2 className="absolute top-4 right-4 w-4 h-4 text-primary/50" />
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
