'use client';

import { useState, useEffect } from 'react';
import { Clock, ShieldCheck, XCircle, ArrowLeft, RotateCcw, Package, Landmark } from 'lucide-react';
import Link from 'next/link';

interface SerializedReservation {
  id: string;
  productId: string;
  productName: string;
  warehouseId: string;
  warehouseName: string;
  quantity: number;
  status: string;
  expiresAt: string;
}

export default function CheckoutClient({ reservation }: { reservation: SerializedReservation }) {
  const [status, setStatus] = useState<string>(reservation.status);
  const [timeLeft, setTimeLeft] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const expiresTime = new Date(reservation.expiresAt).getTime();

  // 1. Live Countdown Timer effect
  useEffect(() => {
    if (status !== 'PENDING') return;

    const updateTimer = () => {
      const diff = expiresTime - Date.now();
      if (diff <= 0) {
        setTimeLeft(0);
        setStatus('RELEASED'); // Transition UI status locally when expired
        setErrorMsg('410 Error: The 10-minute inventory reservation hold has expired.');
      } else {
        setTimeLeft(diff);
      }
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);

    return () => clearInterval(interval);
  }, [status, expiresTime]);

  // Format milliseconds to MM:SS
  const formatTime = (ms: number) => {
    if (ms <= 0) return '00:00';
    const totalSecs = Math.floor(ms / 1000);
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Calculate percentage of remaining time (starting from 10 minutes = 600,000 ms)
  const getPercentage = () => {
    const totalHold = 10 * 60 * 1000;
    return Math.min(100, Math.max(0, (timeLeft / totalHold) * 10000) / 100);
  };

  // 2. Handle Purchase Confirmation
  const handleConfirm = async () => {
    setLoading(true);
    setErrorMsg(null);
    const idempotencyKey = crypto.randomUUID();

    try {
      const res = await fetch(`/api/reservations/${reservation.id}/confirm`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
      });

      const data = await res.json();

      if (res.status === 200) {
        setStatus('CONFIRMED');
      } else if (res.status === 410) {
        setStatus('RELEASED');
        setErrorMsg('410 Reservation Expired: This checkout hold has timed out. The stock has been released back to other shoppers.');
      } else {
        setErrorMsg(data.message || 'An unexpected error occurred during confirmation.');
      }
    } catch {
      setErrorMsg('Network connectivity error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // 3. Handle Reservation Release (Cancellation)
  const handleCancel = async () => {
    setLoading(true);
    setErrorMsg(null);

    try {
      const res = await fetch(`/api/reservations/${reservation.id}/release`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const data = await res.json();

      if (res.ok) {
        setStatus('RELEASED');
      } else {
        setErrorMsg(data.message || 'Failed to release reservation.');
      }
    } catch {
      setErrorMsg('Network connectivity error.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto w-full">
      <Link 
        href="/" 
        className="inline-flex items-center space-x-2 text-xs font-semibold text-slate-400 hover:text-indigo-400 mb-6 transition-colors"
        id="back-to-shop-link"
      >
        <ArrowLeft className="h-4 w-4" />
        <span>Return to Shop</span>
      </Link>

      {/* Main Reservation Card */}
      <section className="glass-panel rounded-3xl p-8 md:p-12 relative overflow-hidden" id="checkout-container">
        
        {/* Glow accent */}
        <div className="absolute top-0 right-0 h-40 w-40 bg-indigo-500/10 rounded-full blur-3xl -z-10"></div>
        
        {/* State 1: Confirmed */}
        {status === 'CONFIRMED' && (
          <div className="text-center space-y-8 animate-fade-in" id="checkout-confirmed-panel">
            <div className="mx-auto h-20 w-20 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center badge-glow-green">
              <ShieldCheck className="h-10 w-10 text-emerald-400" />
            </div>
            
            <div className="space-y-3">
              <h2 className="text-3xl font-black text-white tracking-tight">Order Confirmed!</h2>
              <p className="text-slate-400 text-sm max-w-md mx-auto leading-relaxed">
                Payment verified. Your units have been permanently decremented from inventory and order fulfillment has commenced.
              </p>
            </div>

            {/* Receipt Summary */}
            <div className="bg-slate-950/40 border border-white/5 rounded-2xl p-6 text-left space-y-4">
              <span className="text-[10px] font-bold text-indigo-300 uppercase tracking-widest block border-b border-white/5 pb-2">
                Order Fulfillment Receipt
              </span>
              <div className="space-y-3 text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-500">Hold Token ID:</span>
                  <span className="text-slate-300 font-mono select-all">{reservation.id}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Product:</span>
                  <span className="text-slate-300 font-bold">{reservation.productName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Dispatched From:</span>
                  <span className="text-slate-300">{reservation.warehouseName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Quantity Decremented:</span>
                  <span className="text-indigo-400 font-black">{reservation.quantity} unit(s)</span>
                </div>
              </div>
            </div>

            <Link 
              href="/"
              className="inline-flex w-full justify-center items-center py-3.5 px-6 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black uppercase tracking-widest rounded-xl transition-all shadow-lg active:scale-95"
            >
              Order Another Product
            </Link>
          </div>
        )}

        {/* State 2: Released/Expired */}
        {status === 'RELEASED' && (
          <div className="text-center space-y-8" id="checkout-expired-panel">
            <div className="mx-auto h-20 w-20 rounded-full bg-rose-500/10 border border-rose-500/30 flex items-center justify-center badge-glow-red">
              <XCircle className="h-10 w-10 text-rose-400 animate-pulse" />
            </div>

            <div className="space-y-3">
              <h2 className="text-3xl font-black text-white tracking-tight">Hold Released</h2>
              <p className="text-slate-400 text-sm max-w-md mx-auto leading-relaxed">
                {errorMsg || 'This checkout hold reservation has been closed. The stock levels have been unlocked and returned to the active shopper pool.'}
              </p>
            </div>

            {/* Error Message Box */}
            <div className="bg-rose-950/20 border border-rose-500/10 rounded-2xl p-5 text-left text-xs text-rose-400 leading-relaxed">
              <strong>410 Status Registered:</strong> If payment was initiated late, it will automatically prompt a bank refund trigger. Please acquire a fresh inventory hold from the dashboard to re-attempt checkout.
            </div>

            <Link 
              href="/"
              className="inline-flex w-full justify-center items-center py-3.5 px-6 bg-slate-800 hover:bg-slate-700 text-white text-xs font-black uppercase tracking-widest rounded-xl transition-all border border-white/5 active:scale-95"
            >
              <RotateCcw className="h-4 w-4 mr-2" />
              <span>Back to Catalog</span>
            </Link>
          </div>
        )}

        {/* State 3: Pending Active Reservation */}
        {status === 'PENDING' && (
          <div className="space-y-8" id="checkout-pending-panel">
            
            {/* Countdown timer circle header */}
            <div className="flex flex-col items-center justify-center space-y-4">
              <div className="relative h-32 w-32 rounded-full border border-white/5 flex items-center justify-center bg-slate-950/40 animate-countdown-glow">
                
                {/* SVG Progress Ring */}
                <svg className="absolute top-0 left-0 h-full w-full -rotate-90">
                  <circle
                    cx="64"
                    cy="64"
                    r="58"
                    stroke="rgba(99, 102, 241, 0.15)"
                    strokeWidth="4"
                    fill="transparent"
                  />
                  <circle
                    cx="64"
                    cy="64"
                    r="58"
                    stroke={timeLeft < 60000 ? '#ef4444' : '#6366f1'}
                    strokeWidth="4"
                    fill="transparent"
                    strokeDasharray="364.4"
                    strokeDashoffset={364.4 - (364.4 * getPercentage()) / 100}
                    className="transition-all duration-1000 ease-linear"
                  />
                </svg>

                <div className="flex flex-col items-center">
                  <Clock className={`h-5 w-5 mb-1 ${timeLeft < 60000 ? 'text-rose-400 animate-bounce' : 'text-indigo-400'}`} />
                  <span className={`text-2xl font-black tracking-tight ${timeLeft < 60000 ? 'text-rose-400' : 'text-white'}`}>
                    {formatTime(timeLeft)}
                  </span>
                </div>
              </div>
              <span className="text-[10px] font-black text-indigo-300 uppercase tracking-widest bg-indigo-500/10 border border-indigo-500/15 px-3 py-1 rounded-full">
                Inventory Secured Hold
              </span>
            </div>

            {/* Error Message Box */}
            {errorMsg && (
              <div className="bg-rose-950/30 border border-rose-500/20 text-rose-400 text-xs px-4 py-3.5 rounded-xl flex items-center space-x-2 animate-soft-pulse">
                <XCircle className="h-4.5 w-4.5 flex-shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            {/* Order details description */}
            <div className="bg-slate-950/40 border border-white/5 rounded-2xl p-6 space-y-4">
              <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest border-b border-white/5 pb-2">
                Checkout Hold Summary
              </h3>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                <div className="space-y-1">
                  <span className="text-slate-500 block">Product secured:</span>
                  <span className="text-white font-bold inline-flex items-center">
                    <Package className="h-3.5 w-3.5 mr-1 text-slate-400" />
                    {reservation.productName}
                  </span>
                </div>
                <div className="space-y-1">
                  <span className="text-slate-500 block">Fulfillment Location:</span>
                  <span className="text-white font-bold inline-flex items-center">
                    <Landmark className="h-3.5 w-3.5 mr-1 text-slate-400" />
                    {reservation.warehouseName}
                  </span>
                </div>
                <div className="space-y-1">
                  <span className="text-slate-500 block">Quantity locked:</span>
                  <span className="text-indigo-400 font-extrabold">{reservation.quantity} unit(s)</span>
                </div>
                <div className="space-y-1">
                  <span className="text-slate-500 block">Hold Status:</span>
                  <span className="text-amber-400 font-bold">SECURED PENDING PAYMENT</span>
                </div>
              </div>
            </div>

            {/* Pay and Cancel Action buttons */}
            <div className="flex flex-col sm:flex-row gap-4">
              <button
                onClick={handleCancel}
                disabled={loading}
                className="w-full py-3.5 px-5 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-300 text-xs font-bold uppercase tracking-widest rounded-xl transition-all border border-white/5 active:scale-95"
                id="cancel-hold-btn"
              >
                Cancel Hold
              </button>
              <button
                onClick={handleConfirm}
                disabled={loading}
                className="w-full py-3.5 px-5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-xs font-black uppercase tracking-widest rounded-xl transition-all shadow-lg hover:shadow-indigo-500/20 active:scale-95"
                id="confirm-purchase-btn"
              >
                {loading ? 'Processing Transaction...' : 'Confirm & Pay Purchase'}
              </button>
            </div>
            
            <p className="text-[10px] text-center text-slate-500 max-w-sm mx-auto leading-relaxed">
              Note: Closing or leaving this tab will NOT release the hold immediately. The units will remain locked until the 10-minute timer fully expires, guaranteeing checkout security.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
