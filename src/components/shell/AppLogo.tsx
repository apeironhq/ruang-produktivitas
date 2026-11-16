import Image from 'next/image'

/**
 * Logo Ruang Produktivitas: kelinci Rupi yang memeluk huruf "R" dengan lintasan biru (public/logo.png,
 * latar transparan). Sama dengan ikon tab (src/app/icon.png) dan ikon aplikasi (src/app/apple-icon.png).
 */
export function AppLogo({ size = 32, className = '' }: { size?: number; className?: string }) {
  return (
    <Image src="/logo.png" alt="" aria-hidden="true" width={size} height={size} priority
      className={`block shrink-0 object-contain ${className}`} style={{ width: size, height: size }} />
  )
}

export const APP_NAME = 'Ruang Produktivitas'
export const APP_TAGLINE = 'Catat, rencanakan, capai'
