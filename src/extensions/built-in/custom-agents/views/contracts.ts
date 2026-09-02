import type { JsonPrimitive, JsonValue } from '../generic/json';

export interface ViewDefinition {
  id: string;
  title: string;
  root: ViewComponent;
}

export type ViewBinding = { $ref: `${'state' | 'config'}.${string}` };
export type RowBinding = { $ref: `row.${string}` };
export type ViewCaseBinding = { $ref: 'view.value' };
export type ViewValue = JsonPrimitive | ViewBinding | RowBinding | ViewValue[] | { [key: string]: ViewValue };
export type ViewCaseValue =
  | JsonPrimitive
  | ViewBinding
  | ViewCaseBinding
  | ViewCaseValue[]
  | { [key: string]: ViewCaseValue };
export type ViewCondition =
  | { op: 'all' | 'any'; conditions: ViewCondition[] }
  | { op: 'not'; condition: ViewCondition }
  | { op: 'exists' | 'missing'; reference: ViewBinding | ViewCaseBinding }
  | { op: 'equals' | 'notEquals' | 'gt' | 'gte' | 'lt' | 'lte'; left: ViewCaseValue; right: ViewCaseValue }
  | { op: 'in'; value: ViewCaseValue; collection: ViewCaseValue };
export type ViewAction = { label: string; workflowId: string; input: ViewValue; confirm: boolean };
export type RuntimeAction = {
  label: string;
  command: 'ABORT_ACTIVE_MANUAL' | 'RESET_SELECTED_AGENT';
  confirm: boolean;
};
export type ViewRowForm = { label: string; workflowId: string; fields: RowFormField[] };
export type RowFormField =
  | { name: string; label: string; control: 'TEXT' | 'TEXTAREA' | 'NUMBER' | 'CHECKBOX' | 'JSON'; initial: RowBinding }
  | {
      name: string;
      label: string;
      control: 'SELECT';
      initial: RowBinding;
      options: ViewBinding;
      optionLabelPath: string;
      optionValuePath: string;
    };
export type FormField =
  | {
      name: string;
      label: string;
      control: 'TEXT' | 'TEXTAREA' | 'NUMBER' | 'CHECKBOX' | 'JSON';
      initial?: ViewBinding;
    }
  | {
      name: string;
      label: string;
      control: 'SELECT';
      initial?: ViewBinding;
      options: ViewBinding;
      optionLabelPath: string;
      optionValuePath: string;
    };
export type ViewComponent =
  | { id: string; component: 'TABS'; tabs: Array<{ id: string; label: string; components: ViewComponent[] }> }
  | { id: string; component: 'SECTION'; title: string; components: ViewComponent[] }
  | {
      id: string;
      component: 'SCALAR';
      label: string;
      binding: ViewBinding;
      format: 'TEXT' | 'NUMBER' | 'BOOLEAN';
      aggregate?: 'COUNT';
    }
  | {
      id: string;
      component: 'STATUS';
      label: string;
      binding: ViewBinding;
      cases: Array<{
        condition: ViewCondition;
        label: string;
        tone: 'NEUTRAL' | 'INFO' | 'SUCCESS' | 'WARNING' | 'DANGER';
      }>;
    }
  | {
      id: string;
      component: 'LIST';
      label: string;
      binding: ViewBinding;
      fields: Array<{ label: string; path: string }>;
      order: 'ASC' | 'DESC';
      limit?: number;
    }
  | {
      id: string;
      component: 'TABLE';
      label: string;
      binding: ViewBinding;
      columns: Array<{ label: string; path: string }>;
      order: 'ASC' | 'DESC';
      limit?: number;
      pageSize?: number;
      rowActions?: Array<ViewAction | ViewRowForm>;
    }
  | { id: string; component: 'JSON_DETAILS'; label: string; binding: ViewBinding }
  | { id: string; component: 'BUTTON'; label: string; action: ViewAction | RuntimeAction }
  | { id: string; component: 'FORM'; label: string; workflowId: string; fields: FormField[] };

export type SelectOptionValue = JsonValue;
