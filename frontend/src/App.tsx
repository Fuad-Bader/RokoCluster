import { useEffect } from 'react';
import { useStore } from './store/useStore';
import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { GraphView } from './components/GraphView';
import { DetailPanel } from './components/DetailPanel';
import { TerminalPanel } from './components/TerminalPanel';
import { ConnectModal } from './components/ConnectModal';

export default function App() {
  const connect = useStore((s) => s.connect);
  const showConnect = useStore((s) => s.showConnect);
  const statusLoaded = useStore((s) => s.statusLoaded);

  useEffect(() => {
    connect();
  }, [connect]);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-panel text-gray-100">
      <Header />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="relative flex min-w-0 flex-1 flex-col">
          <div className="relative min-h-0 flex-1">
            <GraphView />
          </div>
          <TerminalPanel />
        </main>
        <DetailPanel />
      </div>
      {statusLoaded && showConnect && <ConnectModal />}
    </div>
  );
}
