import type platformClient from 'purecloud-platform-client-v2';

type ArchitectApi = InstanceType<typeof platformClient.ArchitectApi>;

export interface DataTableSummary {
  id: string;
  name: string;
}

export interface DataTableData {
  table: DataTableSummary;
  schema: unknown;
  rows: Record<string, unknown>[];
}

export interface IndialEntry {
  id: string;
  sourceTableName: string;
  indialNumber: string;
  serviceNumber: string;
  serviceName: string;
  row: Record<string, unknown>;
}

export interface RouteDiagramBranch {
  label: string;
  node: RouteDiagramNode;
}

export interface RouteDiagramNode {
  id: string;
  category: string;
  label: string;
  kind: 'entry' | 'module' | 'terminal' | 'diagnostic';
  status: 'ready' | 'terminal' | 'warning' | 'cycle';
  details: string[];
  branches: RouteDiagramBranch[];
}

export type RoutingCondition = 'normal' | 'after-hours' | 'public-holiday' | 'unstaffed' | 'emergency';

const PAGE_SIZE = 100;
const MAX_ROUTE_NODES = 250;
const MAX_ROUTE_DEPTH = 40;
const CONDITIONAL_FIELD_PATTERNS: Record<Exclude<RoutingCondition, 'normal'>, RegExp> = {
  'after-hours': /closed|after.?hours/i,
  'public-holiday': /holiday/i,
  unstaffed: /no.?agent|unstaffed/i,
  emergency: /emergency/i,
};

const MODULE_TABLES: Record<string, { tableName: string; category: string }> = {
  SVC: { tableName: 'Reference Service Settings', category: 'Service' },
  MNU: { tableName: 'Reference Menu Settings', category: 'Menu' },
  INP: { tableName: 'Reference Input Settings', category: 'Input' },
  RTE: { tableName: 'Reference Action Settings', category: 'Route' },
  QUE: { tableName: 'Reference Target Settings', category: 'Queue target' },
  CAL: { tableName: 'Reference Calendar Settings', category: 'Calendar' },
  SCH: { tableName: 'Reference Calendar Settings', category: 'Schedule' },
  MSG: { tableName: 'Reference Action Settings', category: 'Message' },
  DIS: { tableName: 'Reference Action Settings', category: 'Disconnect' },
  TRF: { tableName: 'Reference Action Settings', category: 'Transfer' },
  VM: { tableName: 'Reference Action Settings', category: 'Voicemail' },
  RPC: { tableName: 'Reference Action Settings', category: 'Repeat caller' },
  CPD: { tableName: 'Reference Check Participant Data', category: 'Participant data check' },
  SPY: { tableName: 'Reference Splay Settings', category: 'Splay' },
};

function getField(row: Record<string, unknown>, name: string): unknown {
  const key = Object.keys(row).find(
    (candidate) => candidate.toLocaleLowerCase() === name.toLocaleLowerCase()
  );
  return key ? row[key] : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (isRecord(error)) {
    if (typeof error.message === 'string') {
      return error.message;
    }
    if (typeof error.status === 'number') {
      return `${fallback} (HTTP ${error.status})`;
    }
  }
  return fallback;
}

function getText(row: Record<string, unknown>, name: string): string {
  const value = getField(row, name);
  return typeof value === 'string' || typeof value === 'number'
    ? String(value).trim()
    : '';
}

function normalizeName(value: string): string {
  return value.toLocaleLowerCase().replace(/[^a-z0-9]/g, '');
}

function getPageCount(pageCount: number | undefined, total: number | undefined, count: number) {
  if (typeof pageCount === 'number' && pageCount > 0) {
    return pageCount;
  }
  if (typeof total === 'number') {
    return Math.max(1, Math.ceil(total / PAGE_SIZE));
  }
  return count < PAGE_SIZE ? 1 : 2;
}

export async function getDataTables(api: ArchitectApi): Promise<DataTableSummary[]> {
  const tables: DataTableSummary[] = [];
  let page = 1;

  while (true) {
    const response = await api.getFlowsDatatables({
      pageNumber: page,
      pageSize: PAGE_SIZE,
      sortBy: 'name',
      sortOrder: 'ascending',
    });
    const entities = response.entities ?? [];

    for (const table of entities) {
      if (table.id && table.name) {
        tables.push({ id: table.id, name: table.name });
      }
    }

    const pages = getPageCount(response.pageCount, response.total, entities.length);
    if (page >= pages) {
      break;
    }
    page += 1;
  }

  return tables;
}

