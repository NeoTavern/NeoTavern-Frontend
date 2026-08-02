import { WorldInfoRole } from '../constants';

export function validateWorldInfoRole(role: unknown, context = 'World Info entry'): WorldInfoRole {
  switch (role) {
    case WorldInfoRole.SYSTEM:
    case WorldInfoRole.USER:
    case WorldInfoRole.ASSISTANT:
      return role;
    case 'system':
      return WorldInfoRole.SYSTEM;
    case 'user':
      return WorldInfoRole.USER;
    case 'assistant':
      return WorldInfoRole.ASSISTANT;
    default:
      throw new Error(`Unsupported role for ${context}: ${String(role)}`);
  }
}
