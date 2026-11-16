import { AppLogo, APP_NAME, APP_TAGLINE } from '@/components/shell/AppLogo'

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="auth">
      <div className="auth-card card">
        <div className="auth-brand">
          <AppLogo size={56} />
          <span className="auth-brand-text">
            <strong>{APP_NAME}</strong>
            <small>{APP_TAGLINE}</small>
          </span>
        </div>
        {children}
      </div>
      <p className="auth-footer">&copy; {new Date().getFullYear()} {APP_NAME}. Seluruh hak cipta dilindungi.</p>
    </div>
  )
}
