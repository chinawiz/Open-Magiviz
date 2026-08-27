"use client"

import { useState } from "react"
import { ChevronDown } from "lucide-react"
import { motion, AnimatePresence } from "motion/react"
import { useTranslations } from "next-intl"

const faqs = [
  {
    question: "questions.whatIsMeiHao.question",
    answer: "questions.whatIsMeiHao.answer",
  },
  {
    question: "questions.howToStart.question",
    answer: "questions.howToStart.answer",
  },
  {
    question: "questions.supportedFormats.question",
    answer: "questions.supportedFormats.answer",
  },
  {
    question: "questions.videoQuality.question",
    answer: "questions.videoQuality.answer",
  },
  {
    question: "questions.pricingPlans.question",
    answer: "questions.pricingPlans.answer",
  },
  {
    question: "questions.technicalSupport.question",
    answer: "questions.technicalSupport.answer",
  },
]

export function FAQSection() {
  const t = useTranslations("faq")
  const [openIndex, setOpenIndex] = useState<number | null>(0)

  return (
    <section className="py-24 bg-background" id="faq">
      <div className="max-w-3xl mx-auto px-8">
        <div className="text-center mb-16 space-y-4">
          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="font-headline text-4xl font-black tracking-tight text-foreground"
          >
            {t("title")}
          </motion.h2>
        </div>

        <div className="space-y-4">
          {faqs.map((faq, i) => (
            <div
              key={i}
              className="bg-secondary border border-border rounded-lg overflow-hidden"
            >
              <button
                onClick={() => setOpenIndex(openIndex === i ? null : i)}
                className="w-full p-6 flex justify-between items-center text-left hover:bg-border/50 transition-colors"
              >
                <h4 className="font-bold text-foreground">{t(faq.question)}</h4>
                <ChevronDown className={`text-primary transition-transform duration-300 ${openIndex === i ? "rotate-180" : ""}`} />
              </button>

              <AnimatePresence>
                {openIndex === i && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="p-6 pt-0 text-muted-foreground text-sm leading-relaxed">
                      {t(faq.answer)}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
