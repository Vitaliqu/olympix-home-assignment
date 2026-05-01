import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'RoundTripGuard — Live Exploit Demo',
  description:
    'Live replay of the $121M Balancer V2 compositional rounding exploit — side-by-side with the circuit breaker that stops it.',
  openGraph: {
    title: 'RoundTripGuard — Live Exploit Demo',
    description: 'Every swap is mathematically correct. The sequence drains the pool.',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen antialiased text-slate-100" style={{ background: '#020818' }}>
        {children}
      </body>
    </html>
  )
}
