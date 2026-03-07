import { AppNav } from '@/components/AppNav';
import { OperationsDashboard } from '@/components/OperationsDashboard';

export default function OperationsPage() {
  return (
    <div data-component="src/app/operations/page" className="min-h-screen bg-mc-bg">
      <AppNav />
      <OperationsDashboard />
    </div>
  );
}
