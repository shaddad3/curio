import dagre from 'dagre';
import { Node, Edge } from 'reactflow';

export function getLayoutedElements(
    nodes: Node[],
    edges: Edge[],
    nodeWidth = 220,
    nodeHeight = 80,
    direction = 'TB'
): { nodes: Node[]; edges: Edge[] } {
    const g = new dagre.graphlib.Graph();
    g.setGraph({ rankdir: direction, ranksep: 60, nodesep: 40 });
    g.setDefaultEdgeLabel(() => ({}));

    nodes.forEach(n => g.setNode(n.id, { width: nodeWidth, height: nodeHeight }));
    edges.forEach(e => g.setEdge(e.source, e.target));

    dagre.layout(g);

    return {
        nodes: nodes.map(n => {
            const pos = g.node(n.id);
            return { ...n, position: { x: pos.x - nodeWidth / 2, y: pos.y - nodeHeight / 2 } };
        }),
        edges,
    };
}
