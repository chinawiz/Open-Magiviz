import type { Config } from "tailwindcss";

const config: Config = {
    darkMode: ["class"],
    content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "*.{js,ts,jsx,tsx,mdx}"
  ],
  theme: {
  	extend: {
  		fontFamily: {
  			// 标题字体：next/font 注入的 Manrope（拉丁），中文回退系统黑体栈
  			headline: ['var(--font-headline)', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'sans-serif'],
  			sans: ['-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Helvetica Neue', 'Arial', 'sans-serif']
  		},
  		colors: {
  			// 暖色调品牌配色
  			'peach': {
  				50: '#FFF9F5',  // 晨雾白
  				100: '#FFF2EB',
  				200: '#FFE4D1',
  				300: '#FFD0B0',
  				400: '#FFB380',
  				500: '#E6A37A', // 主色 - Migivit Peach
  				600: '#C98860', // Peach Dark
  				700: '#B3734A',
  				800: '#9D5E34',
  				900: '#87491E',
  			},
  			'warm': {
  				50: '#FEFCFA',  // 亚麻白
  				100: '#F2F0E6', // 标题文字
  				200: '#EBE5E0', // 米灰边框
  				300: '#A8A29E', // 暖灰
  				400: '#857F78', // 暖沙灰
  				500: '#4A4540', // 暖褐灰
  				600: '#2C2B29', // 深岩灰
  				700: '#201F1D', // 暖炭黑
  				800: '#1C1B1A', // 输入框底色
  				900: '#141312', // 更深背景
  			},
  			// 保留原有配色作为备用
  			'coral': {
  				50: '#FFF5F3',
  				100: '#FFE8E3',
  				200: '#FFD5CC',
  				300: '#FFB8A5',
  				400: '#FF9470',
  				500: '#FF7F50',
  				600: '#E6663A',
  				700: '#CC4D24',
  				800: '#B3330E',
  				900: '#991A00',
  			},
  			'almond': {
  				50: '#FEFCFA',
  				100: '#FAEBD7',
  				200: '#F5E6D3',
  				300: '#F0E1CF',
  				400: '#EBDCCB',
  				500: '#E6D7C7',
  				600: '#D1C2B3',
  				700: '#BCAD9F',
  				800: '#A7988B',
  				900: '#928377',
  			},
  			'charcoal': {
  				50: '#F5F5F5',
  				100: '#E8E8E8',
  				200: '#DBDBDB',
  				300: '#CECECE',
  				400: '#A8A8A8',
  				500: '#828282',
  				600: '#5C5C5C',
  				700: '#3C3C3C',
  				800: '#2A2A2A',
  				900: '#1A1A1A',
  			},
  			background: 'hsl(var(--background))',
  			foreground: 'hsl(var(--foreground))',
  			card: {
  				DEFAULT: 'hsl(var(--card))',
  				foreground: 'hsl(var(--card-foreground))'
  			},
  			popover: {
  				DEFAULT: 'hsl(var(--popover))',
  				foreground: 'hsl(var(--popover-foreground))'
  			},
  			primary: {
  				DEFAULT: 'hsl(var(--primary))',
  				foreground: 'hsl(var(--primary-foreground))'
  			},
  			secondary: {
  				DEFAULT: 'hsl(var(--secondary))',
  				foreground: 'hsl(var(--secondary-foreground))'
  			},
  			muted: {
  				DEFAULT: 'hsl(var(--muted))',
  				foreground: 'hsl(var(--muted-foreground))'
  			},
  			accent: {
  				DEFAULT: 'hsl(var(--accent))',
  				foreground: 'hsl(var(--accent-foreground))'
  			},
  			destructive: {
  				DEFAULT: 'hsl(var(--destructive))',
  				foreground: 'hsl(var(--destructive-foreground))'
  			},
  			success: {
  				DEFAULT: 'hsl(var(--success))',
  				foreground: 'hsl(var(--success-foreground))'
  			},
  			warning: {
  				DEFAULT: 'hsl(var(--warning))',
  				foreground: 'hsl(var(--warning-foreground))'
  			},
  			border: 'hsl(var(--border))',
  			input: 'hsl(var(--input))',
  			ring: 'hsl(var(--ring))',
  			chart: {
  				'1': 'hsl(var(--chart-1))',
  				'2': 'hsl(var(--chart-2))',
  				'3': 'hsl(var(--chart-3))',
  				'4': 'hsl(var(--chart-4))',
  				'5': 'hsl(var(--chart-5))'
  			},
  			sidebar: {
  				DEFAULT: 'hsl(var(--sidebar-background))',
  				foreground: 'hsl(var(--sidebar-foreground))',
  				primary: 'hsl(var(--sidebar-primary))',
  				'primary-foreground': 'hsl(var(--sidebar-primary-foreground))',
  				accent: 'hsl(var(--sidebar-accent))',
  				'accent-foreground': 'hsl(var(--sidebar-accent-foreground))',
  				border: 'hsl(var(--sidebar-border))',
  				ring: 'hsl(var(--sidebar-ring))'
  			}
  		},
  		borderRadius: {
  			lg: 'var(--radius)',
  			md: 'calc(var(--radius) - 2px)',
  			sm: 'calc(var(--radius) - 4px)'
  		},
  		keyframes: {
  			'accordion-down': {
  				from: {
  					height: '0'
  				},
  				to: {
  					height: 'var(--radix-accordion-content-height)'
  				}
  			},
  			'accordion-up': {
  				from: {
  					height: 'var(--radix-accordion-content-height)'
  				},
  				to: {
  					height: '0'
  				}
  			}
  		},
  		animation: {
  			'accordion-down': 'accordion-down 0.2s ease-out',
  			'accordion-up': 'accordion-up 0.2s ease-out'
  		}
  	}
  },
  plugins: [require("tailwindcss-animate")],
};
export default config;
