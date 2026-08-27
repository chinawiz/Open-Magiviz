import { Quote } from 'lucide-react';
import { motion } from 'motion/react';
import { useTranslations } from 'next-intl';

const AVATAR_MAP: Record<string, string> = {
  'Marcus Thorne': 'https://pub-61687a5706ad41cc97beea0f8a02afea.r2.dev/meihao/home/Marcus-Thorne.jpg',
  'Elena Rossi': 'https://pub-61687a5706ad41cc97beea0f8a02afea.r2.dev/meihao/home/Elena-Rossi.jpg',
  'Sarah Jenkins': 'https://pub-61687a5706ad41cc97beea0f8a02afea.r2.dev/meihao/home/Sarah-Jenkins.jpg',
};

export function Testimonials() {
  const t = useTranslations('testimonials');

  return (
    <section className="py-32 bg-background relative overflow-hidden" id="testimonials">
      <div className="absolute top-0 right-0 -translate-y-1/2 translate-x-1/2 w-[500px] h-[500px] bg-primary/5 rounded-full blur-[120px]"></div>
      <div className="absolute bottom-0 left-0 translate-y-1/2 -translate-x-1/2 w-[500px] h-[500px] bg-primary/5 rounded-full blur-[120px]"></div>

      <div className="max-w-7xl mx-auto px-8 relative">
        <div className="mb-20 space-y-4 max-w-3xl">
          <div className="flex items-center gap-4">
            <div className="h-px w-12 bg-primary"></div>
            <span className="font-headline font-bold text-sm text-primary uppercase tracking-[0.3em]">{t('sectionLabel')}</span>
          </div>
          <h2 className="font-headline text-5xl md:text-6xl font-black tracking-tight text-foreground leading-none">
            {t('sectionTitle', { visionaries: t('visionaries') })}
          </h2>
          <p className="text-xl text-muted-foreground leading-relaxed font-light">
            {t('sectionDescription')}
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 items-start">
          {t.raw('items').map((item: { quote: string; author: string; role: string; highlight: string; featured?: boolean }, i: number) => (
            <motion.div
              key={item.author}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.1 }}
              className={`p-10 rounded-[2rem] border border-border shadow-[0_20px_50px_rgba(0,0,0,0.03)] flex flex-col transition-all duration-500 hover:-translate-y-2 ${
                item.featured ? 'bg-card md:mt-16' : 'bg-card/70 backdrop-blur-xl'
              }`}
            >
              <Quote className="text-primary/40 w-12 h-12 mb-6" />
              <blockquote className="mb-10">
                <p className="font-headline text-2xl font-bold text-foreground leading-snug tracking-tight">
                  "{item.quote.split(item.highlight)[0]}<span className={item.featured ? 'italic text-primary' : 'text-primary'}>{item.highlight}</span>{item.quote.split(item.highlight)[1]}"
                </p>
              </blockquote>
              <div className="flex items-center gap-4 mt-auto">
                <div className="relative group">
                  <div className="absolute inset-0 bg-primary/20 rounded-full blur-sm group-hover:blur-md transition-all"></div>
                  <div className="relative w-14 h-14 rounded-full bg-secondary flex items-center justify-center overflow-hidden border-2 border-card shadow-sm">
                    <img
                      src={AVATAR_MAP[item.author]}
                      alt={item.author}
                      className="w-full h-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                  </div>
                </div>
                <div>
                  <div className="font-headline font-black text-lg text-foreground tracking-tight">{item.author}</div>
                  <div className="text-xs font-bold text-primary/80 uppercase tracking-widest leading-none mt-1">{item.role}</div>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
