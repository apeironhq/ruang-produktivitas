import type { Metadata, Viewport } from 'next'
import { ToastProvider } from '@/components/ui/Toast'
import './globals.css'

export const metadata: Metadata = {
  title: { default: 'Ruang Produktivitas', template: '%s — Ruang Produktivitas' },
  description: 'Satu ruang untuk mencatat kegiatan, merencanakan tujuan, belajar, dan memantau pencapaian.',
  robots: { index: false, follow: false },
  appleWebApp: { capable: true, title: 'Ruang Produktivitas', statusBarStyle: 'default' },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#023047',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <head>
        {/* Font Ubuntu disajikan dari server sendiri — 2 bobot utama di-preload (sama dengan MDUNDIG). */}
        <link rel="preload" href="/fonts/ubuntu-400.woff" as="font" type="font/woff" crossOrigin="" />
        <link rel="preload" href="/fonts/ubuntu-500.woff" as="font" type="font/woff" crossOrigin="" />
      </head>
      <body>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  )
}