export async function getDataTable(
  api: ArchitectApi,
  table: DataTableSummary
): Promise<DataTableData> {
  const metadata = await api.getFlowsDatatable(table.id);
  const rows: Record<string, unknown>[] = [];
  let page = 1;

  while (true) {
    const response = await api.getFlowsDatatableRows(table.id, {
      pageNumber: page,
      pageSize: PAGE_SIZE,
      showbrief: false,
    });
    const entities = response.entities ?? [];
    rows.push(...entities.map((row) => Object.fromEntries(Object.entries(row))));
    const pages = getPageCount(response.pageCount, response.total, entities.length);
    if (page >= pages) {
      break;
    }
    page += 1;
  }

  return {
    table: { id: metadata.id ?? table.id, name: metadata.name ?? table.name },
    schema: metadata.schema,
    rows,
  };
}

export function getIndialEntries(data: DataTableData): IndialEntry[] {
  return data.rows.flatMap((row, index) => {
    const indialNumber = getText(row, 'Indial_Number') || getText(row, 'key');
    if (!indialNumber) {
      return [];
    }

    return [{
      id: `${data.table.id}-${indialNumber}-${index}`,
      sourceTableName: data.table.name,
      indialNumber,
      serviceNumber: getText(row, 'Service_Number'),
      serviceName: getText(row, 'Service_Name'),
      row,
    }];
  }).sort((left, right) =>
    left.indialNumber.localeCompare(right.indialNumber, undefined, { numeric: true })
  );
}

function createNode(
  id: string,
  category: string,
  label: string,
  kind: RouteDiagramNode['kind'],
  status: RouteDiagramNode['status'],
  details: string[] = [],
  branches: RouteDiagramBranch[] = []
): RouteDiagramNode {
  return { id, category, label, kind, status, details, branches };
}

function getOpenHoursDetail(row: Record<string, unknown>): string {
  const schedule = getText(row, 'Open_Hours');
  return schedule
    ? `Open-hours schedule group: ${schedule}`
    : 'No open-hours schedule group; treated as open 24×7 by this flow.';
}

function getModuleBranches(
  row: Record<string, unknown>,
  condition: RoutingCondition,
  useNormalBranchesIfConditionIsMissing = true
) {
  const candidates = Object.entries(row)
    .filter(([field, value]) =>
      /^(?:next_module|.+_next_module.*)$/i.test(field) &&
      typeof value === 'string' &&
      value.trim().length > 0
    )
    .map(([field, value]) => ({
      field,
      label: field.replace(/_/g, ' ').replace(/ next module.*/i, '').trim() || 'Next module',
      target: String(value).trim(),
    }));

  if (condition === 'normal') {
    return candidates.filter(
      (branch) => !Object.values(CONDITIONAL_FIELD_PATTERNS).some((pattern) => pattern.test(branch.field))
    );
  }

  const conditionalBranches = candidates.filter((branch) =>
    CONDITIONAL_FIELD_PATTERNS[condition].test(branch.field)
  );
  return conditionalBranches.length > 0
    ? conditionalBranches
    : useNormalBranchesIfConditionIsMissing
      ? candidates.filter(
      (branch) => !Object.values(CONDITIONAL_FIELD_PATTERNS).some((pattern) => pattern.test(branch.field))
      )
      : [];
}

function getDelimitedModuleBranches(
    value: string,
    label: (item: string, target: string, index: number) => string
): Array<{ label: string; target: string }> {
    return value.split('|').flatMap((item, index) => {
      const separator = item.indexOf('=');
      if (separator < 1) {
        return [];
      }

      const itemName = item.slice(0, separator).trim();
      const target = item.slice(separator + 1).trim();
      return target ? [{ label: label(itemName, target, index), target }] : [];
    });
}

function findRowByKey(
  table: DataTableData,
  key: string
): Record<string, unknown> | undefined {
  const normalizedKey = normalizeName(key);
  return table.rows.find((row) =>
    normalizeName(getText(row, 'key')) === normalizedKey
  );
}

