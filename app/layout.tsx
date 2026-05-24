import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import Link from 'next/link';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'Allo Health - Real-Time Inventory & Checkout Reservation System',
  description: 'A premium, high-concurrency order fulfillment and stock reservation engine with Postgres pessimistic locking protection.',
  keywords: ['inventory', 'reservation', 'concurrency', 'e-commerce', 'postgres locking'],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col justify-between">
        {/* Premium Header */}
        <header className="glass-panel sticky top-0 z-50 border-b border-white/5 py-4 px-6 md:px-12 flex justify-between items-center transition-all duration-300">
          <div className="flex items-center space-x-3">
            <Link href="/" className="group flex items-center space-x-2">
              <div className="h-10 w-10 rounded-xl bg-gradient-to-tr from-indigo-500 via-purple-500 to-emerald-500 flex items-center justify-center shadow-lg group-hover:rotate-12 transition-transform duration-300">
                <span className="text-white font-extrabold text-lg tracking-wider">A</span>
              </div>
              <div className="flex flex-col">
                <span className="font-extrabold text-white text-xl tracking-tight leading-none group-hover:text-indigo-400 transition-colors">allo</span>
                <span className="text-[10px] text-emerald-400 font-bold uppercase tracking-widest mt-0.5">health engine</span>
              </div>
            </Link>
          </div>

          <div className="flex items-center space-x-4">
            {/* Live System Status Badges */}
            <div className="hidden sm:flex items-center space-x-2 text-[11px] font-semibold text-emerald-400 bg-emerald-950/45 px-3 py-1.5 rounded-full border border-emerald-900/50 shadow-inner">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
              <span>CONCURRENCY SHIELD ACTIVE</span>
            </div>
            
            <Link 
              href="/api/products" 
              target="_blank" 
              className="text-xs font-medium text-slate-400 hover:text-indigo-400 bg-white/5 hover:bg-white/10 border border-white/5 hover:border-indigo-500/20 px-3 py-1.5 rounded-lg transition-all"
              id="header-api-products-btn"
            >
              Browse API
            </Link>
          </div>
        </header>

        {/* Main Application Container */}
        <main className="flex-grow flex flex-col w-full max-w-7xl mx-auto px-4 md:px-8 py-8 md:py-12">
          {children}
        </main>

        {/* Footer */}
        <footer className="border-t border-white/5 py-6 px-6 md:px-12 text-center text-xs text-slate-500 bg-slate-950/20">
          <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center space-y-4 md:space-y-0">
            <p>&copy; 2026 Allo Health Inc. - Engineering Take-Home Assignment. All rights reserved.</p>
            <div className="flex space-x-6">
              <a href="#" className="hover:text-slate-400 transition-colors">System status</a>
              <a href="#" className="hover:text-slate-400 transition-colors">Terms of service</a>
              <a href="#" className="hover:text-slate-400 transition-colors">Documentation</a>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
