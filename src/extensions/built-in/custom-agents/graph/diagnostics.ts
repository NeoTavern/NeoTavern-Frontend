export type GraphDiagnosticLocation =
  | { kind: 'AGENT'; path?: string }
  | { kind: 'FLOW'; flowId: string; path?: string }
  | { kind: 'NODE'; flowId: string; nodeId: string; path?: string }
  | { kind: 'PORT'; flowId: string; nodeId: string; portId: string; path?: string }
  | { kind: 'EDGE'; flowId: string; edgeId: string; path?: string };

export type GraphDiagnostic = {
  severity: 'ERROR' | 'WARNING';
  code: string;
  message: string;
  location: GraphDiagnosticLocation;
};

export const agentLocation = (path?: string): GraphDiagnosticLocation => ({
  kind: 'AGENT',
  ...(path === undefined ? {} : { path }),
});
export const flowLocation = (flowId: string, path?: string): GraphDiagnosticLocation => ({
  kind: 'FLOW',
  flowId,
  ...(path === undefined ? {} : { path }),
});
export const nodeLocation = (flowId: string, nodeId: string, path?: string): GraphDiagnosticLocation => ({
  kind: 'NODE',
  flowId,
  nodeId,
  ...(path === undefined ? {} : { path }),
});
export const portLocation = (
  flowId: string,
  nodeId: string,
  portId: string,
  path?: string,
): GraphDiagnosticLocation => ({
  kind: 'PORT',
  flowId,
  nodeId,
  portId,
  ...(path === undefined ? {} : { path }),
});
export const edgeLocation = (flowId: string, edgeId: string, path?: string): GraphDiagnosticLocation => ({
  kind: 'EDGE',
  flowId,
  edgeId,
  ...(path === undefined ? {} : { path }),
});

export function errorDiagnostic(code: string, message: string, location: GraphDiagnosticLocation): GraphDiagnostic {
  return { severity: 'ERROR', code, message, location };
}

const compareText = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0);

export function compareDiagnostics(left: GraphDiagnostic, right: GraphDiagnostic): number {
  const locationKey = (location: GraphDiagnosticLocation): string => {
    if (location.kind === 'AGENT') return `0:${location.path ?? ''}`;
    if (location.kind === 'FLOW') return `1:${location.flowId}:${location.path ?? ''}`;
    if (location.kind === 'NODE') return `2:${location.flowId}:${location.nodeId}:${location.path ?? ''}`;
    if (location.kind === 'PORT')
      return `3:${location.flowId}:${location.nodeId}:${location.portId}:${location.path ?? ''}`;
    return `4:${location.flowId}:${location.edgeId}:${location.path ?? ''}`;
  };
  return (
    compareText(locationKey(left.location), locationKey(right.location)) ||
    compareText(left.code, right.code) ||
    compareText(left.message, right.message)
  );
}
