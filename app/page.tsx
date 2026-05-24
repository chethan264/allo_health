'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Package, ShieldAlert, Sparkles, RefreshCw, Layers, CheckCircle2 } from 'lucide-react';

interface StockLevel {
  warehouseId: string;
  warehouseName: string;
  totalUnits: number;
  reservedUnits: number;
  availableUnits: number;
}

interface Product {
  id: string;
  name: string;
  description: string;
  price: number;
  stockLevels: StockLevel[];
}

export default function HomePage() {
  const router = useRouter();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Selection states mapped by product ID
  const [selectedWarehouse, setSelectedWarehouse] = useState<Record<string, string>>({});
  const [quantity, setQuantity] = useState<Record<string, number>>({});
  
  // Action & notification states
  const [reservingId, setReservingId] = useState<string | null>(null);
  const [cronRunning, setCronRunning] = useState(false);
  const [notification, setNotification] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  // Fetch products data
  const fetchProducts = async () => {
    try {
      const res = await fetch('/api/products');
      if (!res.ok) throw new Error('Failed to fetch products catalog');
      const data = await res.json();
      setProducts(data);
      
      // Initialize default selections
      const defaultWarehouses: Record<string, string> = {};
      const defaultQuantities: Record<string, number> = {};
      
      data.forEach((p: Product) => {
        if (p.stockLevels.length > 0) {
          // Default to first warehouse with stock, or just first warehouse
          const withStock = p.stockLevels.find(sl => sl.availableUnits > 0);
          defaultWarehouses[p.id] = withStock?.warehouseId || p.stockLevels[0].warehouseId;
          defaultQuantities[p.id] = 1;
        }
      });
      
      setSelectedWarehouse(prev => ({ ...defaultWarehouses, ...prev }));
      setQuantity(prev => ({ ...defaultQuantities, ...prev }));
      setError(null);
    } catch (err: unknown) {
      console.warn('Error fetching products:', err instanceof Error ? err.message : err);
      const errorMessage = err instanceof Error ? err.message : '';
      setError(errorMessage || 'Something went wrong while fetching products.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchProducts();
  }, []);

  // Show auto-dismissing notifications
  const triggerNotification = (type: 'success' | 'error', message: string) => {
    setNotification({ type, message });
    setTimeout(() => {
      setNotification(null);
    }, 6000);
  };

  // Run Cron manual trigger
  const runCron = async () => {
    setCronRunning(true);
    try {
      const res = await fetch('/api/cron/cleanup', { method: 'POST' });
      const data = await res.json();
      triggerNotification('success', `Cron executed! Released ${data.releasedCount} expired hold(s) back to stock.`);
      await fetchProducts();
    } catch {
      triggerNotification('error', 'Failed to run background cron cleanup.');
    } finally {
      setCronRunning(false);
    }
  };

  // Handle unit reservation
  const handleReserve = async (productId: string) => {
    const whId = selectedWarehouse[productId];
    const qty = quantity[productId] || 1;
    
    if (!whId) {
      triggerNotification('error', 'Please select a valid warehouse.');
      return;
    }

    setReservingId(productId);
    
    // Generate fresh idempotency key for this attempt
    const idempotencyKey = crypto.randomUUID();

    try {
      const response = await fetch('/api/reservations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({
          productId,
          warehouseId: whId,
          quantity: qty,
        }),
      });

      const data = await response.json();

      if (response.status === 201) {
        // Success: Redirect to checkout reservation page
        triggerNotification('success', 'Hold successfully acquired! Redirecting to checkout...');
        setTimeout(() => {
          router.push(`/checkout/${data.reservation.id}`);
        }, 1000);
      } else if (response.status === 409) {
        // Concurrency/Stock conflict
        triggerNotification('error', `409 Conflict: ${data.message || 'Insufficient stock in selected warehouse!'}`);
        await fetchProducts(); // Refresh stock counts immediately
      } else {
        triggerNotification('error', `Error: ${data.error || 'Failed to acquire reservation.'}`);
      }
    } catch (err: unknown) {
      console.warn('Reservation error:', err instanceof Error ? err.message : err);
      triggerNotification('error', 'Network failure while attempting to acquire reservation.');
    } finally {
      setReservingId(null);
    }
  };

  return (
    <div className="space-y-12">
      {/* Toast Notification */}
      {notification && (
        <div 
          className={`fixed top-24 right-6 z-50 flex items-center space-x-3 px-6 py-4 rounded-xl glass-panel shadow-2xl transition-all duration-500 max-w-md animate-soft-pulse border ${
            notification.type === 'success' 
              ? 'border-emerald-500/30 text-emerald-400 badge-glow-green' 
              : 'border-rose-500/30 text-rose-400 badge-glow-red'
          }`}
          id="toast-notification"
        >
          {notification.type === 'success' ? (
            <CheckCircle2 className="h-6 w-6 flex-shrink-0" />
          ) : (
            <ShieldAlert className="h-6 w-6 flex-shrink-0" />
          )}
          <span className="text-sm font-semibold tracking-wide">{notification.message}</span>
        </div>
      )}

      {/* Hero Welcome banner */}
      <section className="text-center py-6 md:py-10 max-w-4xl mx-auto space-y-6">
        <div className="inline-flex items-center space-x-2 bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 px-4 py-1.5 rounded-full text-xs font-semibold tracking-wider">
          <Sparkles className="h-3.5 w-3.5" />
          <span>ON-CAMPUS DRIVE PROJECT SHOWCASE</span>
        </div>
        <h1 className="text-4xl md:text-6xl font-black text-white tracking-tight leading-tight">
          High-Concurrency <br/>
          <span className="bg-clip-text text-transparent bg-gradient-to-r from-indigo-400 via-purple-400 to-emerald-400">
            Inventory Hold Engine
          </span>
        </h1>
        <p className="text-base md:text-lg text-slate-400 max-w-2xl mx-auto font-normal leading-relaxed">
          Select products, select a fulfillment warehouse, and acquire temporary 10-minute checkout locks protected by atomic PostgreSQL database pessimistic write-row locks.
        </p>

        {/* Demo controls Panel */}
        <div className="flex flex-wrap justify-center gap-4 pt-4">
          <button 
            onClick={() => {
              setLoading(true);
              fetchProducts();
            }}
            className="flex items-center space-x-2 text-xs font-semibold text-white bg-slate-800 hover:bg-slate-700 border border-white/5 py-2.5 px-4 rounded-xl transition-all"
            id="refresh-catalog-btn"
          >
            <RefreshCw className="h-4 w-4" />
            <span>Refresh Inventory</span>
          </button>
          
          <button 
            onClick={runCron}
            disabled={cronRunning}
            className="flex items-center space-x-2 text-xs font-semibold text-white bg-indigo-600/90 hover:bg-indigo-600 border border-indigo-500/30 py-2.5 px-4 rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg hover:shadow-indigo-500/15"
            id="run-cron-btn"
          >
            <Layers className="h-4 w-4" />
            <span>{cronRunning ? 'Releasing Expired...' : 'Trigger Background Expiry Cron'}</span>
          </button>
        </div>
      </section>

      {/* Main Catalog Grid */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 space-y-4">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-indigo-500"></div>
          <span className="text-slate-500 text-sm font-semibold tracking-wide">Compiling database stock catalog...</span>
        </div>
      ) : error ? (
        <div className="max-w-2xl mx-auto glass-panel border border-rose-500/20 p-8 rounded-2xl flex flex-col items-center text-center space-y-4">
          <ShieldAlert className="h-12 w-12 text-rose-500 animate-bounce" />
          <h3 className="text-xl font-bold text-white">Data Connection Pending</h3>
          <p className="text-slate-400 text-sm leading-relaxed max-w-md">
            {error}. Make sure you have set up your hosted Postgres credentials in the <code>.env</code> file, run migrations, and seeded the tables!
          </p>
          <button 
            onClick={() => {
              setLoading(true);
              fetchProducts();
            }}
            className="px-5 py-2.5 bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold rounded-xl transition-all shadow-lg"
          >
            Retry DB Connection
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {products.map((product) => {
            const whId = selectedWarehouse[product.id];
            const activeSL = product.stockLevels.find(sl => sl.warehouseId === whId);
            const qty = quantity[product.id] || 1;
            const isOutOfStock = !activeSL || activeSL.availableUnits <= 0;

            return (
              <article key={product.id} className="glass-card rounded-2xl p-6 flex flex-col justify-between" id={`product-card-${product.id}`}>
                <div className="space-y-4">
                  {/* Title & Badge */}
                  <div className="flex justify-between items-start space-x-2">
                    <div className="p-2.5 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
                      <Package className="h-5 w-5" />
                    </div>
                    <span className="text-xl font-black text-white tracking-wide">
                      ₹{product.price.toLocaleString('en-IN')}
                    </span>
                  </div>

                  <div className="space-y-2">
                    <h3 className="text-lg font-bold text-white tracking-tight">{product.name}</h3>
                    <p className="text-xs text-slate-400 leading-relaxed min-h-[40px]">
                      {product.description}
                    </p>
                  </div>

                  <hr className="border-white/5" />

                  {/* Warehouse Selector */}
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-indigo-300 uppercase tracking-wider block">
                      Select Fulfillment Center
                    </label>
                    <select
                      value={whId}
                      onChange={(e) => setSelectedWarehouse(prev => ({ ...prev, [product.id]: e.target.value }))}
                      className="w-full bg-slate-900 border border-white/5 rounded-xl px-3 py-2.5 text-xs text-white focus:outline-none focus:border-indigo-500/50 cursor-pointer"
                      id={`warehouse-select-${product.id}`}
                    >
                      {product.stockLevels.map((sl) => (
                        <option key={sl.warehouseId} value={sl.warehouseId}>
                          {sl.warehouseName}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Stock Level Readout */}
                  <div className="bg-slate-950/40 rounded-xl p-3.5 border border-white/5 space-y-2.5">
                    <div className="flex justify-between text-[11px]">
                      <span className="text-slate-500 font-semibold uppercase">Physical Units:</span>
                      <span className="text-slate-300 font-bold">{activeSL?.totalUnits ?? 0} units</span>
                    </div>
                    <div className="flex justify-between text-[11px]">
                      <span className="text-slate-500 font-semibold uppercase">Pending Holds:</span>
                      <span className="text-amber-400 font-bold">{activeSL?.reservedUnits ?? 0} units</span>
                    </div>
                    <hr className="border-white/5" />
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-slate-400 font-bold uppercase tracking-wider">Available Pool:</span>
                      {isOutOfStock ? (
                        <span className="text-[10px] font-black text-rose-400 bg-rose-950/45 px-2.5 py-1 rounded-full border border-rose-900/50 badge-glow-red">
                          OUT OF STOCK
                        </span>
                      ) : (
                        <span className={`text-[10px] font-black px-2.5 py-1 rounded-full border ${
                          (activeSL?.availableUnits ?? 0) <= 5
                            ? 'text-amber-400 bg-amber-950/45 border-amber-900/50 badge-glow-yellow'
                            : 'text-emerald-400 bg-emerald-950/45 border-emerald-900/50 badge-glow-green'
                        }`}>
                          {activeSL?.availableUnits ?? 0} AVAILABLE
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Reservation controls */}
                <div className="space-y-4 pt-6">
                  {!isOutOfStock && (
                    <div className="flex items-center justify-between space-x-3">
                      <span className="text-[10px] font-bold text-indigo-300 uppercase tracking-wider">
                        Order Qty:
                      </span>
                      <div className="flex items-center space-x-2">
                        <button
                          disabled={qty <= 1}
                          onClick={() => setQuantity(prev => ({ ...prev, [product.id]: Math.max(1, qty - 1) }))}
                          className="h-8 w-8 rounded-lg bg-slate-800 hover:bg-slate-700 text-white flex items-center justify-center font-bold text-sm transition-all border border-white/5 disabled:opacity-30"
                        >
                          -
                        </button>
                        <span className="w-8 text-center text-sm font-bold text-white" id={`qty-display-${product.id}`}>{qty}</span>
                        <button
                          disabled={qty >= (activeSL?.availableUnits ?? 1)}
                          onClick={() => setQuantity(prev => ({ ...prev, [product.id]: qty + 1 }))}
                          className="h-8 w-8 rounded-lg bg-slate-800 hover:bg-slate-700 text-white flex items-center justify-center font-bold text-sm transition-all border border-white/5 disabled:opacity-30"
                        >
                          +
                        </button>
                      </div>
                    </div>
                  )}

                  <button
                    onClick={() => handleReserve(product.id)}
                    disabled={isOutOfStock || reservingId === product.id}
                    className={`w-full py-3 px-4 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${
                      isOutOfStock
                        ? 'bg-slate-800 text-slate-500 cursor-not-allowed border border-white/5'
                        : reservingId === product.id
                          ? 'bg-indigo-700 text-white/50 cursor-wait'
                          : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg hover:shadow-indigo-500/20 active:scale-95'
                    }`}
                    id={`reserve-btn-${product.id}`}
                  >
                    {isOutOfStock 
                      ? 'Sold Out in Warehouse' 
                      : reservingId === product.id
                        ? 'Acquiring Hold...' 
                        : 'Hold & Proceed to Checkout'}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
