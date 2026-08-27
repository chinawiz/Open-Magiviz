"use client"

import { useEffect } from "react"

import { Navbar } from "@/components/navbar"
import { Hero } from "@/components/hero"
import Features from "@/components/Features"
import { PricingSection } from "@/components/pricing-section"
import { FAQSection } from "@/components/faq-section"
import { Footer } from "@/components/footer"
import { PageBackground } from "@/components/page-background"

export default function ChinesePage() {
  useEffect(() => {
    // 处理URL中的锚点
    const hash = window.location.hash.replace('#', '')
    if (hash) {
      // 延迟滚动，确保页面完全加载
      setTimeout(() => {
        const element = document.getElementById(hash)
        if (element) {
          element.scrollIntoView({ behavior: "smooth" })
        }
      }, 100)
    }
  }, [])

  return (
    <PageBackground>

      <Navbar />
      <main>
        <Hero />
        <Features />
        <PricingSection />
        <FAQSection />
      </main>
      <Footer />
    </PageBackground>
  )
}
