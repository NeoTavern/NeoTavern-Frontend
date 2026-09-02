import { z } from 'zod';
import { isSafePath } from '../generic/path';
import { parseWithSchema, type ValidationResult } from '../generic/validation';
import type { RowBinding, ViewBinding, ViewCaseBinding, ViewComponent, ViewDefinition } from './contracts';

const id = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]*$/, 'must be an ID');
const finite = z.number().finite();
const strict = <T extends z.ZodRawShape>(shape: T) => z.strictObject(shape);
const jsonPrimitiveSchema = z.union([z.string(), finite, z.boolean(), z.null()]);
const safePathSchema = z.string().refine(isSafePath, 'must be a safe path');

const viewBindingSchema = strict({ $ref: z.string().regex(/^(state|config)\.(.+)$/) }).superRefine((value, context) => {
  if (!isSafePath(value.$ref.slice(value.$ref.indexOf('.') + 1)))
    context.addIssue({ code: 'custom', path: ['$ref'], message: 'must use a safe path' });
}) as unknown as z.ZodType<ViewBinding>;
const rowBindingSchema = strict({ $ref: z.string().regex(/^row\.(.+)$/) }).superRefine((value, context) => {
  if (!isSafePath(value.$ref.slice(4)))
    context.addIssue({ code: 'custom', path: ['$ref'], message: 'must use a safe path' });
}) as unknown as z.ZodType<RowBinding>;
const viewCaseBindingSchema = strict({ $ref: z.literal('view.value') }) as z.ZodType<ViewCaseBinding>;
const viewValue = (allowRow: boolean, allowCase: boolean): z.ZodTypeAny =>
  z.lazy(() =>
    z.union([
      jsonPrimitiveSchema,
      viewBindingSchema,
      ...(allowRow ? [rowBindingSchema] : []),
      ...(allowCase ? [viewCaseBindingSchema] : []),
      z.array(viewValue(allowRow, allowCase)),
      z
        .record(z.string(), viewValue(allowRow, allowCase))
        .refine((value) => !('$ref' in value), 'an object containing $ref must be an exact binding'),
    ]),
  );
