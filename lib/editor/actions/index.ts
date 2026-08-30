import type { AnyActionDef } from '../action-kit';
import { audioActions } from './audio';
import { clipActions } from './clips';
import { effectActions } from './effects';
import { enhanceActions } from './enhance';
import { keyframeActions } from './keyframes';
import { mediaActions } from './media';
import { musicActions } from './music';
import { projectActions } from './project';
import { sfxActions } from './sfx';
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
  ...sfxActions,
  ...musicActions,
  ...effectActions,
  ...enhanceActions,
  ...keyframeActions,
  ...mediaActions,
];
