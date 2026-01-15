export interface ToolDefinition {
  name: string;
  displayName?: string;
  description: string;
  icon?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  parameters: Record<string, any> | object;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  action: (args: any) => Promise<any> | any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  formatMessage?: (args: any) => Promise<string> | string;
  stealth?: boolean;
}

export interface ToolInvocation {
  id: string;
  name: string;
  displayName: string;
  parameters: string; // JSON string
  result: string;
  signature?: string; // Thought signature for some providers
}

export interface ToolCall {
  id: string;
  function: {
    name: string;
    arguments: string; // JSON string
  };
  signature?: string;
}