const viewConditionSchema: z.ZodTypeAny = z.lazy(() =>
  z.discriminatedUnion('op', [
    strict({ op: z.enum(['all', 'any']), conditions: z.array(viewConditionSchema).min(1) }),
    strict({ op: z.literal('not'), condition: viewConditionSchema }),
    strict({ op: z.enum(['exists', 'missing']), reference: z.union([viewBindingSchema, viewCaseBindingSchema]) }),
    strict({
      op: z.enum(['equals', 'notEquals', 'gt', 'gte', 'lt', 'lte']),
      left: viewValue(false, true),
      right: viewValue(false, true),
    }),
    strict({ op: z.literal('in'), value: viewValue(false, true), collection: viewValue(false, true) }),
  ]),
);
const viewActionSchema = strict({
  label: z.string(),
  workflowId: id,
  input: viewValue(false, false),
  confirm: z.boolean(),
});
const rowActionSchema = strict({
  label: z.string(),
  workflowId: id,
  input: viewValue(true, false),
  confirm: z.boolean(),
});
const runtimeActionSchema = strict({
  label: z.string(),
  command: z.enum(['ABORT_ACTIVE_MANUAL', 'RESET_SELECTED_AGENT']),
  confirm: z.boolean(),
});
const simpleRowField = strict({
  name: id,
  label: z.string(),
  control: z.enum(['TEXT', 'TEXTAREA', 'NUMBER', 'CHECKBOX', 'JSON']),
  initial: rowBindingSchema,
});
const selectRowField = strict({
  name: id,
  label: z.string(),
  control: z.literal('SELECT'),
  initial: rowBindingSchema,
  options: viewBindingSchema,
  optionLabelPath: safePathSchema,
  optionValuePath: safePathSchema,
});
const rowFormSchema = strict({
  label: z.string(),
  workflowId: id,
  fields: z.array(z.union([simpleRowField, selectRowField])),
});
const simpleFormField = strict({
  name: id,
  label: z.string(),
  control: z.enum(['TEXT', 'TEXTAREA', 'NUMBER', 'CHECKBOX', 'JSON']),
  initial: viewBindingSchema.optional(),
});
const selectFormField = strict({
  name: id,
  label: z.string(),
  control: z.literal('SELECT'),
  initial: viewBindingSchema.optional(),
  options: viewBindingSchema,
  optionLabelPath: safePathSchema,
  optionValuePath: safePathSchema,
});
const viewComponentSchema: z.ZodType<ViewComponent> = z.lazy(() =>
  z.discriminatedUnion('component', [
    strict({
      id,
      component: z.literal('TABS'),
      tabs: z.array(strict({ id, label: z.string(), components: z.array(viewComponentSchema) })),
    }),
    strict({ id, component: z.literal('SECTION'), title: z.string(), components: z.array(viewComponentSchema) }),
    strict({
      id,
      component: z.literal('SCALAR'),
      label: z.string(),
      binding: viewBindingSchema,
      format: z.enum(['TEXT', 'NUMBER', 'BOOLEAN']),
      aggregate: z.literal('COUNT').optional(),
    }),
    strict({
      id,
      component: z.literal('STATUS'),
      label: z.string(),
      binding: viewBindingSchema,
      cases: z.array(
        strict({
          condition: viewConditionSchema,
          label: z.string(),
          tone: z.enum(['NEUTRAL', 'INFO', 'SUCCESS', 'WARNING', 'DANGER']),
        }),
      ),
    }),
    strict({
      id,
      component: z.literal('LIST'),
      label: z.string(),
      binding: viewBindingSchema,
      fields: z.array(strict({ label: z.string(), path: safePathSchema })),
      order: z.enum(['ASC', 'DESC']),
      limit: finite.optional(),
    }),
    strict({
      id,
      component: z.literal('TABLE'),
      label: z.string(),
      binding: viewBindingSchema,
      columns: z.array(strict({ label: z.string(), path: safePathSchema })),
      order: z.enum(['ASC', 'DESC']),
      limit: finite.optional(),
      pageSize: finite.optional(),
      rowActions: z.array(z.union([rowActionSchema, rowFormSchema])).optional(),
    }),
    strict({ id, component: z.literal('JSON_DETAILS'), label: z.string(), binding: viewBindingSchema }),
    strict({
      id,
      component: z.literal('BUTTON'),
      label: z.string(),
      action: z.union([viewActionSchema, runtimeActionSchema]),
    }),
    strict({
      id,
      component: z.literal('FORM'),
      label: z.string(),
      workflowId: id,
      fields: z.array(z.union([simpleFormField, selectFormField])),
    }),
  ]),
) as unknown as z.ZodType<ViewComponent>;
const viewDefinitionSchema: z.ZodType<ViewDefinition> = strict({ id, title: z.string(), root: viewComponentSchema });

export function validateViewDefinition(value: unknown, path = 'view'): ValidationResult<ViewDefinition> {
  return parseWithSchema(viewDefinitionSchema, value, path);
}

export function validateViewReferences(views: ViewDefinition[], manualFlowIds: ReadonlySet<string>): string[] {
  const errors: string[] = [];
  const viewIds = new Set<string>();
  const walk = (component: ViewComponent, path: string, ids: Set<string>): void => {
    if (ids.has(component.id)) errors.push(`${path}.id is duplicated in this view`);
    ids.add(component.id);
    if (component.component === 'TABS') {
      for (const [index, tab] of component.tabs.entries()) {
        if (ids.has(tab.id)) errors.push(`${path}.tabs[${index}].id is duplicated in this view`);
        ids.add(tab.id);
        tab.components.forEach((child, childIndex) =>
          walk(child, `${path}.tabs[${index}].components[${childIndex}]`, ids),
        );
      }
    }
    if (component.component === 'SECTION')
      component.components.forEach((child, index) => walk(child, `${path}.components[${index}]`, ids));
    const flowIds: string[] = [];
    if (component.component === 'FORM') flowIds.push(component.workflowId);
    if (component.component === 'BUTTON' && 'workflowId' in component.action) flowIds.push(component.action.workflowId);
    if (component.component === 'TABLE') component.rowActions?.forEach((action) => flowIds.push(action.workflowId));
    for (const flowId of flowIds)
      if (!manualFlowIds.has(flowId)) errors.push(`${path} references non-manual or unknown flow ${flowId}`);
    if (component.component === 'FORM') {
      const names = new Set<string>();
      component.fields.forEach((field, index) => {
        if (names.has(field.name)) errors.push(`${path}.fields[${index}].name is duplicated`);
        names.add(field.name);
      });
    }
  };
  views.forEach((view, index) => {
    if (viewIds.has(view.id)) errors.push(`agent.views[${index}].id is duplicated`);
    viewIds.add(view.id);
    walk(view.root, `agent.views[${index}].root`, new Set());
  });
  return errors;
}
