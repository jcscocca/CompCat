import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { MapWorkspace } from "./components/MapWorkspace";

export default function App() {
  return (
    <AppErrorBoundary>
      <MapWorkspace />
    </AppErrorBoundary>
  );
}
