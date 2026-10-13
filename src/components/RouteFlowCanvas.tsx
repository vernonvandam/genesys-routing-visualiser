import { memo, useMemo, useState } from 'react';
import {
  Background,
  BaseEdge,
  Controls,
  Handle,
  MiniMap,
  MarkerType,
  Panel,
  Position,
  ReactFlow,
  getSmoothStepPath,
  useReactFlow,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from '@xyflow/react';

import type { RouteDiagramNode } from '../routing/genesysRouting';
import './RouteFlowCanvas.css';

interface RouteFlowNodeData extends Record<string, unknown> {
  routeNode: RouteDiagramNode;
}

interface RouteLayout {
  nodes: Node<RouteFlowNodeData>[];
  edges: RouteEdge[];
}

interface RouteEdgeData extends Record<string, unknown> {
  labelOnTargetVertical: boolean;
}

type RouteEdge = Edge<RouteEdgeData>;

const NODE_WIDTH = 280;
const HORIZONTAL_GAP = 420;
const VERTICAL_GAP = 250;

function countLeaves(node: RouteDiagramNode): number {
  if (node.branches.length === 0) {
    return 1;
  }
  return node.branches.reduce((total, branch) => total + countLeaves(branch.node), 0);
}

function createRouteLayout(root: RouteDiagramNode): RouteLayout {
  const nodes: Node<RouteFlowNodeData>[] = [];
  const edges: RouteEdge[] = [];

  const visit = (routeNode: RouteDiagramNode, depth: number, startRow: number) => {
    const leafCount = countLeaves(routeNode);
    const sourceX = (startRow + (leafCount - 1) / 2) * HORIZONTAL_GAP;
    nodes.push({
      id: routeNode.id,
      type: 'route',
      position: {
        x: sourceX,
        y: depth * VERTICAL_GAP,
      },
      data: { routeNode },
    });

    let nextRow = startRow;
    routeNode.branches.forEach((branch, index) => {
      const branchLeafCount = countLeaves(branch.node);
      const targetX = (nextRow + (branchLeafCount - 1) / 2) * HORIZONTAL_GAP;
      const isHorizontalBranch = Math.abs(targetX - sourceX) > 1;
      edges.push({
        id: `${routeNode.id}-${branch.node.id}-${index}`,
        source: routeNode.id,
        target: branch.node.id,
        type: 'route',
        markerEnd: { type: MarkerType.ArrowClosed, color: '#8197b5' },
        label: branch.label,
        data: { labelOnTargetVertical: isHorizontalBranch },
        labelStyle: { fill: '#65748c', fontSize: 11, fontWeight: 600 },
        labelBgStyle: { fill: '#ffffff', fillOpacity: 0.96 },
        labelBgPadding: [7, 4],
        labelBgBorderRadius: 5,
        style: { stroke: '#9aabc3', strokeWidth: 1.7 },
      });
      visit(branch.node, depth + 1, nextRow);
      nextRow += branchLeafCount;
    });
  };

  visit(root, 0, 0);
  return { nodes, edges };
}

function RouteNode({ data }: NodeProps<Node<RouteFlowNodeData>>) {
  const { routeNode } = data;
  return (
    <article className={`flow-route-node ${routeNode.kind} ${routeNode.status}`}>
      <Handle type="target" position={Position.Top} />
      <div className="flow-route-heading">
        <span className={`flow-route-icon ${routeNode.kind}`} aria-hidden="true">
          {routeNode.kind === 'terminal' ? '●' : routeNode.kind === 'diagnostic' ? '!' : '◇'}
        </span>
        <div className="flow-route-title">
          <span>{routeNode.category}</span>
          <strong>{routeNode.label}</strong>
        </div>
        {routeNode.status === 'warning' && <span className="flow-route-status">Review</span>}
        {routeNode.status === 'cycle' && <span className="flow-route-status">Cycle</span>}
      </div>
      {routeNode.details.length > 0 && (
        <ul className="flow-route-details">
          {routeNode.details.map((detail) => <li key={detail}>{detail}</li>)}
        </ul>
      )}
      <Handle type="source" position={Position.Bottom} />
    </article>
  );
}

const nodeTypes = { route: memo(RouteNode) };

function RouteEdgeComponent({
  id,
  sourceX,
  sourceY,
  sourcePosition,
  targetX,
  targetY,
  targetPosition,
  markerEnd,
  style,
  label,
  labelStyle,
  labelBgStyle,
  labelBgPadding,
  labelBgBorderRadius,
  data,
}: EdgeProps<RouteEdge>) {
  const [path, defaultLabelX, defaultLabelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 10,
  });
  const labelOnTargetVertical = data?.labelOnTargetVertical === true;

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        style={style}
        label={label}
        labelX={labelOnTargetVertical ? targetX : defaultLabelX}
        labelY={labelOnTargetVertical ? targetY - 24 : defaultLabelY}
        labelStyle={labelStyle}
        labelBgStyle={labelBgStyle}
        labelBgPadding={labelBgPadding}
        labelBgBorderRadius={labelBgBorderRadius}
      />
    </>
  );
}

