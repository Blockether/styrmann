'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Settings, Save, ChevronLeft, Link as LinkIcon, Check, X, Wifi, WifiOff } from 'lucide-react';
import { getConfig, updateConfig, type MissionControlConfig } from '@/lib/config';

interface GatewayStatus {
  connected: boolean;
  url?: string;
  error?: string;
}

export default function SettingsPage() {
  const router = useRouter();
  const [config, setConfig] = useState<MissionControlConfig | null>(null);
  const [gatewayStatus, setGatewayStatus] = useState<GatewayStatus | null>(null);
  const [gatewayLoading, setGatewayLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setConfig(getConfig());
  }, []);

  useEffect(() => {
    async function fetchGatewayStatus() {
      setGatewayLoading(true);
      try {
        const res = await fetch('/api/openclaw/status');
        if (res.ok) {
          const data = await res.json();
          setGatewayStatus({
            connected: data.connected,
            url: data.url,
            error: data.error,
          });
        } else {
          setGatewayStatus({ connected: false, error: 'Failed to fetch status' });
        }
      } catch (err) {
        setGatewayStatus({ connected: false, error: err instanceof Error ? err.message : 'Connection failed' });
      } finally {
        setGatewayLoading(false);
      }
    }

    fetchGatewayStatus();
    const interval = setInterval(fetchGatewayStatus, 30000);
    return () => clearInterval(interval);
  }, []);

  const handleSave = async () => {
    if (!config) return;

    setIsSaving(true);
    setError(null);
    setSaveSuccess(false);

    try {
      updateConfig(config);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setIsSaving(false);
    }
  };

  const handleChange = (field: keyof MissionControlConfig, value: string) => {
    if (!config) return;
    setConfig({ ...config, [field]: value });
  };

  if (!config) {
    return (
      <div className="min-h-screen bg-mc-bg flex items-center justify-center">
        <div className="text-mc-text-secondary">Loading settings...</div>
      </div>
    );
  }

  return (
    <div data-component="src/app/settings/page" className="min-h-screen bg-mc-bg">
      <div className="border-b border-mc-border bg-mc-bg-secondary">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-center gap-3">
              <button
                onClick={() => router.push('/')}
                className="p-2 hover:bg-mc-bg-tertiary rounded text-mc-text-secondary flex items-center gap-1"
                title="Back to Blockether"
              >
                <ChevronLeft className="w-5 h-5" />
                <span className="hidden sm:inline">Back</span>
              </button>
              <Settings className="w-6 h-6 text-mc-accent" />
              <h1 className="text-xl sm:text-2xl font-bold text-mc-text">Settings</h1>
            </div>

            <button
              onClick={handleSave}
              disabled={isSaving}
              className="ml-9 sm:ml-0 px-4 py-2 bg-mc-accent text-white rounded hover:bg-mc-accent/90 flex items-center gap-2 disabled:opacity-50 text-sm"
            >
              <Save className="w-4 h-4" />
              {isSaving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-6 sm:py-8">
        {saveSuccess && (
          <div className="mb-6 p-4 bg-mc-accent-green/10 border border-mc-accent-green/30 rounded text-mc-accent-green flex items-center gap-2">
            <Check className="w-5 h-5" />
            Settings saved successfully
          </div>
        )}

        {error && (
          <div className="mb-6 p-4 bg-mc-accent-red/10 border border-mc-accent-red/30 rounded text-mc-accent-red flex items-center gap-2">
            <X className="w-5 h-5" />
            {error}
          </div>
        )}

        <section className="mb-6 p-4 sm:p-6 bg-mc-bg-secondary border border-mc-border rounded-lg">
          <div className="flex items-center gap-2 mb-4">
            <LinkIcon className="w-5 h-5 text-mc-accent" />
            <h2 className="text-lg sm:text-xl font-semibold text-mc-text">API Configuration</h2>
          </div>
          <p className="text-sm text-mc-text-secondary mb-4">
            Configure Blockether API URL for agent orchestration.
          </p>

          <div>
            <label className="block text-sm font-medium text-mc-text mb-2">
              Blockether URL
            </label>
            <input
              type="text"
              value={config.missionControlUrl}
              onChange={(e) => handleChange('missionControlUrl', e.target.value)}
              placeholder="http://localhost:4000"
              className="w-full px-4 py-2 bg-mc-bg border border-mc-border rounded text-mc-text focus:border-mc-accent focus:outline-none text-sm sm:text-base"
            />
            <p className="text-xs text-mc-text-secondary mt-1">
              URL where Blockether is running. Auto-detected by default. Change for remote access.
            </p>
          </div>
        </section>

        <section className="mb-6 p-4 sm:p-6 bg-mc-bg-secondary border border-mc-border rounded-lg">
          <div className="flex items-center gap-2 mb-4">
            {gatewayStatus?.connected ? (
              <Wifi className="w-5 h-5 text-mc-accent-green" />
            ) : (
              <WifiOff className="w-5 h-5 text-mc-accent-red" />
            )}
            <h2 className="text-lg sm:text-xl font-semibold text-mc-text">Gateway Status</h2>
          </div>

          {gatewayLoading ? (
            <div className="text-mc-text-secondary text-sm">Checking connection...</div>
          ) : gatewayStatus ? (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <span
                  className={`w-3 h-3 rounded-full ${
                    gatewayStatus.connected ? 'bg-mc-accent-green animate-pulse' : 'bg-mc-accent-red'
                  }`}
                />
                <span
                  className={`text-sm font-medium ${
                    gatewayStatus.connected ? 'text-mc-accent-green' : 'text-mc-accent-red'
                  }`}
                >
                  {gatewayStatus.connected ? 'Connected' : 'Disconnected'}
                </span>
              </div>

              {gatewayStatus.url && (
                <div className="text-sm">
                  <span className="text-mc-text-secondary">Gateway URL: </span>
                  <span className="text-mc-text font-mono">{gatewayStatus.url}</span>
                </div>
              )}

              {gatewayStatus.error && (
                <div className="text-sm">
                  <span className="text-mc-text-secondary">Error: </span>
                  <span className="text-mc-accent-red">{gatewayStatus.error}</span>
                </div>
              )}

              <p className="text-xs text-mc-text-secondary">
                Connection to OpenClaw Gateway for AI agent orchestration.
              </p>
            </div>
          ) : (
            <div className="text-mc-text-secondary text-sm">Unable to fetch gateway status</div>
          )}
        </section>

        <section className="p-4 sm:p-6 bg-mc-bg-tertiary border border-mc-border rounded-lg">
          <h3 className="text-base sm:text-lg font-semibold text-mc-text mb-2">
            Environment Variables
          </h3>
          <p className="text-sm text-mc-text-secondary mb-3">
            Some settings are configurable via environment variables in <code className="px-2 py-1 bg-mc-bg rounded text-xs">.env.local</code>:
          </p>
          <ul className="text-sm text-mc-text-secondary space-y-1 ml-4 list-disc">
            <li><code className="text-xs bg-mc-bg px-1 rounded">MISSION_CONTROL_URL</code> - API URL override</li>
            <li><code className="text-xs bg-mc-bg px-1 rounded">OPENCLAW_GATEWAY_URL</code> - Gateway WebSocket URL</li>
            <li><code className="text-xs bg-mc-bg px-1 rounded">OPENCLAW_GATEWAY_TOKEN</code> - Gateway auth token</li>
          </ul>
          <p className="text-xs text-mc-accent mt-3">
            Environment variables take precedence over UI settings for server-side operations.
          </p>
        </section>
      </div>
    </div>
  );
}
