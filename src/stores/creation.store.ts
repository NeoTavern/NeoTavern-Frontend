import { atom } from 'nanostores';
import { depth_prompt_depth_default, depth_prompt_role_default, talkativeness_default } from '../constants';
import type { CreateSave } from '../types';

export const createSave = atom<CreateSave>({
  name: '',
  description: '',
  creator_notes: '',
  post_history_instructions: '',
  character_version: '',
  system_prompt: '',
  tags: '',
  creator: '',
  personality: '',
  first_message: '',
  avatar: null,
  scenario: '',
  mes_example: '',
  world: '',
  talkativeness: talkativeness_default,
  alternate_greetings: [],
  depth_prompt_prompt: '',
  depth_prompt_depth: depth_prompt_depth_default,
  depth_prompt_role: depth_prompt_role_default,
  extensions: {},
  extra_books: [],
});