const edgeTypes = { route: RouteEdgeComponent };

function escapeXml(value: string): string {
  return value.replace(/[<>&'"]/g, (character) => {
    const entities: Record<string, string> = {
      '<': '&lt;',
      '>': '&gt;',
      '&': '&amp;',
      "'": '&apos;',
      '"': '&quot;',
    };
    return entities[character];
  });
}

function wrapText(value: string, maxCharacters: number): string[] {
  const words = value.split(/\s+/);
  const lines: string[] = [];
  let line = '';

  words.forEach((word) => {
    if (word.length > maxCharacters) {
      if (line) {
        lines.push(line);
        line = '';
      }
      for (let index = 0; index < word.length; index += maxCharacters) {
        lines.push(word.slice(index, index + maxCharacters));
      }
      return;
    }

    if (line && `${line} ${word}`.length > maxCharacters) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  });

  if (line) {
    lines.push(line);
  }
  return lines;
}

function buildDiagramSvg(
  nodes: Node<RouteFlowNodeData>[],
  edges: RouteEdge[],
  title: string
): string {
  const nodeSizes = nodes.map((node) => ({
    node,
    width: node.measured?.width ?? node.width ?? NODE_WIDTH + 32,
    height: node.measured?.height ?? node.height ?? 90,
  }));
  const minX = Math.min(...nodeSizes.map(({ node }) => node.position.x));
  const minY = Math.min(...nodeSizes.map(({ node }) => node.position.y));
  const maxX = Math.max(...nodeSizes.map(({ node, width }) => node.position.x + width));
  const maxY = Math.max(...nodeSizes.map(({ node, height }) => node.position.y + height));
  const canvasWidth = maxX - minX + 80;
  const canvasHeight = maxY - minY + 112;
  const offsetX = 40 - minX;
  const offsetY = 76 - minY;
  const positions = new Map(
    nodeSizes.map(({ node, width, height }) => [
      node.id,
      {
        x: node.position.x + offsetX,
        y: node.position.y + offsetY,
        width,
        height,
      },
    ])
  );

  const edgeMarkup = edges.map((edge) => {
    const source = positions.get(edge.source);
    const target = positions.get(edge.target);
    if (!source || !target) {
      return '';
    }

    const startX = source.x + source.width / 2;
    const startY = source.y + source.height;
    const endX = target.x + target.width / 2;
    const endY = target.y;
    const midpointY = (startY + endY) / 2;
    const label = typeof edge.label === 'string' ? edge.label : '';
    const labelWidth = Math.max(44, label.length * 6.2 + 14);
    const labelOnTargetVertical = edge.data?.labelOnTargetVertical === true;
    const labelX = labelOnTargetVertical ? endX : (startX + endX) / 2;
    const labelY = labelOnTargetVertical ? endY - 24 : midpointY;

    return `<path d="M ${startX} ${startY} C ${startX} ${midpointY}, ${endX} ${midpointY}, ${endX} ${endY}" fill="none" stroke="#9aabc3" stroke-width="2" marker-end="url(#arrow)"/>${
      label
        ? `<rect x="${labelX - labelWidth / 2}" y="${labelY - 12}" width="${labelWidth}" height="20" rx="5" fill="#ffffff"/><text x="${labelX}" y="${labelY + 2}" text-anchor="middle" fill="#65748c" font-family="Arial, sans-serif" font-size="11" font-weight="600">${escapeXml(label)}</text>`
        : ''
    }`;
  }).join('');

  const nodeMarkup = nodeSizes.map(({ node, width, height }) => {
    const routeNode = node.data.routeNode;
    const position = positions.get(node.id);
    if (!position) {
      return '';
    }

    const warning = routeNode.status === 'warning' || routeNode.status === 'cycle';
    const terminal = routeNode.kind === 'terminal';
    const borderColor = warning ? '#eccf9f' : terminal ? '#c9e4d7' : '#dce4ef';
    const iconColor = warning ? '#a96319' : terminal ? '#258565' : '#386cc8';
    const labelLines = wrapText(routeNode.label, 32);
    let textMarkup = `<text x="${position.x + 57}" y="${position.y + 19}" fill="#8491a5" font-family="Arial, sans-serif" font-size="8" font-weight="700" letter-spacing="1">${escapeXml(routeNode.category.toUpperCase())}</text>`;
    labelLines.forEach((line, index) => {
      textMarkup += `<text x="${position.x + 57}" y="${position.y + 36 + index * 14}" fill="#30415b" font-family="Arial, sans-serif" font-size="11" font-weight="700">${escapeXml(line)}</text>`;
    });

    let detailY = position.y + 58 + (labelLines.length - 1) * 14;
    routeNode.details.forEach((detail) => {
      wrapText(detail, 38).forEach((line) => {
        textMarkup += `<text x="${position.x + 57}" y="${detailY}" fill="#718098" font-family="Arial, sans-serif" font-size="9">${escapeXml(line)}</text>`;
        detailY += 14;
      });
      detailY += 4;
    });

    return `<g><rect x="${position.x}" y="${position.y}" width="${width}" height="${height}" rx="13" fill="${warning ? '#fffdf9' : '#ffffff'}" stroke="${borderColor}" stroke-width="1.5"/><rect x="${position.x + 15}" y="${position.y + 10}" width="32" height="32" rx="10" fill="${terminal ? '#eaf7f0' : warning ? '#fff1df' : '#edf3ff'}"/><text x="${position.x + 31}" y="${position.y + 31}" text-anchor="middle" fill="${iconColor}" font-family="Arial, sans-serif" font-size="12" font-weight="700">${terminal ? '●' : warning ? '!' : '◇'}</text>${textMarkup}</g>`;
  }).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${canvasWidth}" height="${canvasHeight}" viewBox="0 0 ${canvasWidth} ${canvasHeight}"><rect width="100%" height="100%" fill="#f8fafd"/><text x="40" y="32" fill="#1b2941" font-family="Arial, sans-serif" font-size="18" font-weight="700">${escapeXml(title)}</text><text x="40" y="52" fill="#718098" font-family="Arial, sans-serif" font-size="11">Genesys Cloud routing diagram</text><defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M 0 0 L 8 4 L 0 8 z" fill="#9aabc3"/></marker></defs>${edgeMarkup}${nodeMarkup}</svg>`;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function RouteExportControls({ title }: { title: string }) {
  const { getNodes, getEdges } = useReactFlow<Node<RouteFlowNodeData>, RouteEdge>();
  const [exporting, setExporting] = useState<'svg' | 'png' | null>(null);
  const [exportError, setExportError] = useState('');

  const exportDiagram = async (format: 'svg' | 'png') => {
    setExporting(format);
    setExportError('');

    try {
      const nodes = getNodes();
      if (nodes.length === 0) {
        throw new Error('There is no routing diagram to export.');
      }

      const svg = buildDiagramSvg(nodes, getEdges(), title);
      const svgBlob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
      const filename = title.replace(/[<>:"/\\|?*]/g, '_').trim() || 'routing-diagram';

      if (format === 'svg') {
        downloadBlob(svgBlob, `${filename}.svg`);
        return;
      }

      const svgUrl = URL.createObjectURL(svgBlob);
      try {
        const image = new Image();
        image.src = svgUrl;
        await image.decode();
        const scale = 2;
        const canvas = document.createElement('canvas');
        canvas.width = image.width * scale;
        canvas.height = image.height * scale;
        const context = canvas.getContext('2d');
        if (!context) {
          throw new Error('Your browser could not create an image for export.');
        }
        context.scale(scale, scale);
        context.drawImage(image, 0, 0);
        const pngBlob = await new Promise<Blob>((resolve, reject) => {
          canvas.toBlob((result) => {
            if (result) {
              resolve(result);
            } else {
              reject(new Error('Your browser could not encode the diagram as a PNG.'));
            }
          }, 'image/png');
        });
        downloadBlob(pngBlob, `${filename}.png`);
      } finally {
        URL.revokeObjectURL(svgUrl);
      }
    } catch (error: unknown) {
      setExportError(
        error instanceof Error ? error.message : 'The routing diagram could not be exported.'
      );
    } finally {
      setExporting(null);
    }
  };

  return (
    <Panel position="top-right" className="route-export-panel">
      <div className="route-export-actions">
        <button type="button" disabled={exporting !== null} onClick={() => void exportDiagram('svg')}>
          {exporting === 'svg' ? 'Exporting…' : 'Export SVG'}
        </button>
        <button type="button" disabled={exporting !== null} onClick={() => void exportDiagram('png')}>
          {exporting === 'png' ? 'Exporting…' : 'Export PNG'}
        </button>
      </div>
      {exportError && <p role="alert">{exportError}</p>}
    </Panel>
  );
}

export default function RouteFlowCanvas({ diagram }: { diagram: RouteDiagramNode }) {
  const { nodes, edges } = useMemo(() => createRouteLayout(diagram), [diagram]);

  return (
    <div className="route-flow-canvas">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        fitViewOptions={{ padding: 0.18, maxZoom: 1 }}
        minZoom={0.15}
        maxZoom={1.5}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
      >
        <RouteExportControls title={diagram.label} />
        <Background color="#dbe3ee" gap={20} size={1} />
        <MiniMap
          pannable
          zoomable
          style={{ width: 150, height: 100 }}
          nodeColor={(node) => {
            const data: unknown = node.data;
            if (typeof data !== 'object' || data === null || !('routeNode' in data)) {
              return '#5783d5';
            }
            const routeNode: unknown = data.routeNode;
            if (
              typeof routeNode !== 'object' ||
              routeNode === null ||
              !('status' in routeNode) ||
              !('kind' in routeNode)
            ) {
              return '#5783d5';
            }
            if (routeNode.status === 'warning' || routeNode.status === 'cycle') return '#e5a54b';
            if (routeNode.kind === 'terminal') return '#55a783';
            return '#5783d5';
          }}
        />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
