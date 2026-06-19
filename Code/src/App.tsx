import React, { useState, useEffect } from "react";
import { ClaimInput, VerificationResult, EvaluationMetrics } from "./types.js";
import UploadSection from "./components/UploadSection.js";
import MetricsDashboard from "./components/MetricsDashboard.js";
import ClaimsList from "./components/ClaimsList.js";
import ClaimDetailPanel from "./components/ClaimDetailPanel.js";
import {
  ShieldAlert,
  ShieldCheck,
  Zap,
  Play,
  Download,
  Terminal,
  Activity,
  AlertCircle,
  HelpCircle,
  Cpu
} from "lucide-react";

export default function App() {
  const [claims, setClaims] = useState<ClaimInput[]>([]);
  const [results, setResults] = useState<VerificationResult[]>([]);
  const [selectedClaim, setSelectedClaim] = useState<ClaimInput | null>(null);
  const [metrics, setMetrics] = useState<EvaluationMetrics | null>(null);

  // States checking
  const [verifyingMap, setVerifyingMap] = useState<Record<string, boolean>>({});
  const [batchVerifying, setBatchVerifying] = useState(false);
  const [loading, setLoading] = useState(true);
  const [notification, setNotification] = useState<{ type: 'success' | 'warn' | 'error'; text: string; } | null>(null);

  // Load backend baseline
  const loadState = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/claims/list");
      const data = await res.json();
      if (res.ok && data.success) {
        setClaims(data.claims || []);
        setResults(data.results || []);

        if (data.claims && data.claims.length > 0) {
          setSelectedClaim(data.claims[0]);
        }
      }
    } catch (err) {
      console.error("Error loading baseline claims:", err);
      showNotice("error", "Failed to connect to the backend development server.");
    } finally {
      setLoading(false);
    }
  };

  // Calculate metrics
  const loadMetrics = async () => {
    try {
      const res = await fetch("/api/claims/metrics");
      const data = await res.json();
      if (res.ok && data.success) {
        setMetrics(data.metrics);
      }
    } catch (err) {
      console.error("Failed to load metrics scorecard:", err);
    }
  };

  useEffect(() => {
    loadState();
  }, []);

  useEffect(() => {
    if (results.length > 0) {
      loadMetrics();
    } else {
      setMetrics(null);
    }
  }, [results]);

  const showNotice = (type: 'success' | 'warn' | 'error', text: string) => {
    setNotification({ type, text });
    setTimeout(() => {
      setNotification(null);
    }, 5000);
  };

  // Reset or reload seed demo dataset
  const handleLoadSeeds = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/claims/seeds");
      const data = await res.json();
      if (res.ok && data.success) {
        setClaims(data.claims || []);
        setResults([]);
        setMetrics(null);
        if (data.claims && data.claims.length > 0) {
          setSelectedClaim(data.claims[0]);
        }
        showNotice("success", "Demo seed dataset loaded successfully!");
      }
    } catch {
      showNotice("error", "Failed to reload preset seeds.");
    } finally {
      setLoading(false);
    }
  };

  // Run AI review on singular claim
  const handleRunVerify = async (claimId: string) => {
    setVerifyingMap((prev) => ({ ...prev, [claimId]: true }));
    try {
      const res = await fetch("/api/claims/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claimId }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Verification request failed.");
      }

      // Merge results
      setResults((prev) => {
        const existingIdx = prev.findIndex((r) => r.claim_id === claimId);
        if (existingIdx !== -1) {
          const updated = [...prev];
          updated[existingIdx] = data.result;
          return updated;
        } else {
          return [...prev, data.result];
        }
      });

      showNotice("success", `Verification completed for Claim ${claimId}!`);
    } catch (err: any) {
      console.error(err);
      showNotice("error", err.message || `Failed to review Claim ${claimId}.`);
    } finally {
      setVerifyingMap((prev) => ({ ...prev, [claimId]: false }));
    }
  };

  // Run AI batch verify on entire file
  const handleRunBatchVerify = async () => {
    if (claims.length === 0) {
      showNotice("warn", "Please upload a claim archive or load seeds first.");
      return;
    }

    setBatchVerifying(true);
    showNotice("success", "Starting model verify batch. Processing each record directly...");

    try {
      const res = await fetch("/api/claims/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Batch verification failed.");
      }

      setResults(data.results || []);
      showNotice("success", `Batch metrics processed! Automated review complete for all ${data.resultsCount} claims!`);
    } catch (err: any) {
      console.error(err);
      showNotice("error", err.message || "Failed during batch claims verification.");
    } finally {
      setBatchVerifying(false);
    }
  };

  // Override manual values
  const handleOverride = async (updatedResult: VerificationResult) => {
    try {
      const res = await fetch("/api/claims/override", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updatedResult),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to submit override.");
      }

      // Update local state
      setResults((prev) => {
        return prev.map((r) => (r.claim_id === updatedResult.claim_id ? data.result : r));
      });

      showNotice("success", `Appended manual adjustment of Claim ${updatedResult.claim_id}!`);
    } catch (err: any) {
      showNotice("error", err.message);
    }
  };

  // Export results to output.csv
  const handleDownloadCsv = () => {
    if (results.length === 0) {
      showNotice("warn", "Verify claims with AI first to compile results.");
      return;
    }
    // direct redirect to backend endpoint
    window.location.href = "/api/claims/download-csv";
  };

  const handleUploadSuccess = (data: { claimsCount: number; imagesCount: number; claims: any[] }) => {
    setClaims(data.claims || []);
    setResults([]); // reset results
    setMetrics(null);
    if (data.claims && data.claims.length > 0) {
      setSelectedClaim(data.claims[0]);
    }
    showNotice("success", `Extracted claims file: Loaded ${data.claimsCount} claims!`);
  };

  // Active result map
  const activeResult = React.useMemo(() => {
    if (!selectedClaim) return null;
    return results.find((r) => r.claim_id === selectedClaim.claim_id) || null;
  }, [selectedClaim, results]);

  return (
    <div className="bg-slate-950 min-h-screen text-slate-300 antialiased font-sans flex flex-col justify-between selection:bg-indigo-500 selection:text-white">
      {/* Dynamic inline status notices */}
      {notification && (
        <div className="fixed top-5 right-5 z-50 animate-bounce">
          <div
            className={`px-5 py-3 rounded-lg border flex items-center gap-2 shadow-2xl backdrop-blur ${
              notification.type === "success"
                ? "bg-emerald-950/80 border-emerald-900 text-emerald-400"
                : notification.type === "warn"
                ? "bg-amber-950/80 border-amber-900 text-amber-400"
                : "bg-rose-950/80 border-rose-900 text-rose-400"
            }`}
          >
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span className="text-xs font-semibold">{notification.text}</span>
          </div>
        </div>
      )}

      {/* Primary Header */}
      <header className="border-b border-slate-900 bg-slate-950 px-6 py-4.5">
        <div className="max-w-7xl mx-auto flex justify-between items-center flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-indigo-600 text-white rounded-xl shadow-lg shadow-indigo-600/20">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-lg font-display font-bold text-slate-100 flex items-center gap-2 tracking-tight">
                Multi-Modal Evidence Review <span className="text-[10px] bg-indigo-950 border border-indigo-900/50 text-indigo-400 px-2 py-0.5 rounded-full font-bold font-mono">Agent v1.2</span>
              </h1>
              <p className="text-xs text-slate-500">
                Automated Claim Verification Hub | Claims Conversation & Image Integrity Pipeline
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleRunBatchVerify}
              disabled={batchVerifying || claims.length === 0}
              className="flex items-center gap-2 bg-indigo-950 hover:bg-indigo-900 border border-indigo-900 text-indigo-400 text-xs font-bold px-4 py-2 rounded-lg transition disabled:opacity-35"
            >
              {batchVerifying ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
                  Processing Claim Set...
                </>
              ) : (
                <>
                  <Zap className="w-3.5 h-3.5" /> Run Verification Batch
                </>
              )}
            </button>

            <button
              onClick={handleDownloadCsv}
              disabled={results.length === 0}
              className="flex items-center gap-2 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-200 text-xs font-bold px-4 py-2 rounded-lg transition disabled:opacity-35"
            >
              <Download className="w-3.5 h-3.5 text-indigo-400" /> Export Compiled output.csv
            </button>
          </div>
        </div>
      </header>

      {/* Main Container Content */}
      <main className="max-w-7xl w-full mx-auto p-4 sm:p-6 flex-1 space-y-6">
        {/* Upload Block */}
        <UploadSection onUploadSuccess={handleUploadSuccess} onLoadSeeds={handleLoadSeeds} />

        {/* Global Loading overlay */}
        {loading ? (
          <div className="flex flex-col items-center justify-center p-20 text-center">
            <div className="w-10 h-10 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mb-4" />
            <h3 className="text-sm font-semibold text-slate-300">Synchronizing pipeline assets...</h3>
            <p className="text-xs text-slate-500 mt-1">Downloading baseline claims profiles.</p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* KPI Performance Metrics Dashboard block */}
            <MetricsDashboard metrics={metrics} />

            {/* Pipeline detailed view */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              {/* Claims filter and table element */}
              <div className="lg:col-span-5 h-[650px]">
                <ClaimsList
                  claims={claims}
                  results={results}
                  onSelectClaim={setSelectedClaim}
                  selectedClaimId={selectedClaim ? selectedClaim.claim_id : null}
                />
              </div>

              {/* Claims details slider, visuals, chat logs, grounding justifications */}
              <div className="lg:col-span-7 h-[650px]">
                <ClaimDetailPanel
                  claim={selectedClaim}
                  result={activeResult}
                  onRunVerify={handleRunVerify}
                  onOverride={handleOverride}
                  verifyingMap={verifyingMap}
                />
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Global Margins footer */}
      <footer className="border-t border-slate-900 bg-slate-950 py-5 text-center mt-12">
        <div className="max-w-7xl mx-auto px-6 flex justify-between items-center text-[10px] text-slate-600 font-mono">
          <span>AI CLAIMS AUDITING AGENT SYSTEM</span>
          <div className="flex gap-1.5 items-center bg-slate-900 px-2 py-0.5 rounded border border-slate-800">
            <Terminal className="w-3.5 h-3.5 text-indigo-500" /> CWD: /app/applet
          </div>
        </div>
      </footer>
    </div>
  );
}
