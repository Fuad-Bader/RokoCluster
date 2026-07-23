import { useCallback, useEffect, useMemo, useRef } from 'react';
import ForceGraph2D, { type ForceGraphMethods } from 'react-force-graph-2d';
import { useStore } from '../store/useStore';
import { applyFilters, matchesSearch, neighborsOf } from '../lib/filter';
import { KIND_STYLE, STATUS_RING } from '../lib/palette';
import type { GraphLink, GraphNode } from '../types';

// Link rest-length per relationship — tighter for "contains" so containers hug
// their pod, looser for cross-cutting "targets"/"runs-on" edges.
const LINK_DISTANCE: Record<GraphLink['kind'], number> = {
  contains: 24,
  manages: 42,
  'runs-on': 70,
  targets: 60,
  'belongs-to': 30,
};

function endpointId(e: string | GraphNode): string {
  return typeof e === 'string' ? e : e.id;
}

export function GraphView() {
  const fgRef = useRef<ForceGraphMethods<GraphNode, GraphLink> | undefined>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);
  const lastClickRef = useRef<{ id: string; at: number } | null>(null);

  const graph = useStore((s) => s.graph);
  const filters = useStore((s) => s.filters);
  const selectedId = useStore((s) => s.selectedId);
  const hoverId = useStore((s) => s.hoverId);
  const select = useStore((s) => s.select);
  const inspect = useStore((s) => s.inspect);
  const setHover = useStore((s) => s.setHover);

  const data = useMemo(() => applyFilters(graph, filters), [graph, filters]);

  // Highlighted set = hovered/selected node + its direct neighbors.
  const focusId = hoverId ?? selectedId;
  const highlight = useMemo(
    () => (focusId ? neighborsOf(graph, focusId) : null),
    [graph, focusId],
  );

  // Configure forces once the simulation engine is available, tuned for an
  // Obsidian-like feel: per-link distances, moderate repulsion, strong velocity
  // decay so the graph settles quickly and drags stay local.
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    fg.d3Force('charge')?.strength(-90).distanceMax(320);
    const link = fg.d3Force('link');
    if (link) {
      link
        .distance((l: GraphLink) => LINK_DISTANCE[l.kind] ?? 40)
        .strength((l: GraphLink) =>
          l.kind === 'contains' ? 0.9 : l.kind === 'manages' ? 0.5 : 0.2,
        );
    }
    fg.d3Force('center')?.strength(0.04);
  }, []);

  // Keep the canvas sized to its container.
  useEffect(() => {
    const fg = fgRef.current;
    const el = containerRef.current;
    if (!fg || !el) return;
    const ro = new ResizeObserver(() => {
      // ForceGraph reads width/height props; trigger a reheat for re-centering.
      fg.d3ReheatSimulation();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const drawNode = useCallback(
    (node: GraphNode, ctx: CanvasRenderingContext2D, scale: number) => {
      const style = KIND_STYLE[node.kind];
      const r = style.size;
      const x = node.x ?? 0;
      const y = node.y ?? 0;

      const dimmed = highlight ? !highlight.has(node.id) : false;
      const matched = matchesSearch(node, filters.search);
      const alpha = dimmed || !matched ? 0.18 : 1;

      ctx.globalAlpha = alpha;

      // Status ring
      ctx.beginPath();
      ctx.arc(x, y, r + 1.6, 0, 2 * Math.PI);
      ctx.fillStyle = STATUS_RING[node.status];
      ctx.fill();

      // Body
      ctx.beginPath();
      ctx.arc(x, y, r, 0, 2 * Math.PI);
      ctx.fillStyle = style.color;
      ctx.fill();

      if (node.id === selectedId) {
        ctx.lineWidth = 2 / scale;
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();
      }

      // Label — only when zoomed in enough, or always for high-level kinds.
      const showLabel = scale > 1.3 || node.kind === 'Namespace' || node.kind === 'Node';
      if (showLabel && alpha > 0.5) {
        const fontSize = Math.max(10 / scale, 2.2);
        ctx.font = `${fontSize}px ui-sans-serif, system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillStyle = 'rgba(229,231,235,0.92)';
        ctx.fillText(node.name, x, y + r + 1.5);
      }
      ctx.globalAlpha = 1;
    },
    [highlight, selectedId, filters.search],
  );

  const onNodeClick = useCallback(
    (node: GraphNode, event: MouseEvent) => {
      select(node.id);
      const now = Date.now();
      const previous = lastClickRef.current;
      const isDoubleClick =
        event.detail >= 2 ||
        (previous?.id === node.id && now - previous.at < 650);
      if (isDoubleClick) {
        inspect(node.id);
        lastClickRef.current = null;
      } else {
        lastClickRef.current = { id: node.id, at: now };
      }
    },
    [inspect, select],
  );

  return (
    <div ref={containerRef} className="absolute inset-0">
      <ForceGraph2D
        ref={fgRef}
        graphData={data}
        backgroundColor="#0b0e14"
        nodeId="id"
        nodeRelSize={1}
        nodeLabel={(n: GraphNode) =>
          `${n.kind}: ${n.namespace ? `${n.namespace}/` : ''}${n.name}${
            n.summary ? ` — ${n.summary}` : ''
          }`
        }
        nodeCanvasObject={drawNode}
        nodePointerAreaPaint={(node: GraphNode, color, ctx) => {
          ctx.fillStyle = color;
          const r = KIND_STYLE[node.kind].size + 2;
          ctx.beginPath();
          ctx.arc(node.x ?? 0, node.y ?? 0, r, 0, 2 * Math.PI);
          ctx.fill();
        }}
        linkColor={(l: GraphLink) => {
          if (!highlight) return 'rgba(148,163,184,0.22)';
          const on = highlight.has(endpointId(l.source)) && highlight.has(endpointId(l.target));
          return on ? 'rgba(56,189,248,0.85)' : 'rgba(148,163,184,0.07)';
        }}
        linkWidth={(l: GraphLink) =>
          highlight && highlight.has(endpointId(l.source)) && highlight.has(endpointId(l.target))
            ? 1.6
            : 0.6
        }
        linkDirectionalParticles={0}
        onNodeClick={onNodeClick}
        onNodeHover={(n: GraphNode | null) => setHover(n?.id ?? null)}
        onBackgroundClick={() => select(null)}
        onNodeDragEnd={(node: GraphNode) => {
          // Pin where dropped — Obsidian-style "sticky" drag.
          node.fx = node.x;
          node.fy = node.y;
        }}
        cooldownTime={4000}
        warmupTicks={40}
        d3VelocityDecay={0.5}
        d3AlphaDecay={0.035}
      />
    </div>
  );
}
