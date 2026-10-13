import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ArchitectApi from 'purecloud-platform-client-v2/src/purecloud-platform-client-v2/api/ArchitectApi.js';
import RouteFlowCanvas from './RouteFlowCanvas';

import {
  buildOpenHoursDiagram,
  getErrorMessage,
  getDataTable,
  getDataTables,
  getIndialEntries,
  type DataTableSummary,
  type IndialEntry,
  type RoutingCondition,
  type RouteDiagramNode,
} from '../routing/genesysRouting';
import './DataTableBrowser.css';

const ROUTING_CONDITIONS: Array<{ value: RoutingCondition; label: string }> = [
  { value: 'normal', label: 'Normal / open hours' },
  { value: 'after-hours', label: 'After hours' },
  { value: 'public-holiday', label: 'Public holiday' },
  { value: 'unstaffed', label: 'Unstaffed' },
  { value: 'emergency', label: 'Emergency' },
];

function isRoutingCondition(value: string): value is RoutingCondition {
  return ROUTING_CONDITIONS.some((condition) => condition.value === value);
}

export default function DataTableBrowser() {
  const [tables, setTables] = useState<DataTableSummary[]>([]);
  const [startingTableId, setStartingTableId] = useState('');
  const [entries, setEntries] = useState<IndialEntry[]>([]);
  const [search, setSearch] = useState('');
  const [selectedEntryId, setSelectedEntryId] = useState('');
  const [routingCondition, setRoutingCondition] = useState<RoutingCondition>('normal');
  const [diagram, setDiagram] = useState<RouteDiagramNode | null>(null);
  const [isLoadingData, setIsLoadingData] = useState(true);
  const [isBuildingDiagram, setIsBuildingDiagram] = useState(false);
  const [error, setError] = useState('');
  const [tableWarning, setTableWarning] = useState('');
  const hasLoadedTables = useRef(false);
  const tablesRef = useRef<DataTableSummary[]>([]);

  const loadTables = useCallback(async () => {
    setIsLoadingData(true);
    setError('');
    setTableWarning('');

    try {
      const architectApi = new ArchitectApi();
      const availableTables = await getDataTables(architectApi);
      tablesRef.current = availableTables;
      setTables(availableTables);
      setStartingTableId('');
      setEntries([]);
      setSelectedEntryId('');
      setRoutingCondition('normal');
      setDiagram(null);
      setTableWarning(
        availableTables.length === 0
          ? 'No data tables are available to use as a starting point.'
          : 'Choose a starting data table to load its inbound services.'
      );
    } catch (loadError: unknown) {
      setError(
        getErrorMessage(loadError, 'An unknown error occurred while loading data tables.')
      );
      setTables([]);
      setStartingTableId('');
      setEntries([]);
      setDiagram(null);
    } finally {
      setIsLoadingData(false);
    }
  }, []);

  useEffect(() => {
    if (hasLoadedTables.current) {
      return;
    }

    hasLoadedTables.current = true;
    void loadTables();
  }, [loadTables]);

  const selectStartingTable = async (tableId: string) => {
    setStartingTableId(tableId);
    setEntries([]);
    setSelectedEntryId('');
    setRoutingCondition('normal');
    setDiagram(null);
    setError('');
    setTableWarning('');

    if (!tableId) {
      setTableWarning('Choose a starting data table before selecting an inbound service.');
      return;
    }

    const table = tablesRef.current.find((candidate) => candidate.id === tableId);
    if (!table) {
      setError('The selected starting data table is no longer available. Refresh the data tables.');
      return;
    }

    setIsLoadingData(true);
    try {
      const architectApi = new ArchitectApi();
      const tableData = await getDataTable(architectApi, table);
      const nextEntries = getIndialEntries(tableData);

      setEntries(nextEntries);
      setTableWarning(
        nextEntries.length === 0
          ? `No rows with an Indial_Number key were found in "${table.name}".`
          : ''
      );
    } catch (loadError: unknown) {
      setError(
        getErrorMessage(loadError, `Unable to load rows from "${table.name}".`)
      );
    } finally {
      setIsLoadingData(false);
    }
  };

  const filteredEntries = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    if (!query) {
      return entries;
    }

    return entries.filter((entry) =>
      [entry.indialNumber, entry.serviceNumber, entry.serviceName]
        .some((value) => value.toLocaleLowerCase().includes(query))
    );
  }, [entries, search]);

  const selectEntry = async (
    entry: IndialEntry,
    condition: RoutingCondition = routingCondition
  ) => {
    setSelectedEntryId(entry.id);
    setIsBuildingDiagram(true);
    setError('');
    setDiagram(null);

    try {
      const architectApi = new ArchitectApi();
      const nextDiagram = await buildOpenHoursDiagram(
        architectApi,
        tablesRef.current,
        entry,
        condition
      );
      setDiagram(nextDiagram);
    } catch (buildError: unknown) {
      setError(
        getErrorMessage(buildError, 'An unknown error occurred while building the routing diagram.')
      );
    } finally {
      setIsBuildingDiagram(false);
    }
  };

  const selectedEntry = entries.find((entry) => entry.id === selectedEntryId);
  const selectedConditionLabel = ROUTING_CONDITIONS.find(
    (condition) => condition.value === routingCondition
  )?.label ?? 'Normal / open hours';

  return (
    <section className="data-table-browser" aria-labelledby="data-table-title">
      <header className="data-table-header">
        <div>
          <p className="section-kicker">LIVE GENESYS CLOUD DATA</p>
          <h3 id="data-table-title">Choose an inbound service</h3>
          <p className="data-table-subtitle">
            Select an indial number to trace its configured route.
          </p>
        </div>
        <button
          className="refresh-services"
          type="button"
          disabled={isLoadingData || isBuildingDiagram}
          onClick={() => {
            void loadTables();
          }}
        >
          Refresh data tables
        </button>
      </header>

      {error && (
        <div className="data-table-error" role="alert">
          <strong>Unable to load routing data</strong>
          <span>{error}</span>
        </div>
      )}

      <div className="service-routing-layout">
        <aside className="service-picker" aria-label="Inbound services">
          <label className="data-table-search">
            <span>Starting data table</span>
            <select
              value={startingTableId}
              onChange={(event) => void selectStartingTable(event.target.value)}
              disabled={isLoadingData || tables.length === 0}
            >
              <option value="">Select a starting data table…</option>
              {tables.map((table) => (
                <option key={table.id} value={table.id}>{table.name}</option>
              ))}
            </select>
          </label>

          {tableWarning && (
            <div className="data-table-warning" role="status">
              {tableWarning}
            </div>
          )}

          <label className="data-table-search">
            <span>Search indial or service</span>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Number, service number, or name"
              disabled={isLoadingData || entries.length === 0}
            />
          </label>

          <div className="service-list-heading">
            <span>Inbound services</span>
            <span>
              {isLoadingData
                ? 'Loading…'
                : startingTableId
                  ? `${filteredEntries.length} shown`
                  : 'Select a table'}
            </span>
          </div>

          <div className="service-list">
            {isLoadingData && (
              <div className="data-table-empty">
                {startingTableId ? 'Loading indial numbers…' : 'Loading data tables…'}
              </div>
            )}
            {!isLoadingData && filteredEntries.length === 0 && (
              <div className="data-table-empty">
                {error
                  ? 'Inbound services could not be loaded. Resolve the data-table error above and refresh.'
                  : !startingTableId
                    ? 'Choose a starting data table to load inbound services.'
                  : entries.length === 0
                  ? 'No inbound services were found in the selected data table.'
                  : 'No services match this search.'}
              </div>
            )}
            {filteredEntries.map((entry) => (
              <button
                className={`service-option ${selectedEntryId === entry.id ? 'selected' : ''}`}
                key={entry.id}
                type="button"
                aria-pressed={selectedEntryId === entry.id}
                disabled={isLoadingData || isBuildingDiagram}
                onClick={() => void selectEntry(entry)}
              >
                <span className="service-option-icon" aria-hidden="true">↳</span>
                <span className="service-option-copy">
                  <strong>{entry.indialNumber}</strong>
                  <span>{entry.serviceName || 'Unnamed service'}</span>
                  <small>{entry.serviceNumber || 'No service number'}</small>
                </span>
                <span className="service-option-arrow" aria-hidden="true">›</span>
              </button>
            ))}
          </div>
        </aside>

        <section className="route-preview" aria-labelledby="route-title">
          <header className="route-preview-header">
            <div>
              <p className="section-kicker">ROUTING JOURNEY</p>
              <h4 id="route-title">
                {selectedEntry?.serviceName || 'Select a service to begin'}
              </h4>
              {selectedEntry && (
                <p>
                  {selectedEntry.indialNumber}
                  {selectedEntry.serviceNumber
                    ? ` · ${selectedEntry.serviceNumber}`
                    : ''}
                </p>
              )}
            </div>
            <div className="route-condition-control">
              <label htmlFor="route-condition">Flow condition</label>
              <select
                id="route-condition"
                value={routingCondition}
                disabled={isLoadingData || isBuildingDiagram}
                onChange={(event) => {
                  const conditionValue = event.target.value;
                  if (!isRoutingCondition(conditionValue)) {
                    setError('The selected flow condition is not supported.');
                    return;
                  }
                  const condition = conditionValue;
                  setError('');
                  setRoutingCondition(condition);
                  if (selectedEntry) {
                    void selectEntry(selectedEntry, condition);
                  }
                }}
              >
                {ROUTING_CONDITIONS.map((condition) => (
                  <option key={condition.value} value={condition.value}>
                    {condition.label}
                  </option>
                ))}
              </select>
              <span className="open-route-badge">{selectedConditionLabel.toUpperCase()} ROUTE</span>
            </div>
          </header>

          <div className="route-canvas" aria-live="polite">
            {isBuildingDiagram && (
              <div className="data-table-empty">Tracing data-table references…</div>
            )}
            {!isBuildingDiagram && !diagram && !error && (
              <div className="data-table-empty">
                Choose an inbound service to build its routing diagram.
              </div>
            )}
            {!isBuildingDiagram && diagram && <RouteFlowCanvas diagram={diagram} />}
          </div>

          <p className="route-scope-note">
            The selected condition follows its configured module route; schedules are not evaluated against
            the current time, and menu selections are not evaluated.
          </p>
        </section>
      </div>
    </section>
  );
}
