import type { AnyActionDef } from '../action-kit';
import { audioActions } from './audio';
import { clipActions } from './clips';
import { effectActions } from './effects';
import { keyframeActions } from './keyframes';
import { mediaActions } from './media';
import { projectActions } from './project';
import { textActions } from './text';
import { trackActions } from './tracks';

export { internalOnlyActionTypes } from './media';

/**
 * Every editor command in the product. The UI, the keyboard shortcuts and the
 * AI tool layer all go through this one list, so an action added here is
 * immediately available to all three.
 */
export const ALL_ACTIONS: AnyActionDef[] = [
  ...projectActions,
  ...trackActions,
  ...clipActions,
  ...textActions,
  ...audioActions,
  ...effectActions,
  ...keyframeActions,
  ...mediaActions,
];
