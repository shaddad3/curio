import React from 'react';
import { renderHook, act } from '@testing-library/react';
import ProvenanceProvider, { useProvenanceContext, NodeExecRecord } from '../../providers/ProvenanceProvider';

const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(ProvenanceProvider, null, children);

describe('ProvenanceProvider', () => {
    it('nodeExecProv stores a record in local state', () => {
        const { result } = renderHook(() => useProvenanceContext(), { wrapper });
        act(() => {
            result.current.nodeExecProv(
                '2025-01-01T00:00:00Z', '2025-01-01T00:00:01Z',
                'workflow', 'DATA_LOADING-node-1',
                ['DATAFRAME'], ['GEODATAFRAME'], 'df = df.head()'
            );
        });
        const nodes = result.current.provenanceGraphNodes;
        expect(nodes['node-1']).toHaveLength(1);
        expect(nodes['node-1'][0].code).toBe('df = df.head()');
        expect(nodes['node-1'][0].parentId).toBeNull();
        expect(nodes['node-1'][0].inputs).toEqual(['DATAFRAME']);
        expect(nodes['node-1'][0].outputs).toEqual(['GEODATAFRAME']);
    });

    it('nodeExecProv extracts nodeId from activity_name with multiple dashes', () => {
        const { result } = renderHook(() => useProvenanceContext(), { wrapper });
        act(() => {
            result.current.nodeExecProv('t', 't', 'wf', 'DATA_LOADING-node-abc-123', [], [], 'x=1');
        });
        expect(result.current.provenanceGraphNodes['node-abc-123']).toHaveLength(1);
    });

    it('branching: second run after setSelectedExec uses first run id as parentId', () => {
        const { result } = renderHook(() => useProvenanceContext(), { wrapper });
        act(() => {
            result.current.nodeExecProv('t1', 't2', 'wf', 'TYPE-node-1', [], [], 'code1');
        });
        const firstId = result.current.provenanceGraphNodes['node-1'][0].id;
        act(() => { result.current.setSelectedExec('node-1', firstId); });
        act(() => {
            result.current.nodeExecProv('t3', 't4', 'wf', 'TYPE-node-1', [], [], 'code2');
        });
        const records = result.current.provenanceGraphNodes['node-1'];
        expect(records).toHaveLength(2);
        expect(records[1].parentId).toBe(firstId);
    });

    it('consecutive runs without explicit setSelectedExec auto-chain (each run sets itself as parent)', () => {
        const { result } = renderHook(() => useProvenanceContext(), { wrapper });
        act(() => {
            result.current.nodeExecProv('t', 't', 'wf', 'T-node-2', [], [], 'run1');
        });
        act(() => {
            result.current.nodeExecProv('t', 't', 'wf', 'T-node-2', [], [], 'run2');
        });
        const records = result.current.provenanceGraphNodes['node-2'];
        expect(records).toHaveLength(2);
        expect(records[1].parentId).toBe(records[0].id);
    });

    it('loadNodeProvenance hydrates state and resets counter above max id', () => {
        const { result } = renderHook(() => useProvenanceContext(), { wrapper });
        const mockData: Record<string, NodeExecRecord[]> = {
            'node-5': [{ id: 10, parentId: null, code: 'x=1', inputs: [], outputs: [], startTime: '', endTime: '' }],
        };
        act(() => { result.current.loadNodeProvenance(mockData); });
        expect(result.current.provenanceGraphNodes['node-5']).toHaveLength(1);
        act(() => {
            result.current.nodeExecProv('t', 't', 'wf', 'T-node-5', [], [], 'y=2');
        });
        const records = result.current.provenanceGraphNodes['node-5'];
        expect(records[1].id).toBeGreaterThan(10);
    });

    it('getAllNodeProvenance returns current state', () => {
        const { result } = renderHook(() => useProvenanceContext(), { wrapper });
        act(() => {
            result.current.nodeExecProv('t', 't', 'wf', 'T-node-x', [], [], 'z=3');
        });
        const all = result.current.getAllNodeProvenance();
        expect(all['node-x']).toBeDefined();
        expect(all['node-x']).toHaveLength(1);
    });

    it('ids are unique across multiple nodes', () => {
        const { result } = renderHook(() => useProvenanceContext(), { wrapper });
        act(() => {
            result.current.nodeExecProv('t', 't', 'wf', 'T-node-a', [], [], 'a');
            result.current.nodeExecProv('t', 't', 'wf', 'T-node-b', [], [], 'b');
        });
        const idA = result.current.provenanceGraphNodes['node-a'][0].id;
        const idB = result.current.provenanceGraphNodes['node-b'][0].id;
        expect(idA).not.toBe(idB);
    });
});