export function findDataTable(
  tables: DataTableSummary[],
  name: string,
  preferredNamespace?: string
): DataTableSummary | undefined {
  const normalizedName = normalizeName(name);
  const logicalSuffix = normalizeName(name.replace(/^reference\s+/i, ''));
  if (preferredNamespace) {
    const preferredName = normalizeName(`${preferredNamespace} ${logicalSuffix}`);
    const namespacedMatch = tables.find(
      (table) => normalizeName(table.name) === preferredName
    );
    if (namespacedMatch) {
      return namespacedMatch;
    }
  }

  const exactMatch = tables.find((table) => normalizeName(table.name) === normalizedName);
  if (exactMatch) {
    return exactMatch;
  }

  const suffixMatches = tables.filter((table) =>
    normalizeName(table.name).endsWith(logicalSuffix)
  );
  if (suffixMatches.length > 1) {
    throw new Error(
      `Multiple data tables match "${name}": ${suffixMatches.map((table) => table.name).join(', ')}.`
    );
  }
  return suffixMatches[0];
}

export async function buildOpenHoursDiagram(
  api: ArchitectApi,
  tables: DataTableSummary[],
  entry: IndialEntry,
  condition: RoutingCondition = 'normal'
): Promise<RouteDiagramNode> {
  const normalizedSourceName = normalizeName(entry.sourceTableName);
  const entrySuffixes = ['globalindialmappinglist', 'indialmappinglist'];
  const entrySuffix = entrySuffixes.find((suffix) => normalizedSourceName.endsWith(suffix));
  const preferredNamespace = entrySuffix
    ? normalizedSourceName.slice(0, -entrySuffix.length)
    : undefined;
  const tableCache = new Map<string, Promise<DataTableData>>();
  const getTableData = (tableName: string): Promise<DataTableData> => {
    const table = findDataTable(tables, tableName, preferredNamespace);
    if (!table) {
      return Promise.reject(
        new Error(`The required data table "${tableName}" is not available.`)
      );
    }

    const cached = tableCache.get(table.id);
    if (cached) {
      return cached;
    }

    const request = getDataTable(api, table);
    tableCache.set(table.id, request);
    return request;
  };

  let createdNodes = 0;
  let generatedNodeIds = 0;
  const nextNodeId = (prefix: string) => `${prefix}-${++generatedNodeIds}`;
  const buildModule = async (
    reference: string,
    ancestry: Set<string>,
    depth: number
  ): Promise<RouteDiagramNode> => {
    createdNodes += 1;

    if (depth >= MAX_ROUTE_DEPTH || createdNodes > MAX_ROUTE_NODES) {
      return createNode(
        nextNodeId('limit'),
        'Trace limit',
        'Routing trace stopped',
        'diagnostic',
        'warning',
        ['The route is unusually deep or broad. Increase trace limits after reviewing the configuration.']
      );
    }

    const normalizedReference = reference.trim();
    if (ancestry.has(normalizedReference.toLocaleLowerCase())) {
      return createNode(
        nextNodeId('cycle'),
        'Cycle detected',
        normalizedReference,
        'diagnostic',
        'cycle',
        ['This module was already visited earlier on this route.']
      );
    }

    const prefixMatch = /^([a-z]{2,3})(?=_|$)/i.exec(normalizedReference);
    const prefix = (prefixMatch?.[1] ?? normalizedReference.slice(0, 3)).toLocaleUpperCase();
    const module = MODULE_TABLES[prefix];
    if (!module) {
      return createNode(
        nextNodeId('unsupported'),
        'Unresolved module',
        normalizedReference,
        'diagnostic',
        'warning',
        [`No data-table resolver is defined for module prefix "${prefix || 'empty'}".`]
      );
    }

    if (prefix === 'DIS' && normalizedReference.toLocaleLowerCase() === 'disconnect') {
      return createNode(
        nextNodeId('terminal'),
        'Terminal destination',
        'Disconnect',
        'terminal',
        'terminal',
        ['The Architect flow disconnects the interaction.']
      );
    }

    let data: DataTableData;
    try {
      data = await getTableData(module.tableName);
    } catch (tableError: unknown) {
      return createNode(
        nextNodeId('table-error'),
        module.category,
        normalizedReference,
        'diagnostic',
        'warning',
        [getErrorMessage(tableError, 'Unable to read the module data table.')]
      );
    }

    const row = findRowByKey(data, normalizedReference);
    if (!row) {
      return createNode(
        nextNodeId('missing-row'),
        module.category,
        normalizedReference,
        'diagnostic',
        'warning',
        [`No row with key "${normalizedReference}" was found in ${module.tableName}.`]
      );
    }

    const nextAncestry = new Set(ancestry);
    nextAncestry.add(normalizedReference.toLocaleLowerCase());
    const details: string[] = [`Configuration table: ${data.table.name}`];
    let node: RouteDiagramNode;

    if (prefix === 'QUE') {
      const targetQueue = getText(row, 'Target_ACD_Queue');
      const queueSettings = getText(row, 'Queue_Settings');
      details.push(`Target queue: ${targetQueue || 'not configured'}`);
      if (!queueSettings) {
        return createNode(
          nextNodeId('queue-settings-missing'),
          module.category,
          normalizedReference,
          'diagnostic',
          'warning',
          [...details, 'Queue_Settings is empty; the Architect queue settings lookup cannot be resolved.']
        );
      }

      let queueData: DataTableData;
      try {
        queueData = await getTableData('Reference Queue Settings');
      } catch (tableError: unknown) {
        return createNode(
          nextNodeId('queue-table-error'),
          module.category,
          normalizedReference,
          'diagnostic',
          'warning',
          [getErrorMessage(tableError, 'Unable to read queue settings.')]
        );
      }

      const queueRow = findRowByKey(queueData, queueSettings);
      if (!queueRow) {
        return createNode(
          nextNodeId('queue-row-missing'),
          module.category,
          normalizedReference,
          'diagnostic',
          'warning',
          [...details, `No queue settings row with key "${queueSettings}" was found.`]
        );
      }

      const queueDetails = [
        `Queue settings: ${queueSettings}`,
        getOpenHoursDetail(queueRow),
      ];
      const configuredQueueBranches = getModuleBranches(
        queueRow,
        condition,
        condition === 'normal'
      );
      const hasConditionRoute = condition !== 'normal' &&
        configuredQueueBranches.some((branch) =>
          CONDITIONAL_FIELD_PATTERNS[condition].test(branch.field)
        );
      const queueBranches: RouteDiagramBranch[] = [];
      if (targetQueue && !hasConditionRoute && condition === 'normal') {
        queueBranches.push({
          label: 'Normal queue destination',
          node: createNode(
            nextNodeId('queue-destination'),
            'Terminal destination',
            targetQueue,
            'terminal',
            'terminal',
            ['Configured Genesys Cloud ACD queue.']
          ),
        });
      } else if (!hasConditionRoute && condition !== 'normal') {
        queueBranches.push({
          label: 'Selected condition route',
          node: createNode(
            nextNodeId('condition-route-missing'),
            'Condition route unavailable',
            `No ${condition.replace('-', ' ')} route is configured`,
            'diagnostic',
            'warning',
            [`No matching condition-specific module destination is configured in ${queueData.table.name} for key "${queueSettings}".`]
          ),
        });
      } else if (!targetQueue && condition === 'normal') {
        queueBranches.push({
          label: 'Queue destination',
          node: createNode(
            nextNodeId('queue-destination-missing'),
            'Configuration issue',
            'Target ACD queue is missing',
            'diagnostic',
            'warning'
          ),
        });
      }

      for (const branch of configuredQueueBranches) {
        queueBranches.push({
          label: branch.label,
          node: await buildModule(branch.target, nextAncestry, depth + 1),
        });
      }

      node = createNode(
        nextNodeId('module'),
        module.category,
        normalizedReference,
        'module',
        'ready',
        [...details, ...queueDetails],
        queueBranches
      );
      return node;
    }

    if (prefix === 'SVC' || prefix === 'CAL') {
      details.push(getOpenHoursDetail(row));
    }

    const branches = getModuleBranches(row, condition).map((branch) =>
      prefix === 'SVC' &&
      normalizeName(branch.label) === 'nextmodule' &&
      getText(row, 'Open_Hours')
        ? { ...branch, label: 'If open-hours schedule is open' }
        : branch
    );
    const destination = prefix === 'RTE' || prefix === 'TRF' || prefix === 'VM'
      ? getText(row, 'Transfer_Destination')
      : '';
    if (prefix === 'RTE' || prefix === 'TRF' || prefix === 'VM') {
      if (destination) {
        details.push(`${prefix === 'VM' ? 'Voicemail' : 'Transfer'} destination: ${destination}`);
      }
    }

    node = createNode(
      nextNodeId('module'),
      module.category,
      normalizedReference,
      'module',
      'ready',
      details,
      []
    );

    for (const branch of branches) {
      node.branches.push({
        label: branch.label,
        node: await buildModule(branch.target, nextAncestry, depth + 1),
      });
    }

    if (destination) {
      node.branches.unshift({
        label: prefix === 'VM' ? 'Voicemail destination' : 'Transfer destination',
        node: createNode(
          nextNodeId('destination'),
          prefix === 'VM' ? 'Voicemail destination' : 'Transfer destination',
          destination,
          'terminal',
          'terminal'
        ),
      });
    }

    if (prefix === 'SCH') {
      for (const branch of getDelimitedModuleBranches(
        getText(row, 'Modified_Hours_Schedules'),
        (schedule) => `If schedule "${schedule}" is active`
      )) {
        node.branches.unshift({
          label: branch.label,
          node: await buildModule(branch.target, nextAncestry, depth + 1),
        });
      }
    }

    if (prefix === 'SPY') {
      const options = getText(row, 'Splay_Options')
        .split('|')
        .flatMap((option) => {
          const [weight, ...targetParts] = option.split(',');
          const target = targetParts.join(',').trim();
          return weight?.trim() && target
            ? [{ weight: weight.trim(), target }]
            : [];
        });
      for (const [index, option] of options.entries()) {
        node.branches.unshift({
          label: `Weighted outcome ${index + 1} (${option.weight})`,
          node: await buildModule(option.target, nextAncestry, depth + 1),
        });
      }

      if (options.length > 0) {
        node.details.push('The runtime randomly selects one of the configured weighted outcomes.');
      }
      const fallback = node.branches.find((branch) => branch.label === 'Failed');
      if (fallback) {
        fallback.label = 'Splay fallback';
      } else if (options.length === 0) {
        node.branches.push({
          label: 'Splay fallback',
          node: createNode(
            nextNodeId('splay-fallback'),
            'Configuration issue',
            'No Failed_Next_Module is configured',
            'diagnostic',
            'warning'
          ),
        });
      }
    }

    if (prefix === 'SVC' && node.branches.length === 0) {
      const defaultDestination = getText(entry.row, 'Default_DN');
      node.branches.push({
        label: 'No Next_Module configured',
        node: createNode(
          nextNodeId('default-route'),
          defaultDestination ? 'Default route destination' : 'Default route',
          defaultDestination || 'Genesys Cloud Default Route',
          defaultDestination ? 'terminal' : 'diagnostic',
          defaultDestination ? 'terminal' : 'warning',
          [
            'The as-built call flow sends a missing Next_Module to Default Route.',
            ...(defaultDestination ? [`Configured Default_DN: ${defaultDestination}`] : [
              'The inbound mapping row does not provide a Default_DN to display.'
            ]),
          ]
        ),
      });
    }

    if (node.branches.length === 0) {
      if (prefix === 'DIS') {
        node.kind = 'terminal';
        node.status = 'terminal';
        node.category = 'Terminal destination';
        node.label = `${normalizedReference} · disconnect`;
      } else if (prefix === 'TRF') {
        node.kind = 'terminal';
        node.status = 'terminal';
        node.category = 'Terminal destination';
        node.label = `${normalizedReference} · transfer`;
      } else if (
        prefix === 'MSG' || prefix === 'CAL' ||
        prefix === 'SCH' || prefix === 'INP' || prefix === 'CPD'
      ) {
        node.kind = 'diagnostic';
        node.status = 'warning';
        node.category = 'Unresolved route';
        node.details.push(
          `No applicable next-module destination is configured in ${data.table.name} for key "${normalizedReference}".`
        );
      }
    }

    return node;
  };

  const rootDetails = [
    `Indial number: ${entry.indialNumber}`,
    `Service number: ${entry.serviceNumber || 'not configured'}`,
    `Service: ${entry.serviceName || 'not configured'}`,
    getOpenHoursDetail(entry.row),
  ];
  const root = createNode(
    `entry-${entry.id}`,
    'Inbound entry point',
    entry.indialNumber,
    'entry',
    'ready',
    rootDetails
  );
  const firstModule = getText(entry.row, 'Next_Module');

  if (!firstModule) {
    root.kind = 'diagnostic';
    root.status = 'warning';
    root.details.push('No Next_Module is configured on this indial mapping row.');
    return root;
  }

  root.branches.push({
    label: condition === 'normal'
      ? 'Configured open-hours route'
      : `Selected ${condition.replace('-', ' ')} route`,
    node: await buildModule(firstModule, new Set(), 0),
  });

  return root;
}
