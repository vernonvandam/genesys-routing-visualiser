import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import ApiClient from 'purecloud-platform-client-v2/src/purecloud-platform-client-v2/ApiClient.js';
import OrganizationApi from 'purecloud-platform-client-v2/src/purecloud-platform-client-v2/api/OrganizationApi.js';
import UsersApi from 'purecloud-platform-client-v2/src/purecloud-platform-client-v2/api/UsersApi.js';
import './App.css';

const DataTableBrowser = lazy(() => import('./components/DataTableBrowser'));

type AppStatus =
  | 'initialising'
  | 'missing-parameters'
  | 'authenticating'
  | 'connected'
  | 'error';

interface LaunchConfig {
  clientId: string;
  region: string;
  redirectUri: string;
}

interface GenesysUser {
  id?: string;
  name?: string;
  email?: string;
  username?: string;
}

interface GenesysOrganization {
  id?: string;
  name?: string;
}

const STORAGE_KEY = 'genesys-routing-visualiser-launch';
const apiClient = new ApiClient();

function getLaunchConfig(): LaunchConfig | null {
  const params = new URLSearchParams(window.location.search);

  // Support both standard and Genesys Cloud embedded-app parameters.
  const clientId =
    params.get('clientId') ||
    params.get('gc_clientId') ||
    '';

  const region =
    params.get('region') ||
    params.get('gc_region') ||
    '';

  const redirectUri =
    params.get('redirectUri') ||
    params.get('redirectURI') ||
    params.get('gc_redirectUrl') ||
    '';

  // Save parameters supplied by the initial launch so they survive
  // the OAuth redirect back to this application.
  if (clientId && region && redirectUri) {
    const config: LaunchConfig = {
      clientId,
      region,
      redirectUri,
    };

    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    return config;
  }

  // OAuth may return to the application without the original launch
  // parameters. Recover the saved configuration in that situation.
  try {
    const saved = sessionStorage.getItem(STORAGE_KEY);

    if (saved) {
      const config = JSON.parse(saved) as LaunchConfig;

      if (config.clientId && config.region && config.redirectUri) {
        return config;
      }
    }
  } catch {
    sessionStorage.removeItem(STORAGE_KEY);
  }

  return null;
}

