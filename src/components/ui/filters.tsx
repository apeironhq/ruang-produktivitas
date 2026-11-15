'use client'

import { Search } from 'lucide-react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useId, useRef, useState, useTransition } from 'react'

function useParamSetter() {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const [pending, start] = useTransition()
  function set(key: string, value: string) {
    const next = new URLSearchParams(params.toString())
    if (value) next.set(key, value)
    else next.delete(key)
    next.delete('hal')
    const qs = next.toString()
    start(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }))
  }
  return { set, params, pending }
}

/** Kolom pencarian yang memperbarui ?q= setelah berhenti mengetik 350 ms (SearchInput). */
export function SearchParamInput({ label, placeholder = 'Cari…', param = 'q' }: { label: string; placeholder?: string; param?: string }) {
  const { set, params } = useParamSetter()
  const [local, setLocal] = useState(params.get(param) ?? '')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const id = useId()
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  return (
    <div className="search">
      <label htmlFor={id} className="sr-only">{label}</label>
      <Search className="search-icon" size={16} aria-hidden="true" />
      <input id={id} className="input" type="search" placeholder={placeholder} autoComplete="off" value={local}
        onChange={(e) => {
          const v = e.target.value
          setLocal(v)
          if (timer.current) clearTimeout(timer.current)
          timer.current = setTimeout(() => set(param, v.trim()), 350)
        }} />
    </div>
  )
}

export function ParamSelect({ param, label, options, className = 'w-full sm:w-44' }: {
  param: string; label: string; options: Array<{ value: string; label: string }>; className?: string
}) {
  const { set, params } = useParamSetter()
  const id = useId()
  return (
    <div className={`shrink-0 ${className}`}>
      <label htmlFor={id} className="sr-only">{label}</label>
      <select id={id} className="select" value={params.get(param) ?? ''} onChange={(e) => set(param, e.target.value)}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  )
}
