import { Suspense, lazy } from "react";
import { HashRouter, Route, Routes, useLocation } from "react-router-dom";
import { useEffect } from "react";
import Footer from "./components/Footer";
import Header from "./components/Header";
import ModeBanner from "./components/ModeBanner";
import { Skeleton } from "./components/Shared";
import { SessionProvider } from "./state/session";
import { TxProvider } from "./state/tx";
import Gate from "./pages/Gate";

const Play = lazy(() => import("./pages/Play"));
const Chronicle = lazy(() => import("./pages/Chronicle"));
const Hall = lazy(() => import("./pages/Hall"));
const Vault = lazy(() => import("./pages/Vault"));
const Codex = lazy(() => import("./pages/Codex"));
const Keeper = lazy(() => import("./pages/Keeper"));

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [pathname]);
  return null;
}

function NotFound() {
  return (
    <div className="page py-24 text-center">
      <h1 className="display">Lost in the dark</h1>
      <p className="lede mx-auto mt-4">There is nothing at this address. Use the menu to find your way back.</p>
    </div>
  );
}

export default function App() {
  return (
    <HashRouter>
      <SessionProvider>
        <TxProvider>
          <ScrollToTop />
          <Header />
          <ModeBanner />
          <main id="main" className="relative z-10 min-h-[60vh]">
            <Suspense fallback={<div className="page py-16"><Skeleton className="h-64" /></div>}>
              <Routes>
                <Route path="/" element={<Gate />} />
                <Route path="/play" element={<Play />} />
                <Route path="/chronicle" element={<Chronicle />} />
                <Route path="/hall" element={<Hall />} />
                <Route path="/vault" element={<Vault />} />
                <Route path="/codex" element={<Codex />} />
                <Route path="/keeper" element={<Keeper />} />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
          </main>
          <Footer />
        </TxProvider>
      </SessionProvider>
    </HashRouter>
  );
}
