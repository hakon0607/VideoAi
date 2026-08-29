import type { EditorState } from '@/types/editor';
import type { ActionContext, AnyActionDef, EditorAction } from './action-kit';
import { ALL_ACTIONS, internalOnlyActionTypes } from './actions';
import { EditorError } from './errors';
import { newId } from './ids';

/** type -> definition. Built once at module load. */
export const ACTION_REGISTRY: Map<string, AnyActionDef> = new Map(ALL_ACTIONS.map((a) => [a.type, a]));

export const ACTION_TYPES = [...ACTION_REGISTRY.keys()].sort();

export function getActionDef(type: string): AnyActionDef {
  const def = ACTION_REGISTRY.get(type);
  if (!def) {
    throw new EditorError('unsupported_action', `"${type}" is not an editor action.`, {
      availableActions: ACTION_TYPES,
    });
  }
  return def;
}

export function isDestructive(type: string): boolean {
  return ACTION_REGISTRY.get(type)?.destructive === true;
}

/** Actions the model is allowed to call. Internal plumbing stays hidden. */
export function aiExposedActions(): AnyActionDef[] {
  return ALL_ACTIONS.filter((a) => !internalOnlyActionTypes.has(a.type));
}

export const defaultContext: ActionContext = { newId };

export interface AppliedAction {
  /** The action with every generated id filled in, so it replays identically. */
  action: EditorAction;
  description: string;
}

export interface ApplyResult {
  state: EditorState;
  applied: AppliedAction[];
}

/**
 * Runs a single action. Validation happens here and nowhere else: parameters go
 * through the action's Zod schema, then through the lookups that throw
 * structured EditorErrors when an id does not exist.
 */
export function applyAction(
  state: EditorState,
  action: EditorAction,
  ctx: ActionContext = defaultContext,
): { state: EditorState; applied: AppliedAction } {
  const def = getActionDef(action.type);
  const parsed = def.schema.safeParse(action.params ?? {});
  if (!parsed.success) {
    throw new EditorError('invalid_parameters', `Invalid parameters for ${action.type}.`, {
      issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  const prepared = def.prepare ? def.prepare(parsed.data, ctx) : parsed.data;
  const outcome = def.apply(state, prepared, ctx);
  return {
    state: outcome.state,
    applied: {
      action: { type: action.type, params: prepared as Record<string, unknown> },
      description: outcome.description,
    },
  };
}

/**
 * Runs a batch of actions in order. Either every action lands or the whole
 * batch is rejected, which is what makes an AI request a single undo step.
 */
export function applyActions(
  state: EditorState,
  actions: EditorAction[],
  ctx: ActionContext = defaultContext,
): ApplyResult {
  let next = state;
  const applied: AppliedAction[] = [];
  for (const action of actions) {
    const result = applyAction(next, action, ctx);
    next = result.state;
    applied.push(result.applied);
  }
  return { state: { ...next, revision: state.revision + 1 }, applied };
}

/** Runs a batch but keeps going past failures, reporting what did not land. */
export function applyActionsLenient(
  state: EditorState,
  actions: EditorAction[],
  ctx: ActionContext = defaultContext,
): ApplyResult & { failures: { action: EditorAction; error: EditorError }[] } {
  let next = state;
  const applied: AppliedAction[] = [];
  const failures: { action: EditorAction; error: EditorError }[] = [];
  for (const action of actions) {
    try {
      const result = applyAction(next, action, ctx);
      next = result.state;
      applied.push(result.applied);
    } catch (error) {
      failures.push({
        action,
        error:
          error instanceof EditorError
            ? error
            : new EditorError('invalid_parameters', error instanceof Error ? error.message : String(error)),
      });
    }
  }
  return { state: { ...next, revision: state.revision + 1 }, applied, failures };
}
