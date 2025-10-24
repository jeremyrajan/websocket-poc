import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'WebSocket POC',
  description: 'Real-time game odds updates',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
