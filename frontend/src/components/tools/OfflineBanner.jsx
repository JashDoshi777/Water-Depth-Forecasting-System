import React from 'react';
import { WifiOff } from 'lucide-react';
import { useOnline } from '../../lib/notify';

export default function OfflineBanner() {
  const on = useOnline();
  if (on) return null;
  return <div className="tl-banner offline" role="status" data-testid="offline-banner"><WifiOff size={16} />You’re offline — showing last data</div>;
}