export default function App() {
  const [status, setStatus] = useState<AppStatus>('initialising');
  const [message, setMessage] = useState('');
  const [user, setUser] = useState<GenesysUser | null>(null);
  const [organization, setOrganization] = useState<GenesysOrganization | null>(null);
  const [config, setConfig] = useState<LaunchConfig | null>(null);
  const [connectionInfoOpen, setConnectionInfoOpen] = useState(false);
  const hasStartedConnection = useRef(false);

  const connectToGenesys = useCallback(async () => {
    setStatus('initialising');
    setMessage('');

    const launchConfig = getLaunchConfig();

    if (!launchConfig) {
      setStatus('missing-parameters');
      setMessage(
        'Missing Genesys Cloud launch parameters. ' +
          'The application needs a client ID, region and redirect URI.'
      );
      return;
    }

    setConfig(launchConfig);

    try {
      // Configure the Genesys Cloud region before making API requests.
      apiClient.setEnvironment(launchConfig.region);

      setStatus('authenticating');

      // Start or complete the SDK's PKCE OAuth authentication flow.
      await apiClient.loginPKCEGrant(
        launchConfig.clientId,
        launchConfig.redirectUri
      );

      const usersApi = new UsersApi();
      const organizationApi = new OrganizationApi();
      const [currentUser, currentOrganization] = await Promise.all([
        usersApi.getUsersMe() as Promise<GenesysUser>,
        organizationApi.getOrganizationsMe() as Promise<GenesysOrganization>,
      ]);

      setUser(currentUser);
      setOrganization(currentOrganization);
      setStatus('connected');
    } catch (error: unknown) {
      console.error('Genesys Cloud connection failed:', error);

      const errorMessage =
        error instanceof Error
          ? error.message
          : 'An unknown error occurred while connecting to Genesys Cloud.';

      setMessage(errorMessage);
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    if (hasStartedConnection.current) {
      return;
    }

    hasStartedConnection.current = true;
    void connectToGenesys();
  }, [connectToGenesys]);

  const disconnect = () => {
    sessionStorage.removeItem(STORAGE_KEY);
    setUser(null);
    setOrganization(null);
    setConfig(null);
    setMessage('');
    setStatus('initialising');

    // Reload the application to start a fresh connection.
    window.location.assign(window.location.pathname);
  };

  const statusLabel = {
    initialising: 'Initialising',
    'missing-parameters': 'Setup needed',
    authenticating: 'Connecting',
    connected: 'Connected',
    error: 'Connection issue',
  }[status];

  if (status === 'missing-parameters') {
    return (
      <main className="app-shell landing-shell">
        <section className="integration-landing" aria-labelledby="integration-landing-title">
          <p className="eyebrow">ROUTING INTELLIGENCE</p>
          <h1 id="integration-landing-title">Open this app from Genesys Cloud</h1>
          <p className="integration-landing-description">
            This routing visualiser needs Genesys Cloud launch details to connect
            to your organisation.
          </p>
          <div className="integration-landing-next-step">
            <strong>Genesys Cloud integration required</strong>
            <p>
              Configure this app as an embedded client application in Genesys
              Cloud, then launch it from there. Genesys Cloud supplies the
              connection parameters when the app opens.
            </p>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <section className="page-content">
        <div className="welcome">
          <p className="eyebrow">ROUTING INTELLIGENCE</p>
          <div className="welcome-heading-row">
            <h2>Understand your call flows.</h2>
            <div className="page-header-actions">
              <span className="environment-badge">
                <span />
                {import.meta.env.DEV ? 'Development' : 'Production'}
              </span>
              <div className="connection-menu">
              <button
                className={`connection-status-button ${status}`}
                type="button"
                aria-expanded={connectionInfoOpen}
                aria-controls="connection-info"
                onClick={() => setConnectionInfoOpen((open) => !open)}
              >
                <span aria-hidden="true" />
                {status === 'connected' ? organization?.name || statusLabel : statusLabel}
              </button>
              {connectionInfoOpen && (
                <section
                  className="connection-info"
                  id="connection-info"
                  aria-label="Connection status information"
                >
                  <div className="connection-info-heading">
                    <div>
                      <p className="section-kicker">YOUR ORGANISATION</p>
                      <h2>{organization?.name || 'Genesys Cloud'}</h2>
                    </div>
                    <span className={`connection-info-state ${status}`}>{statusLabel}</span>
                  </div>

                  {(status === 'initialising' || status === 'authenticating') && (
                    <p className="connection-info-message">
                      {status === 'initialising'
                        ? 'Reading your Genesys Cloud launch details.'
                        : 'Authenticating and retrieving your user profile.'}
                    </p>
                  )}
                  {status === 'error' && (
                    <p className="connection-info-message error">{message}</p>
                  )}
                  {status === 'connected' && user && (
                    <dl className="connection-info-details">
                      <div>
                        <dt>User</dt>
                        <dd>{user.name || user.username || 'Unknown user'}</dd>
                      </div>
                      {organization?.name && (
                        <div>
                          <dt>Organization</dt>
                          <dd>{organization.name}</dd>
                        </div>
                      )}
                      {user.email && (
                        <div>
                          <dt>Email</dt>
                          <dd>{user.email}</dd>
                        </div>
                      )}
                      <div>
                        <dt>Region</dt>
                        <dd>{config?.region}</dd>
                      </div>
                    </dl>
                  )}

                  {status === 'error' && (
                    <button
                      className="connection-info-action"
                      type="button"
                      onClick={() => void connectToGenesys()}
                    >
                      Retry connection
                    </button>
                  )}
                  {status === 'connected' && (
                    <button
                      className="connection-info-action secondary"
                      type="button"
                      onClick={disconnect}
                    >
                      Reset connection
                    </button>
                  )}
                </section>
              )}
                </div>
              </div>
          </div>
          <p className="description">
            Visualise your Genesys Cloud NTT routing configuration, explore call
            journeys, and identify routing issues.
          </p>
        </div>

        <div className="workspace-grid">
          {status === 'connected' ? (
            <section className="flow-card">
              <Suspense
                fallback={
                  <div className="routing-workspace-loading" role="status">
                    Loading routing workspace…
                  </div>
                }
              >
                <DataTableBrowser />
              </Suspense>
            </section>
          ) : (
            <section className="flow-card" aria-labelledby="flow-title">
              <header className="card-heading">
                <div>
                  <p className="section-kicker">WORKSPACE PREVIEW</p>
                  <h3 id="flow-title">Call-flow explorer</h3>
                </div>
                <span className="preview-tag">ROUTING WORKSPACE</span>
              </header>

              <div className="flow-canvas">
                <div className="flow-steps" aria-hidden="true">
                  <div className="flow-step">
                    <span className="flow-step-icon">01</span>
                    <span>Inbound call</span>
                  </div>
                  <span className="flow-connector" />
                  <div className="flow-step">
                    <span className="flow-step-icon">02</span>
                    <span>Architect flow</span>
                  </div>
                  <span className="flow-connector" />
                  <div className="flow-step">
                    <span className="flow-step-icon">03</span>
                    <span>Agent queue</span>
                  </div>
                </div>

                <div className="flow-empty">
                  <div className="flow-empty-icon" aria-hidden="true">◇</div>
                  <div>
                    <h4>Your call-flow diagram will appear here</h4>
                    <p>
                      Connect to Genesys Cloud to start exploring your routing
                      configuration.
                    </p>
                  </div>
                </div>
              </div>

              <div className="flow-footer" aria-label="Workspace capabilities">
                <span>VISUALISE</span>
                <span>EXPLORE</span>
                <span>IMPROVE</span>
              </div>
            </section>
          )}
        </div>

        <footer className="app-footer">
          <p>Genesys Cloud Routing Visualiser</p>
          <p>
            Independent project by{' '}
            <a
              href="https://www.linkedin.com/in/vernonvandam/"
              target="_blank"
              rel="noreferrer"
            >
              Vernon van Dam
            </a>
            {' '}· Not an official NTT product
          </p>
        </footer>
      </section>
    </main>
  );
}