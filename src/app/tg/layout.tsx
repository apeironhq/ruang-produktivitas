import type { Metadata, Viewport } from 'next'
import './tg.css'

export const metadata: Metadata = { title: 'Rupi', description: 'Asisten Produktivitas Pribadimu — Ruang Produktivitas di Telegram.' }
export const viewport: Viewport = { width: 'device-width', initialScale: 1, maximumScale: 1, viewportFit: 'cover', themeColor: '#0d1729' }

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
