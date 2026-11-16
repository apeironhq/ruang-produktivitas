/**
 * Logo Ruang Produktivitas: kotak navy membulat (gaya logo MDUNDIG) berisi anak tangga naik
 * — langkah kecil yang konsisten — dengan titik sebagai tujuan/target. Sama dengan src/app/icon.svg.
 */
export function AppLogo({ size = 32, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className={`block shrink-0 ${className}`} aria-hidden="true" focusable="false">
      <rect width="32" height="32" rx="8" fill="#023047" />
      <path d="M7.5 23.5h5.2v-5.2h5.2v-5.2h5.6" fill="none" stroke="#8ecae6" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="23.6" cy="8.4" r="2.1" fill="#ffb703" />
    </svg>
  )
}

export const APP_NAME = 'Ruang Produktivitas'
export const APP_TAGLINE = 'Catat, rencanakan, capai'
